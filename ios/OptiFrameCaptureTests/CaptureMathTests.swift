import XCTest
import simd
@testable import OptiFrameCapture

final class CaptureMathTests: XCTestCase {
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
