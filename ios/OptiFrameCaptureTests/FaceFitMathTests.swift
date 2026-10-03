import XCTest
@testable import OptiFrameCapture

final class FaceFitMathTests: XCTestCase {
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
