import ARKit
import SceneKit
import SwiftUI

struct CaptureView: View {
    @StateObject private var capture = LensCapture()
    @State private var side = LensSide.left
    @State private var kind = FrameKind.lens
    @State private var export: CaptureExport?

    var body: some View {
        VStack(spacing: 12) {
            CameraPreview(session: capture.session)
                .frame(maxHeight: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 16))

            Picker("Lens", selection: $side) {
                ForEach(LensSide.allCases) { value in Text(value.rawValue).tag(value) }
            }
            .pickerStyle(.segmented)

            Picker("View", selection: $kind) {
                ForEach(FrameKind.allCases) { value in Text(value.title).tag(value) }
            }
            .pickerStyle(.segmented)

            Text(capture.status)
                .font(.footnote)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text("\(capture.frameCount) frames · \(capture.depthAvailable ? "LiDAR depth on" : "images + poses")")
                .font(.footnote)
                .frame(maxWidth: .infinity, alignment: .leading)

            HStack {
                Button("Capture frame") { capture.capture(side: side, kind: kind) }
                    .buttonStyle(.borderedProminent)
                Button("Export") {
                    capture.export { url in
                        if let url { export = CaptureExport(url: url) }
                    }
                }
                .buttonStyle(.bordered)
                .disabled(capture.frameCount == 0)
            }
        }
        .padding()
        .onAppear { capture.start() }
        .onDisappear { capture.stop() }
        .sheet(item: $export) { item in ShareSheet(url: item.url) }
    }
}

private struct CameraPreview: UIViewRepresentable {
    let session: ARSession

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView()
        view.session = session
        view.automaticallyUpdatesLighting = false
        return view
    }

    func updateUIView(_ uiView: ARSCNView, context: Context) {}
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
