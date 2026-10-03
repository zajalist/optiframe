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

enum CaptureMode: String, CaseIterable, Identifiable {
    case empty, photo, outlineVideo, depthArc, liveSegmentation
    var id: String { rawValue }
    var title: String {
        switch self {
        case .empty: "Empty sheet"
        case .photo: "Lens photo"
        case .outlineVideo: "Outline video burst"
        case .depthArc: "Depth arc"
        case .liveSegmentation: "Live segmentation"
        }
    }
    var frameKind: FrameKind {
        switch self {
        case .empty: .empty
        case .photo, .outlineVideo, .liveSegmentation: .lens
        case .depthArc: .arc
        }
    }
    var isSequence: Bool { self == .outlineVideo || self == .depthArc }
    static let sequenceAttempts = 12
    static let interval: TimeInterval = 0.75
}

struct FrameReview: Identifiable {
    let id: Int
    let originalURL: URL
    let kind: FrameKind
    let sharpness: Double
    let clippedFraction: Double
    let hasDepth: Bool
}

struct ProposalGeneration {
    private var value = 0
    mutating func invalidate() -> Int {
        value += 1
        return value
    }
    func accepts(_ generation: Int) -> Bool { generation == value }
}

struct CapturedFrame: Codable {
    // JPEGs remain in ARKit sensor coordinates so depth and intrinsics align.
    var imageOrientation = "sensor-landscape-right"
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
    @Published private(set) var isBusy = false
    @Published private(set) var isRecording = false
    @Published private(set) var sequenceAttempt = 0
    @Published private(set) var reviewFrames: [FrameReview] = []
    @Published private(set) var liveContour: [CGPoint] = []
    @Published private(set) var liveProposalJPEG: Data?
    @Published private(set) var segmentationStatus = "Configure an HTTPS GPU server to start live proposals."
    private var segmentationTask: URLSessionDataTask?
    private let segmentationSession = URLSession(configuration: .ephemeral,
        delegate: CaptureRedirectGuard(), delegateQueue: nil)
    private var segmentationGeneration = 0
    // Accessed only on main: queued UI updates must match the latest user action.
    private var segmentationPublicationGeneration = ProposalGeneration()
    private var segmentationURL: URL?
    private var segmentationToken = ""
    private var lastSegmentationTime: TimeInterval = 0
    private var segmentationPending = false
    private var sequenceTimer: Timer?

    var bestLensFrame: FrameReview? {
        reviewFrames.filter { $0.kind == .lens }.max {
            $0.sharpness / (1 + 10 * $0.clippedFraction)
                < $1.sharpness / (1 + 10 * $1.clippedFraction)
        }
    }

    func beginSequence(side: LensSide, mode: CaptureMode) {
        guard mode.isSequence, !isBusy, !isRecording else { return }
        guard !needsNewLens else {
            status = "Tracking was interrupted. Export existing frames, then tap New lens."
            return
        }
        guard frameCount < Self.maximumFrames else {
            status = "60-frame limit reached. Export this lens before starting another."
            return
        }
        isRecording = true
        sequenceAttempt = 0
        sequenceTimer = Timer.scheduledTimer(withTimeInterval: CaptureMode.interval,
                                             repeats: true) { [weak self] _ in
            guard let self else { return }
            self.sequenceAttempt += 1
            if !self.isBusy { self.capture(side: side, kind: mode.frameKind) }
            if self.sequenceAttempt >= CaptureMode.sequenceAttempts
                || self.frameCount >= Self.maximumFrames {
                self.endSequence()
            }
        }
        status = "Recording a short sequence. Keep markers visible and move slowly."
    }

    func endSequence() {
        sequenceTimer?.invalidate()
        sequenceTimer = nil
        isRecording = false
        if !isBusy { status = "Sequence stopped. Review the originals before export." }
    }

    deinit { sequenceTimer?.invalidate(); segmentationSession.invalidateAndCancel() }

    private let queue = DispatchQueue(label: "optiframe.capture.processing")
    private let delegateQueue = DispatchQueue(label: "optiframe.capture.session")
    private let segmentationFrameGate = DispatchSemaphore(value: 1)
    private let processor = FrameProcessor()
    private var folder: URL?
    private var records: [CapturedFrame] = []
    private var points: [DepthPoint] = []
    private var configured = false
    private var needsNewLens = false
    static let maximumFrames = 60

