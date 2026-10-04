import Foundation
import simd

/// Only assembled preview geometry is accepted. STL/build-plate coordinates are not interchangeable.
struct TryOnModel: Decodable {
    struct Mesh: Decodable {
        let name: String
        let kind: String
        let vertices: [[Float]]
        let faces: [[Int]]
    }
    let schemaVersion: Int
    let units: String
    let meshes: [Mesh]
    let opticalCentres: [[Float]]
    let frameStyle: String?
    let alignmentSource: String?
    static let byteLimit = 20 * 1024 * 1024

    enum ImportError: LocalizedError {
        case tooLarge, invalid
        var errorDescription: String? {
            switch self {
            case .tooLarge: return "This frame file is too large. Export a fresh iPhone preview."
            case .invalid: return "Choose an OptiFrame iPhone preview JSON file."
            }
        }
    }

    static func load(_ url: URL) throws -> TryOnModel {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard size <= byteLimit else { throw ImportError.tooLarge }
        return try decode(Data(contentsOf: url))
    }

    static func decode(_ data: Data) throws -> TryOnModel {
        guard data.count <= byteLimit else { throw ImportError.tooLarge }
        let model: TryOnModel
        do { model = try JSONDecoder().decode(Self.self, from: data) }
        catch { throw ImportError.invalid }
        try model.validate()
        return model
    }

    func validate() throws {
        guard schemaVersion == 1, units == "millimetres", !meshes.isEmpty, meshes.count <= 32,
              opticalCentres.count == 2,
              opticalCentres.allSatisfy({ validPoint($0) }),
              opticalCentres[0][0] < opticalCentres[1][0] else { throw ImportError.invalid }
        var vertices = 0, triangles = 0
        for mesh in meshes {
            vertices += mesh.vertices.count; triangles += mesh.faces.count
            guard vertices <= 160_000, triangles <= 250_000,
                  !mesh.vertices.isEmpty, !mesh.faces.isEmpty,
                  ["printed", "lens"].contains(mesh.kind),
                  mesh.vertices.allSatisfy({ validPoint($0) }),
                  mesh.faces.allSatisfy({ face in
                      face.count == 3 && Set(face).count == 3 &&
                      face.allSatisfy { $0 >= 0 && $0 < mesh.vertices.count }
                  }) else { throw ImportError.invalid }
        }
    }

    private func validPoint(_ point: [Float]) -> Bool {
        point.count == 3 && point.allSatisfy { $0.isFinite && abs($0) <= 500 }
    }

    var opticalMidpoint: SIMD3<Float> {
        (SIMD3(opticalCentres[0][0], opticalCentres[0][1], opticalCentres[0][2]) +
         SIMD3(opticalCentres[1][0], opticalCentres[1][1], opticalCentres[1][2])) / 2
    }

    /// CAD temples extend -Z, like the back of ARFaceAnchor. Wearer's left changes -X → +X.
    /// Reflect X, then mm → m; triangle winding must also be reversed when rendering.
    func facePoint(_ point: [Float]) -> SIMD3<Float> {
        let centred = SIMD3(point[0], point[1], point[2]) - opticalMidpoint
        return SIMD3(-centred.x, centred.y, centred.z) / 1_000
    }
}
