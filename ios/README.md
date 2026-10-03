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