    func start() {
        if configured, let configuration = session.configuration {
            session.run(configuration)
            return
        }
        guard ARWorldTrackingConfiguration.isSupported else {
            status = "ARKit world tracking is unavailable on this iPhone."
            return
        }
        let configuration = ARWorldTrackingConfiguration()
        let hasDepth = ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
        if hasDepth { configuration.frameSemantics.insert(.sceneDepth) }
        depthAvailable = hasDepth
        session.delegate = self
        session.delegateQueue = delegateQueue
        session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
        configured = true
        status = hasDepth
            ? "LiDAR ready. Capture empty and lens views, then a slow upright arc."
            : "Capture empty and lens views. Depth requires a LiDAR iPhone."
    }

    func stop() { endSequence(); stopSegmentation(); session.pause() }

    func startSegmentation(server: String, token: String) {
        guard let url = URL(string: server.trimmingCharacters(in: .whitespacesAndNewlines)),
              url.scheme?.lowercased() == "https", url.host != nil,
              url.user == nil, url.password == nil else {
            segmentationStatus = "Enter an HTTPS server URL without embedded credentials."
            return
        }
        let endpoint = url.appendingPathComponent("api/segment")
        let generation = segmentationPublicationGeneration.invalidate()
        liveContour = []
        liveProposalJPEG = nil
        queue.async {
            self.segmentationGeneration = generation
            self.segmentationTask?.cancel()
            self.segmentationURL = endpoint
            self.segmentationToken = token
            self.segmentationPending = false
            self.lastSegmentationTime = 0
        }
        segmentationStatus = "Remote GPU proposals starting. Keep the lens in the central box."
    }

    func stopSegmentation() {
        let generation = segmentationPublicationGeneration.invalidate()
        queue.async {
            self.segmentationGeneration = generation
            self.segmentationTask?.cancel()
            self.segmentationTask = nil
            self.segmentationURL = nil
            self.segmentationToken = ""
            self.segmentationPending = false
        }
        liveContour = []
        liveProposalJPEG = nil
        segmentationStatus = "Live proposals stopped."
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        // Never queue camera buffers behind disk writes or inference work.
        guard segmentationFrameGate.wait(timeout: .now()) == .success else { return }
        queue.async {
            defer { self.segmentationFrameGate.signal() }
            self.processSegmentationFrame(frame)
        }
    }

    private func processSegmentationFrame(_ frame: ARFrame) {
        // Processing state is confined to this queue; at most one request is in flight.
        guard let endpoint = segmentationURL, !segmentationPending,
              frame.timestamp - lastSegmentationTime >= 0.75,
              case .normal = frame.camera.trackingState else { return }
        lastSegmentationTime = frame.timestamp
        let generation = segmentationGeneration
        do {
            let sample = try processor.segmentationJPEG(frame: frame)
            let boundary = "OptiFrame-\(UUID().uuidString)"
            let box = "[\(sample.width / 4),\(sample.height / 4),\(3 * sample.width / 4),\(3 * sample.height / 4)]"
            var body = Data()
            func add(_ value: String) { body.append(Data(value.utf8)) }
            add("--\(boundary)\r\nContent-Disposition: form-data; name=\"image\"; filename=\"live.jpg\"\r\nContent-Type: image/jpeg\r\n\r\n")
            body.append(sample.data)
            add("\r\n--\(boundary)\r\nContent-Disposition: form-data; name=\"box\"\r\n\r\n\(box)")
            add("\r\n--\(boundary)\r\nContent-Disposition: form-data; name=\"use_gpu\"\r\n\r\ntrue\r\n--\(boundary)--\r\n")
            var request = URLRequest(url: endpoint)
            request.httpMethod = "POST"
            request.httpBody = body
            request.timeoutInterval = 12
            request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            if !segmentationToken.isEmpty {
                request.setValue(segmentationToken, forHTTPHeaderField: "x-optiframe-key")
            }
            segmentationPending = true
            let started = Date()
            segmentationTask = segmentationSession.dataTask(with: request) { data, response, error in
                self.queue.async {
                    guard generation == self.segmentationGeneration else { return }
                    self.segmentationPending = false
                    self.segmentationTask = nil
                    var contour: [CGPoint] = []
                    let message: String
                    if error != nil {
                        message = "Remote request failed. Check the server connection."
                    } else if (response as? HTTPURLResponse)?.statusCode != 200 {
                        message = "GPU server rejected the request (\((response as? HTTPURLResponse)?.statusCode ?? 0)). Check URL and access key."
                    } else if let data,
                              let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                              let candidates = result["candidates"] as? [[String: Any]],
                              let points = candidates.first(where: { $0["contour"] != nil })?["contour"] as? [[Double]] {
                        contour = points.compactMap { point in
                            guard point.count == 2, point.allSatisfy({ $0.isFinite }),
                                  point[0] >= 0, point[0] <= Double(sample.width),
                                  point[1] >= 0, point[1] <= Double(sample.height) else { return nil }
                            return CGPoint(x: point[0] / Double(sample.width), y: point[1] / Double(sample.height))
                        }
                        message = "Remote GPU proposal · \(String(format: "%.1f", Date().timeIntervalSince(started))) s latency · review required"
                    } else {
                        message = "No GPU contour returned. Keep the full rim in the central box."
                    }
                    DispatchQueue.main.async {
                        guard self.segmentationPublicationGeneration.accepts(generation) else { return }
                        self.liveContour = contour
                        self.liveProposalJPEG = contour.count >= 3 ? sample.data : nil
                        self.segmentationStatus = message
                    }
                }
            }
            segmentationTask?.resume()
        } catch {
            DispatchQueue.main.async {
                guard self.segmentationPublicationGeneration.accepts(generation) else { return }
                self.segmentationStatus = "Could not encode live camera frame."
            }
        }
    }

