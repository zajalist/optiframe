import Foundation

/// TrueDepth is a hardware/metric-depth gate, never an accuracy certification.
enum FaceDepthGate {
    static func supportsMeasurement(faceTracking: Bool, trueDepth: Bool) -> Bool {
        faceTracking && trueDepth
    }
    static func accepts(frameTime: Double, depthTime: Double, absolute: Bool,
                        previousDepthTime: Double?) -> Bool {
        guard absolute, frameTime.isFinite, depthTime.isFinite, depthTime > 0,
              abs(frameTime-depthTime) <= 0.12 else { return false }
        return previousDepthTime.map { depthTime > $0 } ?? true
    }
}

struct FaceFitSample: Codable {
    let timestamp: Double
    let leftMm: Double
    let rightMm: Double
}

struct FaceFitMeasurements: Encodable {
    let leftMonocularEstimateMm: Double
    let rightMonocularEstimateMm: Double
    var totalEstimateMm: Double { leftMonocularEstimateMm + rightMonocularEstimateMm }

    enum CodingKeys: String, CodingKey {
        case leftMonocularEstimateMm, rightMonocularEstimateMm, totalEstimateMm
    }
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(leftMonocularEstimateMm, forKey: .leftMonocularEstimateMm)
        try container.encode(rightMonocularEstimateMm, forKey: .rightMonocularEstimateMm)
        try container.encode(totalEstimateMm, forKey: .totalEstimateMm)
    }
}

/// An engineering repeatability gate, not a statement about measurement accuracy.
struct FaceFitWindow {
    static let requiredSamples = 21
    private(set) var samples: [FaceFitSample] = []
    mutating func reset() { samples.removeAll(keepingCapacity: true) }

    static func sample(timestamp: Double, leftXMetres: Double, rightXMetres: Double) -> FaceFitSample? {
        guard timestamp.isFinite, leftXMetres.isFinite, rightXMetres.isFinite,
              leftXMetres * rightXMetres < 0 else { return nil }
        let left = abs(leftXMetres) * 1_000
        let right = abs(rightXMetres) * 1_000
        // Reject implausible tracking, preserving wearer's left/right identities.
        guard (18...45).contains(left), (18...45).contains(right),
              (40...85).contains(left + right) else { return nil }
        return FaceFitSample(timestamp: timestamp, leftMm: left, rightMm: right)
    }

    mutating func append(_ sample: FaceFitSample) {
        guard sample.timestamp.isFinite, sample.leftMm.isFinite, sample.rightMm.isFinite else {
            reset(); return
        }
        if let last = samples.last {
            guard sample.timestamp > last.timestamp else { reset(); return }
            if sample.timestamp - last.timestamp > 0.35 { reset() }
            else if sample.timestamp - last.timestamp < 0.095 { return }
        }
        samples.append(sample)
        if samples.count > Self.requiredSamples { samples.removeFirst() }
    }

    static func deviation(_ values: [Double]) -> Double {
        guard !values.isEmpty else { return .infinity }
        let average = values.reduce(0, +) / Double(values.count)
        return sqrt(values.reduce(0) { $0 + pow($1 - average, 2) } / Double(values.count))
    }
    var leftStdDevMm: Double { Self.deviation(samples.map(\.leftMm)) }
    var rightStdDevMm: Double { Self.deviation(samples.map(\.rightMm)) }
    var duration: Double { (samples.last?.timestamp ?? 0) - (samples.first?.timestamp ?? 0) }
    var result: FaceFitMeasurements? {
        guard samples.count == Self.requiredSamples, duration >= 1.9,
              leftStdDevMm <= 0.4, rightStdDevMm <= 0.4 else { return nil }
        let left = samples.map(\.leftMm).sorted(), right = samples.map(\.rightMm).sorted()
        guard left.last! - left.first! <= 1.2, right.last! - right.first! <= 1.2 else { return nil }
        return FaceFitMeasurements(leftMonocularEstimateMm: left[left.count / 2],
                                   rightMonocularEstimateMm: right[right.count / 2])
    }
}

struct FaceFitExport: Encodable {
    let schemaVersion = 1
    let kind = "optiframe-face-fit"
    let units = "mm"
    let source = "arkit-eye-transform-estimate"
    let depthSource = "front-truedepth-absolute"
    let userReviewed = true
    let requiresProviderVerification = true
    let reference = "ARFaceAnchor local x=0; eye-transform origins, not clinical pupil centres"
    let createdAt: Date
    let measurements: FaceFitMeasurements
    let quality: Quality
    let capability: Capability
    let samples: [FaceFitSample]

    struct Quality: Encodable {
        let sampleCount: Int
        let durationSeconds: Double
        let leftStdDevMm: Double
        let rightStdDevMm: Double
        let thermalState: String
    }
    struct Capability: Encodable {
        let faceTrackingSupported: Bool
        let trueDepthAvailable: Bool
    }
}

/// A captured draft is not exportable until the operator explicitly confirms review.
struct FaceFitReview {
    private(set) var draft: FaceFitExport?
    private(set) var confirmed: FaceFitExport?
    mutating func stage(_ record: FaceFitExport) { draft = record; confirmed = nil }
    mutating func confirm() { confirmed = draft }
    mutating func reset() { draft = nil; confirmed = nil }
}
