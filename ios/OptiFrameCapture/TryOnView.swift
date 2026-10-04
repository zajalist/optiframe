import ARKit
import SwiftUI
import UniformTypeIdentifiers

struct TryOnView: View {
    @StateObject private var capture = TryOnCapture()
    @State private var importing = false
    @State private var importError: String?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                if capture.supported {
                    ZStack {
                        TryOnCamera(capture: capture)
                        if !capture.hasFrame {
                            ContentUnavailableView("Your frame, on you", systemImage: "eyeglasses",
                                description: Text("Import the iPhone preview from the website."))
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 28))
                    .frame(maxHeight: .infinity)
                    .accessibilityLabel("Live face-anchored frame preview")
                    Text(capture.status).font(.callout).frame(minHeight: 22)
                    Text("Visual try-on · not a fit or prescription check")
                        .font(.caption).foregroundStyle(.secondary)
                    HStack {
                        if capture.hasFrame { Button("Retry") { capture.start() }.buttonStyle(.bordered) }
                        Button(capture.hasFrame ? "Change frame" : "Import frame") { importing = true }
                            .buttonStyle(.borderedProminent)
                    }.controlSize(.large)
                } else {
                    ContentUnavailableView("Face tracking unavailable", systemImage: "faceid",
                        description: Text("Use the website's visual preview on this device."))
                }
            }
            .padding(16)
            .background(Color(white: 0.065))
            .navigationTitle("Try on")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
        }
        .preferredColorScheme(.dark)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
            do { try capture.importFrame(result.get()); capture.start() }
            catch { importError = error.localizedDescription }
        }
        .alert("Couldn't open frame", isPresented: Binding(
            get: { importError != nil }, set: { if !$0 { importError = nil } }
        )) { Button("OK", role: .cancel) { importError = nil } }
        message: { Text(importError ?? "Choose another frame file.") }
        .onAppear { capture.start() }
        .onDisappear { capture.stop() }
        .onChange(of: phase) { _, value in
            if value == .active { capture.start() } else { capture.stop() }
        }
    }
}

private struct TryOnCamera: UIViewRepresentable {
    let capture: TryOnCapture
    func makeUIView(context: Context) -> ARSCNView { capture.view }
    func updateUIView(_ uiView: ARSCNView, context: Context) {}
}
