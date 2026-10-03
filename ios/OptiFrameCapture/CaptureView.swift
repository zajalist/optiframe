import ARKit
import ImageIO
import SceneKit
import SwiftUI

struct CaptureView: View {
    @StateObject private var capture = LensCapture()
    @State private var side = LensSide.left
    @State private var mode = CaptureMode.photo
    @State private var export: CaptureExport?
    @State private var reviewing = false
    @State private var gpuServer = ""
    @State private var gpuToken = ""
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        ScrollView {
        VStack(spacing: 12) {
            HStack {
                Text("OptiFrame Capture").font(.headline)
                Spacer()
                Text(capture.depthAvailable ? "LiDAR" : "RGB + pose")
                    .font(.caption).foregroundStyle(.secondary)
            }
            CameraPreview(session: capture.session, contour: [],
                          showBox: mode == .liveSegmentation)
                .frame(height: 260)
                .clipShape(RoundedRectangle(cornerRadius: 16))

            Picker("Lens", selection: $side) {
                ForEach(LensSide.allCases) { value in Text(value.rawValue).tag(value) }
            }
            .pickerStyle(.segmented)
            .disabled(capture.isBusy || capture.isRecording)

            if mode == .liveSegmentation {
                TextField("HTTPS GPU server, e.g. https://your-server", text: $gpuServer)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .keyboardType(.URL).textFieldStyle(.roundedBorder)
                SecureField("Access key (if required)", text: $gpuToken)
                    .textInputAutocapitalization(.never).textFieldStyle(.roundedBorder)
                HStack {
                    Button("Start live") { capture.startSegmentation(server: gpuServer, token: gpuToken) }
                    Button("Stop live") { capture.stopSegmentation() }
                }.buttonStyle(.bordered)
                Text(capture.segmentationStatus).font(.caption)
                if let data = capture.liveProposalJPEG,
                   let image = UIImage(data: data) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Latest SAM source frame · sensor axes").font(.caption.bold())
                        ProposalSnapshot(image: image, contour: capture.liveContour)
                        Text("Proposal belongs to this captured image. Review before measuring.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                Text("Camera samples are sent to this server for SAM proposals. The access key stays in memory. Keep the full lens inside the box; approve contour and printed scale after export.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Picker("Capture mode", selection: $mode) {
                ForEach(CaptureMode.allCases) { value in Text(value.title).tag(value) }
            }
            .pickerStyle(.menu)
            .disabled(capture.isBusy || capture.isRecording)

            Text(mode == .depthArc
                 ? "Hold the lens upright with the board behind it. Move through a slow arc. Clear lens depth may be missing or belong to the background."
                 : mode == .outlineVideo
                 ? "Keep lens and sheet still. Record up to 12 original frames over 9 seconds; move the phone slightly to reveal the rim. This burst exports JPEGs, not a movie."
                 : "Keep the phone fixed when capturing the empty sheet and lens photo.")
                .font(.caption).foregroundStyle(.secondary)

            Text("Keep all four scale markers visible. Verify the printed ruler. If glare hides the rim, use oblique side lighting and retake; enhanced images cannot restore clipped detail.")
                .font(.caption)

            Text(capture.status)
                .font(.footnote)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text("\(capture.frameCount) frames · \(capture.depthAvailable ? "LiDAR depth on" : "images + poses")")
                .font(.footnote)
                .frame(maxWidth: .infinity, alignment: .leading)

            if capture.isRecording {
                ProgressView(value: Double(capture.sequenceAttempt),
                             total: Double(CaptureMode.sequenceAttempts))
                Text("Recording · \(capture.sequenceAttempt)/\(CaptureMode.sequenceAttempts) sampling attempts")
                    .font(.caption).monospacedDigit()
            }

            HStack {
                Button(capture.isRecording ? "Stop recording" : mode.isSequence ? "Start recording" : "Capture frame") {
                    if capture.isRecording { capture.endSequence() }
                    else if mode.isSequence { capture.beginSequence(side: side, mode: mode) }
                    else { capture.capture(side: side, kind: mode.frameKind) }
                }
                    .buttonStyle(.borderedProminent)
                    .disabled(capture.isBusy && !capture.isRecording)
                Button("Review & export") { reviewing = true }
                .buttonStyle(.bordered)
                .disabled(capture.frameCount == 0 || capture.isBusy || capture.isRecording)
                Button("New lens") { capture.newLens() }
                    .buttonStyle(.bordered)
                    .disabled(capture.isBusy || capture.isRecording)
            }
        }
        .padding()
        }
        .onAppear { capture.start() }
        .onDisappear { capture.stop() }
        .onChange(of: scenePhase) { _, phase in
            if phase != .active { capture.endSequence(); capture.stopSegmentation() }
        }
        .onChange(of: mode) { _, _ in capture.stopSegmentation() }
        .sheet(item: $export) { item in ShareSheet(url: item.url) }
        .sheet(isPresented: $reviewing) {
            NavigationStack {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 16) {
                        Text("\(capture.frameCount) original frames").font(.title2.bold())
                        Text("\(capture.reviewFrames.filter { $0.hasDepth }.count) frames include scene depth. Sharpness and clipping are capture hints; review every part of the rim before measuring.")
                            .font(.subheadline)
                        if let best = capture.bestLensFrame {
                            Text("Suggested outline frame: #\(best.id)").font(.headline)
                        }
                        ForEach(capture.reviewFrames) { frame in
                            VStack(alignment: .leading, spacing: 6) {
                                if let image = reviewThumbnail(frame.originalURL) {
                                    Image(uiImage: image).resizable().scaledToFit()
                                        .frame(maxHeight: 230).clipShape(RoundedRectangle(cornerRadius: 10))
                                }
                                Text("#\(frame.id) · \(frame.kind.title) · sharpness \(frame.sharpness, specifier: "%.0f") · central clipping \(frame.clippedFraction * 100, specifier: "%.1f")%")
                                    .font(.caption).monospacedDigit()
                            }
                        }
                        Text("Export originals, enhanced images, poses and optional raw depth. Import the ZIP to confirm sheet scale and approve a contour. Scene depth is not a validated transparent lens surface.")
                            .font(.footnote).foregroundStyle(.secondary)
                        Text(capture.status).font(.footnote)
                        Button("Export capture ZIP") {
                            capture.export { url in
                                if let url {
                                    reviewing = false
                                    // Present sharing after the review sheet has dismissed.
                                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                                        export = CaptureExport(url: url)
                                    }
                                }
                            }
                        }
                        .buttonStyle(.borderedProminent).disabled(capture.isBusy)
                    }.padding()
                }
                .navigationTitle("Review capture")
                .toolbar { Button("Done") { reviewing = false }.disabled(capture.isBusy) }
            }
        }
    }

    private func reviewThumbnail(_ url: URL) -> UIImage? {
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
              let bitmap = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceThumbnailMaxPixelSize: 640,
                kCGImageSourceShouldCacheImmediately: true
              ] as CFDictionary) else { return nil }
        return UIImage(cgImage: bitmap)
    }
}

