# OptiFrame iPhone capture

This is OptiFrame's own SwiftUI/ARKit capture app. It records **one lens per ZIP**. Use the marked capture sheet and verify its printed scale with a ruler before measuring a lens in the web app.

## Native visual try-on

In the website's frame preview, download the **iPhone app preview** JSON to Files. Open **Try on a frame** in this app, then **Import frame**. No optician measurements are required to view an already-generated model. The app imports the actual assembled meshes; it does not generate new prescription or fitting measurements. Leave an existing lens capture session by exporting it and starting a new lens before entering try-on.

The front-camera ARKit face anchor follows head movement, with depth-only face geometry hiding rear frame parts behind the face. Imported millimetre dimensions are preserved: there is no automatic scale-to-face fit. Placement uses the tracked eye midpoint plus an illustrative 18 mm forward offset. This is a visual preview, not a lens-retention, optical-alignment or comfort check. Lens placeholders are flat sections from the CAD model, not measured optical surfaces. No face geometry, images, or eye positions are saved or uploaded by try-on.

The importer accepts the direct `/frame-preview` schema: `schemaVersion: 1`, `units: "millimetres"`, `opticalCentres` with two XYZ triples, and `meshes` containing `name`, `kind` (`printed` or `lens`), `vertices` and triangular `faces`. Limits are 20 MB, 32 meshes, 160,000 vertices and 250,000 triangles, finite coordinates within ±500 mm, and valid nondegenerate index triples. Unknown fields are ignored. Exported STL/build-plate geometry is not accepted. CAD coordinates transform to ARFaceAnchor coordinates as `(-x, y, z) / 1000` after centring on the two optical references; triangle winding is reversed to account for the X reflection. Wearer's left maps to ARKit +X and rearward temples remain -Z.

Support uses `ARFaceTrackingConfiguration.isSupported`, independently of rear LiDAR or a TrueDepth hardware assumption. Camera permission is requested only after choosing a frame. Backgrounding, camera interruptions, serious thermal pressure and tracking loss hide the overlay; returning/retrying resets tracking. A permission response arriving after dismissal cannot restart capture.

**Build status:** these new Swift sources and `TryOnModelTests` were authored on Windows and have not been compiled, signed or run on an iPhone. This is not an App Store/TestFlight release. XcodeGen includes the new files automatically. On a Mac run the existing Xcode build/test workflow below; then test import, left/right orientation, size, face occlusion, head turns, denied permission, interruption, background/foreground, unsupported device and thermal pause on a physical iPhone. Confirm the full frame is visible and temples point behind the head before using screenshots in a demo. The simulator cannot validate live face tracking.

