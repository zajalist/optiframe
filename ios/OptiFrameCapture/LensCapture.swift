import ARKit
import Combine
import Foundation
import ZIPFoundation

enum LensSide: String, CaseIterable, Identifiable, Codable {
    case left, right
    var id: String { rawValue }
}

enum FrameKind: String, CaseIterable, Identifiable, Codable {
    case empty, lens, arc
    var id: String { rawValue }
    var title: String {
        switch self {
        case .empty: "Empty sheet"
        case .lens: "Lens on sheet"
        case .arc: "Depth arc"
        }
    }
}

struct CapturedFrame: Codable {
    let side: LensSide
    let kind: FrameKind
    let original: String
    let enhanced: String
    let depth: String?
    let confidence: String?
    let depthWidth: Int?
    let depthHeight: Int?
    let timestamp: TimeInterval
    let imageWidth: Int
    let imageHeight: Int
    let cameraToWorldColumnMajor: [Float]
    let intrinsicsColumnMajor: [Float]
    let trackingValid: Bool
    let sharpness: Double
    let clippedFraction: Double
}

struct CaptureManifest: Codable {
    let schemaVersion: Int
    let worldUnits: String
    let note: String
    let frames: [CapturedFrame]
}

struct DepthPoint {
    let position: SIMD3<Float>
    let confidence: UInt8
}

final class LensCapture: NSObject, ObservableObject, ARSessionDelegate {
    let session = ARSession()
    @Published private(set) var status = "Aim at a marked sheet; keep lens and sheet still."
    @Published private(set) var frameCount = 0
    @Published private(set) var depthAvailable = false

    private let queue = DispatchQueue(label: "optiframe.capture.processing")
    private let processor = FrameProcessor()
    private var folder: URL?
    private var records: [CapturedFrame] = []
    private var points: [DepthPoint] = []

    func start() {
        guard ARWorldTrackingConfiguration.isSupported else {
            status = "ARKit world tracking is unavailable on this iPhone."
            return
        }
        let configuration = ARWorldTrackingConfiguration()
        let hasDepth = ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
        if hasDepth { configuration.frameSemantics.insert(.sceneDepth) }
        depthAvailable = hasDepth
        session.delegate = self
        session.delegateQueue = queue
        session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
        status = hasDepth
            ? "LiDAR ready. Capture empty and lens views, then a slow upright arc."
            : "Capture empty and lens views. Depth requires a LiDAR iPhone."
    }

    func stop() { session.pause() }

    func newLens() {
        queue.async { [self] in
            records.removeAll()
            points.removeAll()
            folder = nil
            DispatchQueue.main.async {
                self.frameCount = 0
                self.start()
            }
        }
    }

    func capture(side: LensSide, kind: FrameKind) {
        guard let frame = session.currentFrame else {
            status = "Camera is starting. Try again."
            return
        }
        status = "Saving frame…"
        queue.async { [self] in
            do {
                if let first = records.first, first.side != side {
                    DispatchQueue.main.async {
                        self.status = "Export the \(first.side.rawValue) lens before capturing the other side."
                    }
                    return
                }
                let folder = try workingFolder()
                let index = records.count + 1
                let result = try processor.save(frame: frame, side: side, kind: kind,
                                                index: index, folder: folder)
                records.append(result.frame)
                if kind == .arc { points.append(contentsOf: result.points) }
                let emptyClipping = records.first { $0.kind == .empty }?.clippedFraction ?? 0
                DispatchQueue.main.async {
                    self.frameCount = index
                    self.status = result.frame.clippedFraction > max(0.25, emptyClipping + 0.08)
                        ? "Saved. Bright clipping rose; try another angle."
                        : "Saved. Take another angle or export."
                }
            } catch {
                DispatchQueue.main.async { self.status = "Capture failed: \(error.localizedDescription)" }
            }
        }
    }

    func export(completion: @escaping (URL?) -> Void) {
        status = "Packaging capture…"
        queue.async { [self] in
            do {
                guard !records.isEmpty else { throw CaptureError.noFrames }
                let folder = try workingFolder()
                let manifest = CaptureManifest(
                    schemaVersion: 1,
                    worldUnits: "meters",
                    note: "Raw scene depth can be missing on transparent lenses or belong to the background. Do not use this cloud as a measured lens surface without validation.",
                    frames: records
                )
                let encoder = JSONEncoder()
                encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
                try encoder.encode(manifest).write(to: folder.appendingPathComponent("manifest.json"))
                if !points.isEmpty { try savePLY(to: folder.appendingPathComponent("raw-cloud.ply")) }
                let zip = FileManager.default.temporaryDirectory
                    .appendingPathComponent("optiframe-\(UUID().uuidString).zip")
                try FileManager.default.zipItem(at: folder, to: zip, shouldKeepParent: false)
                DispatchQueue.main.async {
                    self.status = "Capture exported. The contour still needs scale and review."
                    completion(zip)
                }
            } catch {
                DispatchQueue.main.async {
                    self.status = "Export failed: \(error.localizedDescription)"
                    completion(nil)
                }
            }
        }
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        DispatchQueue.main.async { self.status = "ARKit error: \(error.localizedDescription)" }
    }

    private func workingFolder() throws -> URL {
        if let folder { return folder }
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("optiframe-capture-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        folder = url
        return url
    }

    private func savePLY(to url: URL) throws {
        var text = "ply\nformat ascii 1.0\nelement vertex \(points.count)\n"
        text += "property float x\nproperty float y\nproperty float z\nproperty uchar confidence\nend_header\n"
        for point in points {
            let p = point.position
            text += "\(p.x) \(p.y) \(p.z) \(point.confidence)\n"
        }
        try text.write(to: url, atomically: true, encoding: .utf8)
    }
}

private enum CaptureError: Error { case noFrames }
