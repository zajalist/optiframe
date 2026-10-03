# OptiFrame iPhone capture

This is OptiFrame's own SwiftUI/ARKit capture app. It records **one lens per ZIP**. Use the marked capture sheet and verify its printed scale with a ruler before measuring a lens in the web app.

## Capture sequence

1. Select left or right. Put the empty marked sheet under a fixed phone and save an **Empty sheet** frame.
2. Place the lens without moving the sheet or phone. Save a **Lens on sheet** frame. Move the phone slightly and save another if reflections hide an edge.
3. For depth, hold the lens upright in a stable stand with the marked board *behind* it. Select **Depth arc** and save several views while slowly moving the phone. LiDAR-equipped iPhones save depth and confidence; other iPhones save RGB, ARKit poses, and camera intrinsics.
4. Export the ZIP and import it into the OptiFrame web app. Use **New lens** before repeating for the other eye.

Original JPEGs are always preserved. Enhanced JPEGs use modest contrast and luminance sharpening only to propose boundaries; they never replace the originals. The app scores sharpness and central clipped highlights so an operator can retake a view. Its `raw-cloud.ply` contains sampled ARKit scene-depth points from arc frames. **Clear lens pixels may produce missing or background depth.** The web app must compare cloud coverage against the approved 2D rim and calipers before using any Z value in CAD.

## Build and device test

On a Mac with Xcode and [XcodeGen](https://github.com/yonaskolb/XcodeGen):

```sh
cd ios
xcodegen generate
open OptiFrameCapture.xcodeproj
```

Select your development team and run on a physical iPhone. The GitHub workflow builds an unsigned Simulator target and runs capture math tests; the Simulator cannot validate LiDAR, transparency, or physical measurement. No signing credentials are stored in this repository.

## ZIP contract (schema version 1)

`manifest.json` lists frame kind, lens side, original/enhanced JPEG paths, ARKit camera-to-world and intrinsics matrices in column-major order, image dimensions, capture quality, and optional depth/confidence paths. Depth files are packed row-major float32 metres, little-endian; confidence files are row-major uint8 ARKit confidence values. Matrices and PLY positions use metres in the ARKit world frame. The archive has no verified lens contour or scale until the web measurement step.

The original/enhanced JPEGs, depth, intrinsics and pose come from the **same ARFrame**. JPEG pixels retain ARKit sensor coordinates (`imageOrientation: sensor-landscape-right`), with no portrait rotation or mirrored preview transform baked in. Depth shares that sensor orientation at its own resolution; confidence has the same dimensions as depth. Importers must use the recorded image dimensions and scale intrinsics to the depth dimensions. A portrait-looking preview is not evidence that JPEG axes were rotated. Camera-space projection uses +X right, +Y up, and forward −Z. PLY comments identify metre units and raw scene depth; converting to CAD millimetres requires multiplying coordinates by 1000. Camera intrinsics contain pixel focal lengths and principal points; only pose translation and point positions are in metres.

These are JPEGs of ARKit camera frames, **not high-resolution still photography**. If their rim detail is insufficient, use the web photo workflow with a full-resolution rear-camera photo and the verified sheet. The app does not provide manual exposure lock/bias or guarantee a visible reflective edge. Central clipping is a recapture hint, not proof of lens-edge quality; inspect the full perimeter and try diffuse/oblique lighting or a matte alternate sheet. Never infer scale from ARKit background depth.

Capture/export are serialized and each archive is limited to 60 frames, bounding retained camera buffers and sampled cloud memory. New lens removes the previous working files. Share/export ZIPs stay in temporary storage for the share sheet and may be removed by iOS. Export before starting another lens. A camera interruption or ARKit failure blocks further capture until New lens so archives cannot silently mix coordinate origins. Existing frames remain exportable.

Export checks every capture file including manifest and PLY before packaging: expanded contents must be at most **240,000,000 bytes** and the resulting ZIP at most **90,000,000 bytes**. These decimal byte budgets leave room below the public import's 250 MB expanded/100 MB upload caps. An oversized or failed ZIP is removed and never shared; all working frames remain intact. The app reports that a New lens with fewer views is required. It does not silently drop photos or cloud points. Sixty LiDAR frames can produce 242 archive entries (four files per frame plus manifest and cloud), which the server must permit independently of its byte limits.

### Physical device acceptance checks

- On a non-LiDAR iPhone, capture empty/lens/arc views, export and import: photos/poses must work with no depth or cloud.
- On a LiDAR iPhone, compare a rigid opaque target at a ruler-measured distance against depth/PLY; verify +X/+Y/−Z signs and metre-to-millimetre conversion. Then inspect missing/background returns on the clear lens separately.
- Capture portrait and both landscape holds. Import original and enhanced JPEGs and verify four marker coordinates, lens orientation, and projected depth align in the stored sensor axes.
- Open/dismiss the share sheet and continue the same capture. Background/foreground or interrupt the camera: further captures must require New lens, and the old archive must still export.
- Rapidly tap capture/export, reach 60 frames, start a New lens, and test low storage/camera permission denial. There must be no duplicate queued capture, frozen controls, or partial referenced files.
- Under reflective lighting, compare repeated lens captures and calipers against the pipeline's proposed 0.5 mm repeatability gate. No accuracy is claimed until this and a physical rim coupon pass.
