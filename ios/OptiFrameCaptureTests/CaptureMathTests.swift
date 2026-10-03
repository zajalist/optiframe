import XCTest
import simd
@testable import OptiFrameCapture

final class CaptureMathTests: XCTestCase {
    func testStoppedOrReplacedProposalCannotPublishLateResult() {
        var generation = ProposalGeneration()
        let firstRequest = generation.invalidate()
        XCTAssertTrue(generation.accepts(firstRequest))
        _ = generation.invalidate() // Stop, New lens, or mode change.
        XCTAssertFalse(generation.accepts(firstRequest))
        let replacementRequest = generation.invalidate()
        XCTAssertFalse(generation.accepts(firstRequest))
        XCTAssertTrue(generation.accepts(replacementRequest))
    }

    func testCaptureBudgetReservesCloudAndRejectsAdditionalFrame() throws {
        try ArchiveBudget.validateCapture(fileBytes: 84_999_904, cloudPoints: 1)
        XCTAssertThrowsError(try ArchiveBudget.validateCapture(fileBytes: 84_999_905, cloudPoints: 1))
        XCTAssertThrowsError(try ArchiveBudget.validateCapture(fileBytes: UInt64.max, cloudPoints: 0))
        XCTAssertThrowsError(try ArchiveBudget.validateCapture(fileBytes: 0, cloudPoints: -1))
    }

    func testArchiveBudgetBoundariesAndOverflow() {
        XCTAssertNoThrow(try ArchiveBudget.validateExpanded(fileSizes: [100_000_000, 140_000_000]))
        XCTAssertThrowsError(try ArchiveBudget.validateExpanded(fileSizes: [240_000_000, 1]))
        XCTAssertThrowsError(try ArchiveBudget.validateExpanded(fileSizes: [UInt64.max]))
        XCTAssertNoThrow(try ArchiveBudget.validateExpanded(fileSizes: []))
        XCTAssertNoThrow(try ArchiveBudget.validateCompressed(bytes: 90_000_000))
        XCTAssertThrowsError(try ArchiveBudget.validateCompressed(bytes: 90_000_001))
    }

    func testDepthProjectionUsesSensorAxesAndWorldTranslation() {
        let intrinsics = simd_float3x3(columns: (
            SIMD3<Float>(200, 0, 0), SIMD3<Float>(0, 100, 0), SIMD3<Float>(100, 50, 1)
        ))
        var pose = matrix_identity_float4x4
        pose.columns.3 = SIMD4<Float>(1, 2, 3, 1)
        let point = DepthProjection.worldPoint(
            u: 75, v: 10, depth: 0.5,
            depthWidth: 100, depthHeight: 25,
            imageWidth: 200, imageHeight: 100,
            intrinsics: intrinsics, cameraToWorld: pose
        )
        XCTAssertEqual(point.x, 1.125, accuracy: 0.0001)
        XCTAssertEqual(point.y, 2.05, accuracy: 0.0001)
        XCTAssertEqual(point.z, 2.5, accuracy: 0.0001)
    }

    func testClippingMeasuresCentralRegionAndRejectsMalformedImage() {
        var image = [UInt8](repeating: 0, count: 8 * 8 * 4)
        for y in 2..<6 {
            for x in 2..<6 {
                let i = (y * 8 + x) * 4
                image[i] = 255
                image[i + 1] = 255
                image[i + 2] = 255
            }
        }
        XCTAssertEqual(FrameQuality.measure(rgba: image, width: 8, height: 8).clippedFraction, 1)
        XCTAssertEqual(FrameQuality.measure(rgba: [], width: 8, height: 8).clippedFraction, 1)
    }

    func testDepthProjectsForwardAtImageCentre() {
        let intrinsics = simd_float3x3(columns: (
            SIMD3<Float>(100, 0, 0),
            SIMD3<Float>(0, 100, 0),
            SIMD3<Float>(50, 50, 1)
        ))
        let point = DepthProjection.worldPoint(
            u: 25, v: 25, depth: 1,
            depthWidth: 50, depthHeight: 50,
            imageWidth: 100, imageHeight: 100,
            intrinsics: intrinsics, cameraToWorld: matrix_identity_float4x4
        )
        XCTAssertEqual(point.x, 0, accuracy: 0.0001)
        XCTAssertEqual(point.y, 0, accuracy: 0.0001)
        XCTAssertEqual(point.z, -1, accuracy: 0.0001)
    }

    func testSharpnessDistinguishesFlatFromEdge() {
        let flat = [UInt8](repeating: 100, count: 8 * 8 * 4)
        var edge = flat
        for y in 0..<8 {
            for x in 4..<8 {
                let i = (y * 8 + x) * 4
                edge[i] = 220
                edge[i + 1] = 220
                edge[i + 2] = 220
            }
        }
        XCTAssertGreaterThan(FrameQuality.measure(rgba: edge, width: 8, height: 8).sharpness,
                             FrameQuality.measure(rgba: flat, width: 8, height: 8).sharpness)
    }
}