Apple references: [ARFaceAnchor coordinates](https://developer.apple.com/documentation/arkit/arfaceanchor), [device support and permission](https://developer.apple.com/documentation/arkit/verifying-device-support-and-user-permission), [tracking and visualizing faces](https://developer.apple.com/documentation/arkit/tracking-and-visualizing-faces).

## Experimental face fitting

Before capturing a lens, choose **Face measurements** for the optional front-camera ARKit estimate. Hold still and face the camera; a stable capture completes automatically. Export the JSON and import it in the web fitting page, or enter provider measurements manually. Left/right refer to the wearer. The estimate uses ARKit eye-transform origins and must be verified by an eye-care provider; it is not clinical pupil metrology.

Support is checked on device. AR face tracking does not necessarily imply TrueDepth hardware. The face session pauses when iOS reports serious/critical thermal pressure, and clears partial estimates after tracking loss or backgrounding. It never saves or uploads face photos/meshes. Face entry is unavailable during an existing lens session to keep tracking coordinates separate.

See [capabilities, schema and validation limits](../docs/face-fitting.md). This feature still needs an Xcode build and physical iPhone validation; it is not accessible through Safari's camera API.

## Capture sequence

1. Select left or right. Put the empty marked sheet under a fixed phone and save an **Empty sheet** frame.
2. Place the lens without moving the sheet or phone. Save a **Lens on sheet** frame. Move the phone slightly and save another if reflections hide an edge.
3. For depth, hold the lens upright in a stable stand with the marked board *behind* it. Select **Depth arc** and save several views while slowly moving the phone. LiDAR-equipped iPhones save depth and confidence; other iPhones save RGB, ARKit poses, and camera intrinsics.
4. Export the ZIP and import it into the OptiFrame web app. Use **New lens** before repeating for the other eye.

Original JPEGs are always preserved. Enhanced JPEGs use modest contrast and luminance sharpening only to propose boundaries; they never replace the originals. The app scores sharpness and central clipped highlights so an operator can retake a view. Its `raw-cloud.ply` contains sampled ARKit scene-depth points from arc frames. **Clear lens pixels may produce missing or background depth.** The web app must compare cloud coverage against the approved 2D rim and calipers before using any Z value in CAD.

## Native modes and review

**Empty sheet** and **Lens photo** save one original ARFrame. **Outline video burst** and **Depth arc** sample at 0.75-second intervals for up to 12 attempts (approximately 9 seconds). Busy writes and unavailable tracking skip attempts; frames are never queued behind a slow write. Stop recording ends sampling while a current save completes. These modes export JPEG frame sequences, not an encoded movie. Depth arc on a non-LiDAR phone still saves RGB and camera poses.

**Live segmentation** requires an accessible HTTPS OptiFrame GPU server. Enter its base URL and optional access key, then choose Start live. Samples with a maximum dimension of about 960 pixels are sent to `/api/segment`, with only one request in flight and a 50 ms minimum gap between starts. Actual update rate depends on inference and network latency. The center box supplies the SAM prompt. Returned proposals are drawn on their own source JPEG with measured request latency, never on a newer moving camera view. The access key stays in memory; redirects are rejected. There is no bundled local SAM model. A failed or contour-free response clears the proposal. Leaving live mode, New lens, backgrounding, or camera interruption stops requests. Main-thread generation checks discard late results after these actions.

**Review & export** shows downsampled original previews, sharpness, central clipping, depth-frame count and a suggested outline frame. These are capture quality hints, not accepted measurements. Export preserves full original JPEGs and the existing pose/depth archive contract. Printed scale and final contour approval happen in the web workflow.

Controls scroll on small iPhones while the camera retains a 260-point height. Capture checks every saved frame against an 85 MB budget including a conservative raw-cloud reserve. A rejected frame is removed before manifest append, keeping prior frames exportable beneath the 90 MB ZIP budget; the reserve leaves room for archive headers and manifest metadata.

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

- In Live segmentation, configure the HTTPS GPU server/key, check central prompt and overlay alignment in portrait and landscape, and test slow responses, missing GPU, rejected access keys, server redirects and loss of connectivity. Never accept an old overlay as a measured outline.
- In Outline video burst and Depth arc, verify automatic stop after 12 attempts, manual stop during a write, busy-frame skips, interruption cancellation and review/export. A slow device may save fewer than 12 frames.

- On a non-LiDAR iPhone, capture empty/lens/arc views, export and import: photos/poses must work with no depth or cloud.
- On a LiDAR iPhone, compare a rigid opaque target at a ruler-measured distance against depth/PLY; verify +X/+Y/−Z signs and metre-to-millimetre conversion. Then inspect missing/background returns on the clear lens separately.
- Capture portrait and both landscape holds. Import original and enhanced JPEGs and verify four marker coordinates, lens orientation, and projected depth align in the stored sensor axes.
- Open/dismiss the share sheet and continue the same capture. Background/foreground or interrupt the camera: further captures must require New lens, and the old archive must still export.
- Rapidly tap capture/export, reach 60 frames, start a New lens, and test low storage/camera permission denial. There must be no duplicate queued capture, frozen controls, or partial referenced files.
- Under reflective lighting, compare repeated lens captures and calipers against the pipeline's proposed 0.5 mm repeatability gate. No accuracy is claimed until this and a physical rim coupon pass.
