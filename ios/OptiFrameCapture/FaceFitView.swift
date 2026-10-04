import ARKit
import SceneKit
import SwiftUI

struct FaceFitView: View {
    @StateObject private var capture = FaceFitCapture()
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                if let result = capture.result {
                    Spacer()
                    Text("Review measurements").font(.title2.weight(.semibold))
                    HStack(spacing: 32) {
                        measurement("Left", result.leftMonocularEstimateMm)
                        measurement("Right", result.rightMonocularEstimateMm)
                    }
                    Text("TrueDepth-assisted eye-position estimate. Review does not verify optical accuracy.")
                        .font(.callout).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    Spacer()
                    if let url = capture.exportURL {
                        ShareLink("Export measurements", item: url)
                            .buttonStyle(.borderedProminent).controlSize(.large)
                    } else {
                        Button("Confirm measurements") { capture.confirmMeasurements() }
                            .buttonStyle(.borderedProminent).controlSize(.large)
                    }
                    Text(capture.status).font(.footnote).foregroundStyle(.secondary)
                    Button("Retry") { capture.retry() }.buttonStyle(.bordered)
                } else if capture.depthMeasurementSupported {
                    FaceFitPreview(session: capture.session)
                        .clipShape(RoundedRectangle(cornerRadius: 20))
                        .frame(maxHeight: .infinity)
                        .accessibilityLabel("Front camera face preview")
                    Text(capture.status).font(.headline).multilineTextAlignment(.center)
                        .accessibilityAddTraits(.updatesFrequently)
                    ProgressView(value: capture.progress).tint(.primary)
                        .accessibilityLabel("Stable face capture")
                    Text("Face the camera. Review the estimate when capture completes.")
                        .font(.footnote).foregroundStyle(.secondary)
                    Button("Retry") { capture.retry() }.buttonStyle(.bordered)
                } else {
                    Spacer()
                    Text("TrueDepth required").font(.title2.weight(.semibold))
                    Text("Use an iPhone with a front TrueDepth camera, or enter measured values on the website.")
                        .foregroundStyle(.secondary).multilineTextAlignment(.center)
                    Spacer()
                }
                Button("Use manual measurements") { dismiss() }
                    .frame(minHeight: 44)
            }
            .padding(20)
            .navigationTitle("TrueDepth scan")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
        }
        .onAppear { capture.start() }
        .onDisappear { capture.stop() }
        .onChange(of: phase) { _, value in
            if value == .active { capture.start() } else { capture.stop() }
        }
    }

    private func measurement(_ name: String, _ value: Double) -> some View {
        VStack(spacing: 4) {
            Text(name).font(.subheadline).foregroundStyle(.secondary)
            Text("\(value, specifier: "%.1f") mm").font(.title2.monospacedDigit())
        }
    }
}

private struct FaceFitPreview: UIViewRepresentable {
    let session: ARSession
    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView()
        view.session = session
        view.automaticallyUpdatesLighting = false
        return view
    }
    func updateUIView(_ uiView: ARSCNView, context: Context) {}
}