    func newLens() {
        guard !isBusy, !isRecording else { return }
        stopSegmentation()
        isBusy = true
        queue.async { [self] in
            records.removeAll()
            points.removeAll()
            if let folder { try? FileManager.default.removeItem(at: folder) }
            folder = nil
            DispatchQueue.main.async {
                self.frameCount = 0
                self.reviewFrames = []
                self.isBusy = false
                self.needsNewLens = false
                self.configured = false
                self.start()
            }
        }
    }

    func capture(side: LensSide, kind: FrameKind) {
        guard !isBusy else { return }
        guard !needsNewLens else {
            status = "Tracking was interrupted. Export existing frames, then tap New lens."
            return
        }
        guard frameCount < Self.maximumFrames else {
            status = "60-frame limit reached. Export this lens before starting another."
            return
        }
        guard let frame = session.currentFrame else {
            status = "Camera is starting. Try again."
            return
        }
        guard case .normal = frame.camera.trackingState else {
            status = "Move slowly over the patterned sheet until tracking is ready."
            return
        }
        isBusy = true
        status = "Saving frame…"
        queue.async { [self] in
            do {
                if let first = records.first, first.side != side {
                    DispatchQueue.main.async {
                        self.endSequence()
                        self.isBusy = false
                        self.status = "Export the \(first.side.rawValue) lens before capturing the other side."
                    }
                    return
                }
                let folder = try workingFolder()
                let index = records.count + 1
                let result = try autoreleasepool {
                    try processor.save(frame: frame, side: side, kind: kind,
                                       index: index, folder: folder)
                }
                do {
                    // ZIPFoundation currently stores entries without compression. Leave room
                    // for manifest, PLY and archive headers beneath the 90 MB export cap.
                    let files = try FileManager.default.contentsOfDirectory(
                        at: folder, includingPropertiesForKeys: [.fileSizeKey])
                    var bytes: UInt64 = 0
                    for file in files where file.pathExtension != "json" && file.pathExtension != "ply" {
                        let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize
                        guard let size, size >= 0 else { throw CaptureError.fileSize }
                        bytes += UInt64(size)
                    }
                    let cloudCount = points.count + (kind == .arc ? result.points.count : 0)
                    // Float32 textual coordinates use <= 24 bytes each; 96 bytes per
                    // vertex bounds coordinate/confidence/newline overhead conservatively.
                    try ArchiveBudget.validateCapture(fileBytes: bytes, cloudPoints: cloudCount)
                } catch {
                    for path in [result.frame.original, result.frame.enhanced,
                                 result.frame.depth, result.frame.confidence].compactMap({ $0 }) {
                        try? FileManager.default.removeItem(at: folder.appendingPathComponent(path))
                    }
                    throw error
                }
                records.append(result.frame)
                if kind == .arc { points.append(contentsOf: result.points) }
                let emptyClipping = records.first { $0.kind == .empty }?.clippedFraction ?? 0
                DispatchQueue.main.async {
                    self.isBusy = false
                    self.frameCount = index
                    self.reviewFrames.append(FrameReview(
                        id: index, originalURL: folder.appendingPathComponent(result.frame.original),
                        kind: kind, sharpness: result.frame.sharpness,
                        clippedFraction: result.frame.clippedFraction,
                        hasDepth: result.frame.depth != nil))
                    self.status = result.frame.clippedFraction > max(0.25, emptyClipping + 0.08)
                        ? "Saved. Bright clipping rose; try another angle."
                        : "Saved. Take another angle or export."
                }
            } catch {
                DispatchQueue.main.async {
                    self.endSequence()
                    self.isBusy = false
                    self.status = "Capture failed: \(error.localizedDescription)"
                }
            }
        }
    }