private struct ProposalSnapshot: View {
    let image: UIImage
    let contour: [CGPoint]

    var body: some View {
        Image(uiImage: image).resizable().scaledToFit()
            .overlay {
                GeometryReader { geometry in
                    Path { path in
                        guard let first = contour.first else { return }
                        func point(_ value: CGPoint) -> CGPoint {
                            CGPoint(x: value.x * geometry.size.width,
                                    y: value.y * geometry.size.height)
                        }
                        path.move(to: point(first))
                        for value in contour.dropFirst() { path.addLine(to: point(value)) }
                        path.closeSubpath()
                    }.stroke(.mint, lineWidth: 2)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 10))
    }
}

private struct CameraPreview: UIViewRepresentable {
    let session: ARSession
    let contour: [CGPoint]
    let showBox: Bool

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView()
        view.session = session
        view.automaticallyUpdatesLighting = false
        let overlay = CAShapeLayer()
        overlay.name = "proposal"
        overlay.strokeColor = UIColor.systemMint.cgColor
        overlay.fillColor = UIColor.clear.cgColor
        overlay.lineWidth = 2
        view.layer.addSublayer(overlay)
        let box = CAShapeLayer()
        box.name = "roi"
        box.strokeColor = UIColor.white.withAlphaComponent(0.7).cgColor
        box.fillColor = UIColor.clear.cgColor
        box.lineWidth = 1
        box.lineDashPattern = [6, 4]
        view.layer.addSublayer(box)
        return view
    }

    func updateUIView(_ uiView: ARSCNView, context: Context) {
        guard let frame = session.currentFrame else { return }
        let size = uiView.bounds.size
        guard size.width > 0, size.height > 0 else { return }
        let orientation = uiView.window?.windowScene?.interfaceOrientation ?? .portrait
        let transform = frame.displayTransform(for: orientation, viewportSize: size)
        func viewPoint(_ point: CGPoint) -> CGPoint {
            let display = point.applying(transform)
            return CGPoint(x: display.x * size.width, y: display.y * size.height)
        }
        for layer in uiView.layer.sublayers ?? [] {
            guard let shape = layer as? CAShapeLayer else { continue }
            let points = shape.name == "proposal" ? contour : showBox
                ? [CGPoint(x: 0.25, y: 0.25), CGPoint(x: 0.75, y: 0.25),
                   CGPoint(x: 0.75, y: 0.75), CGPoint(x: 0.25, y: 0.75)] : []
            let path = UIBezierPath()
            if let first = points.first {
                path.move(to: viewPoint(first))
                for point in points.dropFirst() { path.addLine(to: viewPoint(point)) }
                path.close()
            }
            shape.path = path.cgPath
        }
    }
}

private struct CaptureExport: Identifiable {
    let id = UUID()
    let url: URL
}

private struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
