import XCTest
@testable import OptiFrameCapture

final class FaceFitMathTests: XCTestCase {
    func testDepthMeasurementRequiresTrackingAndTrueDepthHardware() {
        XCTAssertTrue(FaceDepthGate.supportsMeasurement(faceTracking: true, trueDepth: true))
        XCTAssertFalse(FaceDepthGate.supportsMeasurement(faceTracking: true, trueDepth: false))
        XCTAssertFalse(FaceDepthGate.supportsMeasurement(faceTracking: false, trueDepth: true))
    }
    func testDepthFramesMustBeAbsoluteFreshAndDistinct() {
        XCTAssertTrue(FaceDepthGate.accepts(frameTime: 2.05, depthTime: 2, absolute: true, previousDepthTime: 1.9))
        XCTAssertFalse(FaceDepthGate.accepts(frameTime: 2.05, depthTime: 2, absolute: false, previousDepthTime: nil))
        XCTAssertFalse(FaceDepthGate.accepts(frameTime: 2.5, depthTime: 2, absolute: true, previousDepthTime: nil))
        XCTAssertFalse(FaceDepthGate.accepts(frameTime: 2, depthTime: 2, absolute: true, previousDepthTime: 2))
        XCTAssertFalse(FaceDepthGate.accepts(frameTime: .nan, depthTime: 2, absolute: true, previousDepthTime: nil))
        XCTAssertFalse(FaceDepthGate.accepts(frameTime: 0, depthTime: 0, absolute: true, previousDepthTime: nil))
    }
    func testReviewMustBeConfirmedAndDoesNotClaimClinicalVerification() throws {
        var review = FaceFitReview()
        review.confirm()
        XCTAssertNil(review.confirmed)
        let record = FaceFitExport(createdAt: Date(),
            measurements: .init(leftMonocularEstimateMm: 31, rightMonocularEstimateMm: 34),
            quality: .init(sampleCount: 21, durationSeconds: 2, leftStdDevMm: 0.1, rightStdDevMm: 0.1, thermalState: "nominal"),
            capability: .init(faceTrackingSupported: true, trueDepthAvailable: true), samples: [])
        review.stage(record)
        XCTAssertNil(review.confirmed)
        review.confirm()
        let confirmed = try XCTUnwrap(review.confirmed)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(confirmed)) as? [String: Any])
        XCTAssertEqual(json["userReviewed"] as? Bool, true)
        XCTAssertEqual(json["requiresProviderVerification"] as? Bool, true)
        XCTAssertEqual(json["source"] as? String, "arkit-eye-transform-estimate")
        XCTAssertEqual(json["depthSource"] as? String, "front-truedepth-absolute")
        review.stage(record)
        XCTAssertNil(review.confirmed)
        review.reset()
        XCTAssertNil(review.draft)
    }
    func testMetresConvertToWearerLeftAndRightWithoutSwapping() throws {
        let sample = try XCTUnwrap(FaceFitWindow.sample(timestamp: 1, leftXMetres: 0.031, rightXMetres: -0.034))
        XCTAssertEqual(sample.leftMm, 31, accuracy: 0.0001)
        XCTAssertEqual(sample.rightMm, 34, accuracy: 0.0001)
    }
    func testRejectsNonFiniteSameSideAndImplausibleEyes() {
        XCTAssertNil(FaceFitWindow.sample(timestamp: 0, leftXMetres: .nan, rightXMetres: -0.032))
        XCTAssertNil(FaceFitWindow.sample(timestamp: 0, leftXMetres: 0.031, rightXMetres: 0.032))
        XCTAssertNil(FaceFitWindow.sample(timestamp: 0, leftXMetres: 0.050, rightXMetres: -0.050))
    }
    func testRequiresTwoSecondsAndStableRepeatedSamples() throws {
        var window = FaceFitWindow()
        for i in 0..<20 {
            window.append(.init(timestamp: Double(i) * 0.1, leftMm: 31, rightMm: 34))
        }
        XCTAssertNil(window.result)
        window.append(.init(timestamp: 2, leftMm: 31, rightMm: 34))
        let result = try XCTUnwrap(window.result)
        XCTAssertEqual(result.totalEstimateMm, 65)
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(result)) as! [String: Double]
        XCTAssertEqual(json["totalEstimateMm"], 65)
    }
    func testJitterDoesNotBecomeACompleteEstimate() {
        var window = FaceFitWindow()
        for i in 0..<30 {
            window.append(.init(timestamp: Double(i) * 0.1, leftMm: i % 2 == 0 ? 30 : 32, rightMm: 34))
        }
        XCTAssertNil(window.result)
    }
    func testGapAndOutOfOrderFramesResetInsteadOfFinishingOldCapture() {
        var window = FaceFitWindow()
        for i in 0..<20 {
            window.append(.init(timestamp: Double(i) * 0.1, leftMm: 31, rightMm: 34))
        }
        window.append(.init(timestamp: 4, leftMm: 31, rightMm: 34))
        XCTAssertEqual(window.samples.count, 1)
        XCTAssertNil(window.result)
        window.append(.init(timestamp: 3, leftMm: 31, rightMm: 34))
        XCTAssertTrue(window.samples.isEmpty)
    }
    func testCameraFrameRateCannotFillWindowImmediately() {
        var window = FaceFitWindow()
        for i in 0..<60 {
            window.append(.init(timestamp: Double(i) / 60, leftMm: 31, rightMm: 34))
        }
        XCTAssertNil(window.result)
        XCTAssertLessThan(window.samples.count, 12)
    }
}
