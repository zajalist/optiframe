import ARKit
import CoreImage
import Foundation
import simd

struct SavedFrame {
    let frame: CapturedFrame
    let points: [DepthPoint]
}

final class FrameProcessor {
    private let context = CIContext(options: [.useSoftwareRenderer: false])
    private let colorSpace = CGColorSpaceCreateDeviceRGB()

    func save(frame: ARFrame, side: LensSide, kind: FrameKind,
              index: Int, folder: URL) throws -> SavedFrame {
        let name = String(format: "frame-%04d", index)
        let image = CIImage(cvPixelBuffer: frame.capturedImage)
        guard let original = context.jpegRepresentation(of: image, colorSpace: colorSpace) else {
            throw ProcessingError.jpeg
        }
        let enhanced = image
            .applyingFilter("CIColorControls", parameters: [
                kCIInputContrastKey: 1.35,
                kCIInputSaturationKey: 0.8
            ])
            .applyingFilter("CISharpenLuminance", parameters: [kCIInputSharpnessKey: 0.35])
        guard let enhancedJPEG = context.jpegRepresentation(of: enhanced, colorSpace: colorSpace) else {
            throw ProcessingError.jpeg
        }
        let originalName = "\(name)-original.jpg"
        let enhancedName = "\(name)-enhanced.jpg"
        try original.write(to: folder.appendingPathComponent(originalName))
        try enhancedJPEG.write(to: folder.appendingPathComponent(enhancedName))

        let quality = try score(image)
        let imageWidth = CVPixelBufferGetWidth(frame.capturedImage)
        let imageHeight = CVPixelBufferGetHeight(frame.capturedImage)
        let trackingValid: Bool
        if case .normal = frame.camera.trackingState { trackingValid = true }
        else { trackingValid = false }

        var depthName: String?
        var confidenceName: String?
        var depthWidth: Int?
        var depthHeight: Int?
        var points: [DepthPoint] = []
        if let depth = frame.sceneDepth {
            let depthBuffer = depth.depthMap
            depthWidth = CVPixelBufferGetWidth(depthBuffer)
            depthHeight = CVPixelBufferGetHeight(depthBuffer)
            depthName = "\(name)-depth-f32le.bin"
            try copyRows(depthBuffer, bytesPerPixel: 4)
                .write(to: folder.appendingPathComponent(depthName!))
            if let confidence = depth.confidenceMap {
                confidenceName = "\(name)-confidence-u8.bin"
                try copyRows(confidence, bytesPerPixel: 1)
                    .write(to: folder.appendingPathComponent(confidenceName!))
            }
            if trackingValid {
                points = samplePoints(depth: depthBuffer, confidence: depth.confidenceMap,
                                      camera: frame.camera, imageWidth: imageWidth,
                                      imageHeight: imageHeight)
            }
        }

        let record = CapturedFrame(
            side: side, kind: kind, original: originalName, enhanced: enhancedName,
            depth: depthName, confidence: confidenceName,
            depthWidth: depthWidth, depthHeight: depthHeight,
            timestamp: frame.timestamp, imageWidth: imageWidth, imageHeight: imageHeight,
            cameraToWorldColumnMajor: columns(frame.camera.transform),
            intrinsicsColumnMajor: columns(frame.camera.intrinsics),
            trackingValid: trackingValid,
            sharpness: quality.sharpness, clippedFraction: quality.clippedFraction
        )
        return SavedFrame(frame: record, points: points)
    }

    private func score(_ image: CIImage) throws -> (sharpness: Double, clippedFraction: Double) {
        let size = 128
        let small = image.transformed(by: CGAffineTransform(
            scaleX: CGFloat(size) / image.extent.width,
            y: CGFloat(size) / image.extent.height
        ))
        var rgba = [UInt8](repeating: 0, count: size * size * 4)
        rgba.withUnsafeMutableBytes { bytes in
            context.render(small, toBitmap: bytes.baseAddress!, rowBytes: size * 4,
                           bounds: CGRect(x: 0, y: 0, width: size, height: size),
                           format: .RGBA8, colorSpace: colorSpace)
        }
        return FrameQuality.measure(rgba: rgba, width: size, height: size)
    }

    private func copyRows(_ buffer: CVPixelBuffer, bytesPerPixel: Int) throws -> Data {
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(buffer) else { throw ProcessingError.depth }
        let width = CVPixelBufferGetWidth(buffer)
        let height = CVPixelBufferGetHeight(buffer)
        let stride = CVPixelBufferGetBytesPerRow(buffer)
        var data = Data(capacity: width * height * bytesPerPixel)
        for y in 0..<height {
            let row = base.advanced(by: y * stride).assumingMemoryBound(to: UInt8.self)
            data.append(row, count: width * bytesPerPixel)
        }
        return data
    }

