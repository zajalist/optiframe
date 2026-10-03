# Low-cost transparent-lens capture pipeline

**Decision:** build a calibrated **2.5D lens model**: an accurate 2D perimeter plus a few manual side measurements. Do not make a LiDAR point cloud or Gaussian splat the source of the printable rim. The model's job is to hold existing lenses, not reconstruct their optical surfaces.

This is a proposed workflow to test on actual lenses, not a claim of achieved accuracy.

## Why this pipeline

Transparent lenses transmit, refract, and reflect light. RGB segmentation can mistake the visible background for the lens; RGB-D/phone depth can return missing points or the background depth. Apple's ARKit depth is lower resolution than its camera image. Research on transparent surfaces often uses controlled illumination, coded backgrounds, or polarization to reveal boundaries. We can borrow the **controlled background** idea with a phone and printed sheet, while keeping the user in control of the final contour. [Transparent-object digitization review](https://isprs-archives.copernicus.org/articles/XLIII-B2-2022/695/2022/), [RGB-D depth failure](https://arxiv.org/abs/2104.00622), [Apple ARKit depth explanation](https://developer-rno.apple.com/jp/videos/play/wwdc2020/10611/), [coded-background reconstruction](https://arxiv.org/abs/2009.09144)

## Capture kit

- A phone with a high-resolution rear camera and a simple fixed stand.
- A printed sheet with **four scale markers outside the lens area**, a fine high-contrast pattern in the centre, and one ruler line. Print at actual size and verify the ruler line with a physical ruler. If the marker pattern is distorted through the lens, it must not be used for calibration.
- A matte light/dark alternate sheet and a cheap oblique LED light for an extra edge-revealing photo.
- Calipers or a ruler for width, height, and edge thickness; a second photo from the side for pronounced curvature.

No specialized depth sensor, optical coating, powder, or spray is required. Avoid applying scanning sprays to prescription lenses or their coatings.

## User capture, per lens

1. Mark `L` or `R`, top orientation, and the optical centre or fitting mark supplied by the eye-care provider. Photograph this identification once.
2. Fix the phone above the capture sheet, near perpendicular, with all four markers in view. Use the rear camera at high still-image resolution, no flash, and enough distance to reduce perspective difference between the sheet and the elevated lens edge.
3. Photograph the **empty patterned sheet**. Place the lens without moving the phone or sheet and photograph again. This is the two-shot mode.
4. If the rim is not visible, photograph the lens on the matte alternate sheet under oblique side lighting. A backlit white sheet can be tested, but should not be assumed to give a clean opaque silhouette.
5. Measure edge thickness with calipers. For a noticeably curved lens, take one side photo with a ruler and record the maximum bow/edge offset. Do not infer these values from the top image.

The first implementation can try a **single lens-on-sheet photo**. Add the empty-sheet comparison only if single-image contouring fails on the real lenses. This keeps the phone interaction short.

## Image processing

1. **Check capture quality.** Require four readable markers, adequate sharpness, no clipped rim, and no strong glare over a long edge segment. Ask for recapture otherwise.
2. **Set scale.** Detect the four known-position markers and rectify the sheet plane into millimetre coordinates. Verify the printed reference length; an unverified printer scale makes a precise-looking result meaningless. OpenCV supports marker detection, homographies, and contour extraction. [OpenCV ArUco boards](https://github.com/opencv/opencv/blob/5.x/doc/tutorials/objdetect/aruco_board_detection/aruco_board_detection.markdown), [OpenCV homography](https://docs.opencv.org/4.12.0/d1/de0/tutorial_py_feature_homography.html), [OpenCV contours](https://docs.opencv.org/4.12.0/d4/d73/tutorial_py_contours_begin.html)
3. **Propose an edge.** For a plain sheet, look for the rim's local colour/gradient change. For two-shot mode, align the empty and lens images by their markers, then compute a difference/gradient map. Refraction should disturb the pattern under some lenses; edge reflections may add a stronger boundary. This simplified difference method is an *engineering hypothesis* inspired by coded-background research, not a proven lens scanner.
4. **Enforce one plausible closed contour.** Keep the closed boundary around the expected lens region; suppress isolated glare, scratches, and background features. Smooth tiny pixel noise while retaining corners and not silently moving the edge by an unmeasured amount.
5. **Human correction.** Overlay the proposed contour on the original full-resolution image. Let the user drag local points or trace a missing segment at zoom. Mark weakly supported portions for inspection. A promptable AI mask, such as SAM 2, may propose regions, but must never be the final millimetre boundary without this review; transparent-object segmentation remains difficult even for general models. [Meta SAM 2](https://ai.meta.com/research/sam2/), [2026 transparent-boundary segmentation research](https://doi.org/10.1109/WACV61042.2026.00328)
6. **Store geometry.** Save the final closed perimeter as XY points in millimetres, plus the original image, calibration data, correction history, top/optical-centre marks, and edge measurements. That makes every frame dimension auditable.

## From contour to a useful 3D frame

For a shallow-curved lens, use the measured 2D boundary and edge thickness to create the rim and a test coupon. If side-view bow matters, lift the rim perimeter into a **simple fitted curve** based on the side photo and measured offsets. This is a sparse 3D rim path or 2.5D model, **not a measured point cloud of the transparent surfaces**. A two-part retaining rim avoids needing to infer a detailed bevel profile from photos.

If a high-curvature lens cannot seat in the coupon, stop and flag it as outside the current capture range. Do not let a pretty 3D preview override a failed physical fit.

## Validation and decision gate

Test the actual workflow on at least one visibly asymmetric pair and, if available, a clear/tinted or anti-reflective-coated variation. For each lens:

- Capture twice with the lens lifted and replaced. Compare width/height and perimeter overlays; repeated width/height within **0.5 mm** is a proposed go/no-go target, not a measured capability.
- Compare maximum width/height against calipers and a full-scale paper print of the extracted contour against the physical lens. Width/height alone can hide a local shape error.
- Print a short rim coupon, seat the real lens, and tune one clearance setting. Inspect for slip, stress, and curvature mismatch.
- Import the exact downloaded STL into a slicer and check dimensions, mesh closure, bed fit, and first-layer preview.

If the two-shot method does not improve the contour on the test lenses, remove it and keep the single-photo capture plus manual correction. If neither photo gives a visible rim, use a guided manual trace with a ruler-verified scale; do not fabricate an automatic scan.

## Point clouds: narrow use cases

| Point-cloud source | Use for this hackathon? | Reason |
| --- | --- | --- |
| Phone LiDAR aimed at a clear lens | **No, for lens measurement** | Missing, background, or reflected depth can corrupt the edge; lower resolution than the photo. |
| Multi-view photogrammetry or Gaussian splats of the lens | **No, for lens measurement** | Refraction and specular appearance make recovered geometry unreliable without special methods. |
| Sampled 2D contour with side-view heights | **Yes, as a 2.5D CAD input** | Explicit, inspectable approximation sufficient to test a retaining rim. |
| Face scan for nose/temple shape | **Later** | Could improve wearer fit, but does not solve transparent-lens detection or optical-centre placement. |

## Research status

The cited research supports the *failure modes* and the use of controlled visual cues. It does **not** establish that this exact low-cost two-photo setup reaches a specific tolerance. That must be measured with the selected phone, lens materials, capture sheet, and printer.
