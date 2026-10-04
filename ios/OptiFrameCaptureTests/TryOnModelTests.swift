import XCTest
@testable import OptiFrameCapture

final class TryOnModelTests: XCTestCase {
    private func fixture() -> [String: Any] {
        ["schemaVersion": 1, "units": "millimetres",
         "opticalCentres": [[-31.0, 0, 2.15], [33.0, 0, 2.15]],
         "meshes": [["name": "front", "kind": "printed",
                     "vertices": [[-31.0, 0, 2.15], [33.0, 0, 2.15], [0, 10, 3]],
                     "faces": [[0, 1, 2]]]]]
    }
    private func decode(_ value: [String: Any]) throws -> TryOnModel {
        try TryOnModel.decode(JSONSerialization.data(withJSONObject: value))
    }
    func testCoordinatesPreservePhysicalScaleAndWearerSides() throws {
        let model = try decode(fixture())
        let left = model.facePoint([-31, 0, 2.15])
        let right = model.facePoint([33, 0, 2.15])
        XCTAssertEqual(left.x, 0.032, accuracy: 0.000001)
        XCTAssertEqual(right.x, -0.032, accuracy: 0.000001)
        XCTAssertEqual(model.facePoint([1, 10, 12.15]).y, 0.010, accuracy: 0.000001)
        XCTAssertEqual(model.facePoint([1, 10, -7.85]).z, -0.010, accuracy: 0.000001)
    }
    func testRejectsWrongUnitsAndSchema() throws {
        var value = fixture(); value["units"] = "metres"
        XCTAssertThrowsError(try decode(value))
        value = fixture(); value["schemaVersion"] = 2
        XCTAssertThrowsError(try decode(value))
    }
    func testRejectsInvalidIndicesAndPositions() throws {
        var value = fixture()
        value["meshes"] = [["name": "front", "kind": "printed",
                            "vertices": [[0, 0, 0], [1, 0, 0], [0, 1, 0]], "faces": [[0, 1, 3]]]]
        XCTAssertThrowsError(try decode(value))
        value["opticalCentres"] = [[-31, 0], [33, 0, 2]]
        XCTAssertThrowsError(try decode(value))
    }
    func testRejectsEmptyGeometryAndOversizedFile() throws {
        var value = fixture(); value["meshes"] = []
        XCTAssertThrowsError(try decode(value))
        XCTAssertThrowsError(try TryOnModel.decode(Data(repeating: 32, count: TryOnModel.byteLimit + 1)))
    }
}