    private func samplePoints(depth: CVPixelBuffer, confidence: CVPixelBuffer?,
                              camera: ARCamera, imageWidth: Int, imageHeight: Int) -> [DepthPoint] {
        CVPixelBufferLockBaseAddress(depth, .readOnly)
        if let confidence { CVPixelBufferLockBaseAddress(confidence, .readOnly) }
        defer {
            CVPixelBufferUnlockBaseAddress(depth, .readOnly)
            if let confidence { CVPixelBufferUnlockBaseAddress(confidence, .readOnly) }
        }
        guard let depthBase = CVPixelBufferGetBaseAddress(depth) else { return [] }
        let width = CVPixelBufferGetWidth(depth)
        let height = CVPixelBufferGetHeight(depth)
        let depthStride = CVPixelBufferGetBytesPerRow(depth)
        let confBase = confidence.flatMap { CVPixelBufferGetBaseAddress($0) }
        let confStride = confidence.map(CVPixelBufferGetBytesPerRow) ?? 0
        let confWidth = confidence.map(CVPixelBufferGetWidth) ?? width
        let confHeight = confidence.map(CVPixelBufferGetHeight) ?? height
        var result: [DepthPoint] = []
        for v in stride(from: 0, to: height, by: 8) {
            let depthRow = depthBase.advanced(by: v * depthStride).assumingMemoryBound(to: Float32.self)
            for u in stride(from: 0, to: width, by: 8) {
                let meters = depthRow[u]
                guard meters.isFinite, meters >= 0.15, meters <= 1.5 else { continue }
                let confidenceValue: UInt8
                if let confBase {
                    let cv = min(confHeight - 1, v * confHeight / height)
                    let cu = min(confWidth - 1, u * confWidth / width)
                    confidenceValue = confBase.advanced(by: cv * confStride)
                        .assumingMemoryBound(to: UInt8.self)[cu]
                } else { confidenceValue = 0 }
                guard confidenceValue >= 1 || confBase == nil else { continue }
                let position = DepthProjection.worldPoint(
                    u: Float(u), v: Float(v), depth: meters,
                    depthWidth: Float(width), depthHeight: Float(height),
                    imageWidth: Float(imageWidth), imageHeight: Float(imageHeight),
                    intrinsics: camera.intrinsics, cameraToWorld: camera.transform
                )
                result.append(DepthPoint(position: position, confidence: confidenceValue))
            }
        }
        return result
    }

    private func columns(_ matrix: simd_float4x4) -> [Float] {
        [matrix.columns.0, matrix.columns.1, matrix.columns.2, matrix.columns.3]
            .flatMap { [$0.x, $0.y, $0.z, $0.w] }
    }

    private func columns(_ matrix: simd_float3x3) -> [Float] {
        [matrix.columns.0, matrix.columns.1, matrix.columns.2]
            .flatMap { [$0.x, $0.y, $0.z] }
    }
}

enum ProcessingError: Error { case jpeg, depth }

enum DepthProjection {
    static func worldPoint(u: Float, v: Float, depth: Float,
                           depthWidth: Float, depthHeight: Float,
                           imageWidth: Float, imageHeight: Float,
                           intrinsics: simd_float3x3,
                           cameraToWorld: simd_float4x4) -> SIMD3<Float> {
        let scaleX = depthWidth / imageWidth
        let scaleY = depthHeight / imageHeight
        let fx = intrinsics.columns.0.x * scaleX
        let fy = intrinsics.columns.1.y * scaleY
        let cx = intrinsics.columns.2.x * scaleX
        let cy = intrinsics.columns.2.y * scaleY
        let cameraPoint = SIMD4<Float>((u - cx) * depth / fx,
                                       -(v - cy) * depth / fy,
                                       -depth, 1)
        let world = cameraToWorld * cameraPoint
        return SIMD3(world.x, world.y, world.z)
    }
}

enum FrameQuality {
    static func measure(rgba: [UInt8], width: Int, height: Int)
        -> (sharpness: Double, clippedFraction: Double) {
        guard width >= 3, height >= 3, rgba.count == width * height * 4 else { return (0, 1) }
        func luminance(_ x: Int, _ y: Int) -> Double {
            let i = (y * width + x) * 4
            return 0.2126 * Double(rgba[i]) + 0.7152 * Double(rgba[i + 1])
                + 0.0722 * Double(rgba[i + 2])
        }
        var edgeEnergy = 0.0
        var clipped = 0
        var count = 0
        for y in 1..<(height - 1) {
            for x in 1..<(width - 1) {
                let laplacian = 4 * luminance(x, y) - luminance(x - 1, y)
                    - luminance(x + 1, y) - luminance(x, y - 1) - luminance(x, y + 1)
                edgeEnergy += laplacian * laplacian
                if x >= width / 4, x < 3 * width / 4,
                   y >= height / 4, y < 3 * height / 4 {
                    let i = (y * width + x) * 4
                    if rgba[i] >= 250, rgba[i + 1] >= 250, rgba[i + 2] >= 250 { clipped += 1 }
                    count += 1
                }
            }
        }
        return (edgeEnergy / Double((width - 2) * (height - 2)),
                count == 0 ? 0 : Double(clipped) / Double(count))
    }
}
