import ARKit
import AVFoundation
import Combine
import SceneKit
import UIKit

/// Local visual placement only. No camera images, face mesh or eye transforms are retained/exported.
final class TryOnCapture: NSObject, ObservableObject, ARSessionDelegate {
    let view = ARSCNView()
    let supported = ARFaceTrackingConfiguration.isSupported
    @Published private(set) var status = "Import a frame"
    @Published private(set) var hasFrame = false
    private let faceNode = SCNNode()
    private let frameNode = SCNNode()
    private var occlusion: ARSCNFaceGeometry?
    private var active = false
    private var generation = 0
    private var thermalObserver: NSObjectProtocol?

    override init() {
        super.init()
        view.session.delegate = self
        view.session.delegateQueue = .main
        view.scene = SCNScene()
        view.automaticallyUpdatesLighting = true
        view.autoenablesDefaultLighting = true
        view.scene.rootNode.addChildNode(faceNode)
        faceNode.addChildNode(frameNode)
        faceNode.isHidden = true
        if let device = view.device, let geometry = ARSCNFaceGeometry(device: device) {
            let material = SCNMaterial()
            material.colorBufferWriteMask = []
            material.writesToDepthBuffer = true
            geometry.materials = [material]
            let mask = SCNNode(geometry: geometry)
            mask.renderingOrder = -1
            faceNode.addChildNode(mask)
            occlusion = geometry
        }
        thermalObserver = NotificationCenter.default.addObserver(
            forName: ProcessInfo.thermalStateDidChangeNotification, object: nil, queue: .main
        ) { [weak self] _ in
            guard let self, self.active else { return }
            if self.tooWarm { self.pause("Phone too warm. Let it cool") }
            else if AVCaptureDevice.authorizationStatus(for: .video) == .authorized { self.run() }
        }
    }
    deinit {
        if let thermalObserver { NotificationCenter.default.removeObserver(thermalObserver) }
        view.session.pause()
    }

    func importFrame(_ url: URL) throws {
        let model = try TryOnModel.load(url)
        // Build fully before replacing the visible frame: failed imports leave the prior model intact.
        let nodes = model.meshes.map { mesh -> SCNNode in
            let vectors = mesh.vertices.map { model.facePoint($0) }
            let positions = vectors.map { SCNVector3($0.x, $0.y, $0.z) }
            let faces = mesh.faces.map { [$0[0], $0[2], $0[1]] }
            let indices = faces.flatMap { $0.map(Int32.init) }
            var normals = Array(repeating: SIMD3<Float>(repeating: 0), count: vectors.count)
            for face in faces {
                let normal = simd_cross(vectors[face[1]] - vectors[face[0]], vectors[face[2]] - vectors[face[0]])
                for index in face { normals[index] += normal }
            }
            let normalVectors = normals.map { value -> SCNVector3 in
                let normal = simd_length_squared(value) > 1e-16 ? simd_normalize(value) : SIMD3<Float>(0, 0, 1)
                return SCNVector3(normal.x, normal.y, normal.z)
            }
            let geometry = SCNGeometry(sources: [SCNGeometrySource(vertices: positions), SCNGeometrySource(normals: normalVectors)],
                                      elements: [SCNGeometryElement(indices: indices, primitiveType: .triangles)])
            let material = SCNMaterial()
            material.lightingModel = .physicallyBased
            material.diffuse.contents = mesh.kind == "lens" ? UIColor(white: 0.85, alpha: 0.13) : UIColor(white: 0.16, alpha: 1)
            material.roughness.contents = mesh.kind == "lens" ? 0.08 : 0.38
            material.metalness.contents = 0.15
            material.isDoubleSided = true
            if mesh.kind == "lens" { material.writesToDepthBuffer = false }
            geometry.materials = [material]
            let node = SCNNode(geometry: geometry)
            node.name = mesh.name
            return node
        }
        frameNode.childNodes.forEach { $0.removeFromParentNode() }
        nodes.forEach { frameNode.addChildNode($0) }
        hasFrame = true
        status = "Face the camera"
    }

    func start() {
        active = true; generation += 1
        let current = generation
        guard supported else { status = "Face tracking unavailable on this iPhone"; return }
        guard hasFrame else { status = "Import a frame"; return }
        guard !tooWarm else { pause("Phone too warm. Let it cool"); return }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: run()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in
                DispatchQueue.main.async {
                    guard let self, self.active, self.generation == current else { return }
                    if allowed { self.run() } else { self.status = "Allow Camera in Settings" }
                }
            }
        default: status = "Allow Camera in Settings"
        }
    }

    func stop() { active = false; generation += 1; pause("Camera paused") }
    private var tooWarm: Bool {
        let state = ProcessInfo.processInfo.thermalState
        return state == .serious || state == .critical
    }
    private func pause(_ message: String) {
        view.session.pause(); faceNode.isHidden = true; status = message
    }
    private func run() {
        guard active, hasFrame, supported, !tooWarm else { return }
        faceNode.isHidden = true
        let configuration = ARFaceTrackingConfiguration()
        configuration.maximumNumberOfTrackedFaces = 1
        configuration.isLightEstimationEnabled = true
        view.session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
        status = "Face the camera"
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        guard active, hasFrame, !tooWarm else { faceNode.isHidden = true; return }
        guard case .normal = frame.camera.trackingState,
              let face = frame.anchors.compactMap({ $0 as? ARFaceAnchor }).first,
              face.isTracked else {
            faceNode.isHidden = true
            if status != "Face the camera" { status = "Face the camera" }
            return
        }
        faceNode.simdTransform = face.transform
        let left = face.leftEyeTransform.columns.3, right = face.rightEyeTransform.columns.3
        // Keep imported physical dimensions. Eye midpoint controls visual placement, not CAD fitting.
        frameNode.simdPosition = SIMD3((left.x + right.x) / 2, (left.y + right.y) / 2,
                                      (left.z + right.z) / 2 + 0.018)
        occlusion?.update(from: face.geometry)
        faceNode.isHidden = false
        if !status.isEmpty { status = "" }
    }
    func sessionWasInterrupted(_ session: ARSession) { pause("Camera interrupted") }
    func sessionInterruptionEnded(_ session: ARSession) { if active { start() } }
    func session(_ session: ARSession, didFailWithError error: Error) {
        pause("Camera unavailable. Tap Retry")
    }
}
