import ARKit
import AVFoundation
import Combine
import Foundation

/// A separate, opt-in front-camera session. No face images or meshes are saved.
final class FaceFitCapture: NSObject, ObservableObject, ARSessionDelegate {
    let session = ARSession()
    let supported = ARFaceTrackingConfiguration.isSupported
    let trueDepthAvailable = AVCaptureDevice.default(.builtInTrueDepthCamera,
                                                     for: .video, position: .front) != nil
    @Published private(set) var status = "Look straight ahead"
    @Published private(set) var progress = 0.0
    @Published private(set) var result: FaceFitMeasurements?
    @Published private(set) var exportURL: URL?
    private var window = FaceFitWindow()
    private var faceID: UUID?
    private var active = false
    private var thermalObserver: NSObjectProtocol?
    private var generation = 0

    override init() {
        super.init()
        session.delegate = self
        session.delegateQueue = .main
        thermalObserver = NotificationCenter.default.addObserver(
            forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.thermalChanged() }
    }
    deinit {
        if let thermalObserver { NotificationCenter.default.removeObserver(thermalObserver) }
        session.pause()
    }

    func start() {
        active = true
        generation += 1
        let current = generation
        guard supported else { status = "Use manual measurements on this device"; return }
        guard !tooWarm else { status = "Phone too warm. Let it cool"; return }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: run()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in
                DispatchQueue.main.async {
                    guard let self, self.active, self.generation == current else { return }
                    if allowed { self.run() }
                    else { self.status = "Allow Camera in Settings, or use manual measurements" }
                }
            }
        default: status = "Allow Camera in Settings, or use manual measurements"
        }
    }

    func stop() {
        active = false
        generation += 1
        session.pause()
        resetWindow()
    }

    func retry() {
        if let exportURL { try? FileManager.default.removeItem(at: exportURL) }
        exportURL = nil
        result = nil
        start()
    }

    private var tooWarm: Bool {
        let thermal = ProcessInfo.processInfo.thermalState
        return thermal == .serious || thermal == .critical
    }
    private var thermalName: String {
        switch ProcessInfo.processInfo.thermalState {
        case .nominal: "nominal"
        case .fair: "fair"
        case .serious: "serious"
        case .critical: "critical"
        @unknown default: "unknown"
        }
    }
    private func thermalChanged() {
        guard active, result == nil else { return }
        if tooWarm {
            session.pause()
            resetWindow()
            status = "Phone too warm. Let it cool"
        } else if AVCaptureDevice.authorizationStatus(for: .video) == .authorized {
            run()
        }
    }
    private func run() {
        guard active, supported, !tooWarm, result == nil else { return }
        resetWindow()
        let configuration = ARFaceTrackingConfiguration()
        configuration.maximumNumberOfTrackedFaces = min(2, ARFaceTrackingConfiguration.supportedNumberOfTrackedFaces)
        configuration.isLightEstimationEnabled = true
        session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
        status = "Look straight ahead"
    }
    private func resetWindow() {
        window.reset()
        faceID = nil
        progress = 0
    }
    private func reject(_ message: String) {
        resetWindow()
        status = message
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard active, result == nil else { return }
        guard !tooWarm else { thermalChanged(); return }
        guard case .normal = frame.camera.trackingState else { reject("Hold still"); return }
        let faces = frame.anchors.compactMap { $0 as? ARFaceAnchor }.filter(\.isTracked)
        guard faces.count == 1, let face = faces.first else {
            reject(faces.isEmpty ? "Bring your face into view" : "One person at a time"); return
        }
        if faceID != face.identifier { resetWindow(); faceID = face.identifier }
        let faceInCamera = simd_inverse(frame.camera.transform) * face.transform
        let translation = faceInCamera.columns.3
        let position = SIMD3<Float>(translation.x, translation.y, translation.z)
        let distance = simd_length(position)
        guard distance.isFinite, distance >= 0.30 else { reject("Move farther away"); return }
        guard distance <= 0.65 else { reject("Move closer"); return }
        let axis = faceInCamera.columns.2
        let normal = SIMD3<Float>(axis.x, axis.y, axis.z)
        // Pose relative to the camera, independent of display orientation and roll.
        guard simd_dot(simd_normalize(normal), simd_normalize(-position)) >= cos(Float.pi / 15) else {
            reject("Face the camera"); return
        }
        let blink = max(face.blendShapes[.eyeBlinkLeft]?.doubleValue ?? 1,
                        face.blendShapes[.eyeBlinkRight]?.doubleValue ?? 1)
        guard blink < 0.15, (face.blendShapes[.jawOpen]?.doubleValue ?? 1) < 0.2 else {
            reject("Relax your face and keep your eyes open"); return
        }
        if let light = frame.lightEstimate, light.ambientIntensity < 150 {
            reject("Use brighter, even light"); return
        }
        guard let sample = FaceFitWindow.sample(timestamp: frame.timestamp,
            leftXMetres: Double(face.leftEyeTransform.columns.3.x),
            rightXMetres: Double(face.rightEyeTransform.columns.3.x)) else {
            reject("Tracking unclear. Hold still"); return
        }
        window.append(sample)
        progress = min(1, Double(window.samples.count) / Double(FaceFitWindow.requiredSamples))
        status = "Hold still"
        guard let estimate = window.result else { return }
        let record = FaceFitExport(createdAt: Date(), measurements: estimate,
            quality: .init(sampleCount: window.samples.count, durationSeconds: window.duration,
                           leftStdDevMm: window.leftStdDevMm, rightStdDevMm: window.rightStdDevMm,
                           thermalState: thermalName),
            capability: .init(faceTrackingSupported: supported, trueDepthAvailable: trueDepthAvailable),
            samples: window.samples)
        do {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            encoder.dateEncodingStrategy = .iso8601
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("OptiFrame-face-fit-\(UUID().uuidString).json")
            try encoder.encode(record).write(to: url, options: [.atomic, .completeFileProtection])
            result = estimate
            exportURL = url
            status = "Estimate ready"
            session.pause()
        } catch {
            reject("Could not save. Try again")
        }
    }

    func sessionWasInterrupted(_ session: ARSession) { reject("Camera interrupted. Return to try again") }
    func sessionInterruptionEnded(_ session: ARSession) { if active { run() } }
    func session(_ session: ARSession, didFailWithError error: Error) {
        resetWindow()
        status = "Camera unavailable. Retry or use manual measurements"
    }
}