    func export(completion: @escaping (URL?) -> Void) {
        guard !isBusy, !isRecording else { return }
        isBusy = true
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
                let files = try FileManager.default.contentsOfDirectory(
                    at: folder, includingPropertiesForKeys: [.fileSizeKey])
                let sizes = try files.map { url -> UInt64 in
                    let values = try url.resourceValues(forKeys: [.fileSizeKey])
                    guard let size = values.fileSize, size >= 0 else { throw CaptureError.fileSize }
                    return UInt64(size)
                }
                try ArchiveBudget.validateExpanded(fileSizes: sizes)
                let zip = FileManager.default.temporaryDirectory
                    .appendingPathComponent("optiframe-\(UUID().uuidString).zip")
                var keepZIP = false
                defer { if !keepZIP { try? FileManager.default.removeItem(at: zip) } }
                try FileManager.default.zipItem(at: folder, to: zip, shouldKeepParent: false)
                let zipValues = try zip.resourceValues(forKeys: [.fileSizeKey])
                guard let zipSize = zipValues.fileSize, zipSize >= 0 else { throw CaptureError.fileSize }
                try ArchiveBudget.validateCompressed(bytes: UInt64(zipSize))
                keepZIP = true
                DispatchQueue.main.async {
                    self.isBusy = false
                    self.status = "Capture exported. The contour still needs scale and review."
                    completion(zip)
                }
            } catch {
                DispatchQueue.main.async {
                    self.isBusy = false
                    self.status = "Export failed: \(error.localizedDescription)"
                    completion(nil)
                }
            }
        }
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        DispatchQueue.main.async {
            self.endSequence()
            self.stopSegmentation()
            self.needsNewLens = true
            self.status = "ARKit error: \(error.localizedDescription). Export, then start a New lens."
        }
    }

    func sessionWasInterrupted(_ session: ARSession) {
        DispatchQueue.main.async {
            self.endSequence()
            self.stopSegmentation()
            self.needsNewLens = true
            self.status = "Camera interrupted. Export existing frames, then tap New lens."
        }
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
        var text = "ply\nformat ascii 1.0\ncomment units meters\ncomment ARKit world coordinates; raw scene depth may be background\nelement vertex \(points.count)\n"
        text += "property float x\nproperty float y\nproperty float z\nproperty uchar confidence\nend_header\n"
        for point in points {
            let p = point.position
            text += "\(p.x) \(p.y) \(p.z) \(point.confidence)\n"
        }
        try text.write(to: url, atomically: true, encoding: .utf8)
    }
}

private final class CaptureRedirectGuard: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        // A configured server must not redirect a camera upload or its key elsewhere.
        completionHandler(nil)
    }
}

private enum CaptureError: LocalizedError {
    case noFrames, fileSize
    var errorDescription: String? {
        switch self {
        case .noFrames: "Capture at least one frame before exporting."
        case .fileSize: "Could not verify archive size. Free storage and try exporting again."
        }
    }
}

enum ArchiveBudget {
    // Decimal bytes keep a margin below public import's 100 MB / 250 MB limits.
    static let maximumCompressedBytes: UInt64 = 90_000_000
    static let maximumExpandedBytes: UInt64 = 240_000_000
    static let maximumCaptureBytes: UInt64 = 85_000_000

    static func validateCapture(fileBytes: UInt64, cloudPoints: Int) throws {
        guard cloudPoints >= 0, fileBytes <= maximumCaptureBytes,
              UInt64(cloudPoints) <= (maximumCaptureBytes - fileBytes) / 96 else {
            throw ArchiveBudgetError.capture
        }
    }

    static func validateExpanded(fileSizes: [UInt64]) throws {
        var total: UInt64 = 0
        for size in fileSizes {
            guard size <= maximumExpandedBytes - total else { throw ArchiveBudgetError.expanded }
            total += size
        }
    }

    static func validateCompressed(bytes: UInt64) throws {
        guard bytes <= maximumCompressedBytes else { throw ArchiveBudgetError.compressed }
    }
}

enum ArchiveBudgetError: LocalizedError {
    case expanded, compressed, capture
    var errorDescription: String? {
        let limit: String
        switch self {
        case .expanded: limit = "240 MB of capture files"
        case .compressed: limit = "90 MB ZIP size"
        case .capture:
            return "Capture storage limit reached. This frame was not added. Export your saved frames before starting a New lens."
        }
        return "This capture exceeds \(limit). Start a New lens and recapture fewer views (keep empty sheet, lens photo, and a short depth arc). All current frames are retained; no partial archive was shared."
    }
}
