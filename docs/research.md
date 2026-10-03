# Research and technical decisions

Researched 2026-10-03. Sources below are primary research, standards bodies, or official tool documentation where possible. The challenge brief supplied by the team defines four judging stages: **measurement, AI, design, validation**. We have not found a longer public rubric, so no unverified point weighting is assumed.

## 0. The actual problem: match lenses to a person, then build the frame

The humanitarian use case is an inventory mismatch: available frames may not fit a recipient, and a person may need different corrections in the right and left eyes. A geometrically compatible frame is useful only after a qualified eye-care provider verifies that *each* lens's optical properties suit that person. The app should help position and mount suitable lenses, not treat every donated lens as usable.

This boundary matters. WHO's 2025 guidance advises against offering recycled spectacles directly to users in low- and middle-income countries, citing prescription mismatch, condition, hygiene, and effects on local eye-care services. OptiFrame should be framed as a tool for local providers working with inspected lenses and local fitting, not a substitute for eye care or a generic shipment of used glasses. [WHO, *Summary guide on quality standards for spectacles*, p. 18](https://iris.who.int/bitstream/handle/10665/381356/9789240109483-eng.pdf?sequence=9)

There are **two matching problems**:

| Match | Required inputs | App output |
| --- | --- | --- |
| Optical | Recipient's right/left prescription; provider-verified lens power, axis, type, orientation, and marked optical centres | Accept only lenses the provider has approved; retain their identity and orientation. |
| Geometric | Lens contours and thickness; recipient's monocular pupil positions, fitting heights, and basic face/bridge width | Position left and right lenses independently; derive bridge, rims, and temples; flag impossible placements. |

A frame can move existing lenses relative to the eyes, but it cannot change their optical power. Cutting or reshaping a lens requires optical equipment and may move the usable optical zone; it is outside the hackathon's automatic workflow. Professional dispensing workflows measure lens power with lensometry and separately measure pupil distance and optical-centre/fitting-cross heights. [American Optometric Association, 2026 paraoptometric handbook](https://www.aoa.org/AOA/Documents/Education/Education_PDFs/2026%20Paraoptometric%20Handbook%20FINAL%202.5.2026.pdf), [ZEISS fitting guide](https://www.zeiss.com/content/dam/Vision%20Care/Vision/en_us/PDF/ECP/ZEISS_Individual_PAL_SV_Fitting_and_Dispensing_Guide_16030.pdf)

**Decision:** model each lens as a verified inventory item with its own contour, prescription metadata, optical-centre mark, and top orientation. Model the wearer with separate right/left pupil offsets and heights. If a required optical value is missing, the app says **verification needed** rather than claiming a safe match.

## 1. What needs measuring

The frame needs the *outer boundary of each actual lens* in millimetres, its optical-centre location and orientation, and enough information about the edge to retain it. Left and right must be independent; mirroring one lens would miss the challenge's asymmetric case. The wearer's pupil positions constrain relative lens placement; the bridge is then designed to join those positions and fit the nose.

ISO 8624 is the current spectacle-frame measuring system and vocabulary. It provides a sound basis for reporting boxed lens width, height, and bridge distance. Its stated scope is symmetrical frame fronts, so our asymmetric design should use its terms without claiming conformity. [ISO 8624:2020](https://www.iso.org/standard/75385.html)

A 2D photo cannot recover the lens edge profile or optical prescription. We should record left/right, optical-centre mark, and top orientation before capture, ask for an edge thickness measurement or side photo, and test the retention geometry physically. Mounted prescription lenses have separate requirements relative to the prescription order. A hackathon prototype should not claim to verify those requirements. [ISO 21987:2017](https://www.iso.org/standard/65161.html), [ISO technical report on 3D lens properties and markings](https://www.iso.org/standard/83919.html)

**Decision:** measure the contour from a controlled top-down image; request one manual edge-thickness value per lens; retain the lenses with a testable printed rim. Preserve optical-centre and orientation marks in the model and UI.

## 2. Why not Gaussian splats for metrology

Transparent and reflective surfaces violate assumptions used by ordinary image-based 3D reconstruction. A survey of glass digitization reports poor metrological performance for common optical methods without special treatments or models. Current transparent-object Gaussian-splat research adds geometry-aware supervision precisely because conventional splatting struggles with refraction and transmission. Those methods are interesting research, but their visual quality is not proof of millimetre-scale edge accuracy. [Glass digitization review](https://isprs-archives.copernicus.org/articles/XLIII-B2-2022/695/2022/), [geometry-aware transparent Gaussian splats](https://www.sciencedirect.com/science/article/pii/S0952197626000680)

**Decision:** no splats in the measurement path. A face scan or splat-based presentation can be added only after the physical fit is working.

## 3. Capture and image geometry

Use a printed capture sheet with four markers of known positions outside a clear central area. Print at 100% scale, verify one reference distance with a ruler, and place the lens close to the marker plane. A guided phone photo can be captured in a mobile browser; OpenCV can locate markers, compute a perspective transform, and return contour points from a mask. [MDN mobile camera capture](https://developer.mozilla.org/en-US/docs/Web/API/Media_Capture_and_Streams_API/Taking_still_photos), [OpenCV ArUco board detection](https://github.com/opencv/opencv/blob/5.x/doc/tutorials/objdetect/aruco_board_detection/aruco_board_detection.markdown), [OpenCV homography](https://docs.opencv.org/4.12.0/d1/de0/tutorial_py_feature_homography.html), [OpenCV contours](https://docs.opencv.org/4.12.0/d4/d73/tutorial_py_contours_begin.html)

**Inference:** perspective correction accurately maps the *reference plane*. Lens curvature, lens height above the sheet, camera distortion, blur, glare, and a misprinted sheet remain error sources. The app should ask for a near-perpendicular photo, reject missing markers or blur, and let the user correct the outline. Validation must measure the resulting error on the actual device.

The easiest segmentation setup is a consistent matte background and controlled side lighting that makes the edge visible. Test light and dark surfaces with the team's lenses first. If transparent centres confuse segmentation, use the edge to infer a closed contour rather than treating the lens as an opaque blob.

## 4. Where AI earns its place

Promptable segmentation models such as SAM 2 accept points, boxes, or masks and let users refine the selected object. That is useful as an *outline proposal* when a simple threshold or edge detector fails. A lens is a difficult target, so the model output must be editable and checked against the original image. It should never turn an uncertain edge into a false precision claim. [Meta SAM 2](https://ai.meta.com/research/sam2/)

**Decision:** first make a deterministic contour that works on a controlled capture sheet. Add one real AI-assisted segmentation path and show before/after corrections in the UI if time allows. Do not build an AI agent, train a model, or use a language model to invent dimensions.

## 5. Frame and printing constraints

The actual lens edge must stay captured after printing and assembly. ISO 12870:2024 includes additively manufactured spectacle frames and outlines construction, dimensional, mechanical, and other requirements. A demo frame is not automatically certified by producing an STL. [ISO 12870:2024](https://www.iso.org/standard/75916.html)

For the prototype, a **two-part retaining rim** is the simplest geometry worth testing: a front frame lip and a rear retaining lip clamp the measured perimeter, with screws at planned attachment points. This is a design hypothesis, not a sourced standard. It avoids guessing a V-groove from a single top photo; it still needs a physical coupon to determine clearance and accommodate the real lens curvature. If a specific pair has a known bevel and a split-rim design proves simpler, switch after testing.

Printer fit is machine- and material-dependent. Prusa's guidance explicitly recommends tolerances for mating parts and says there is no universal value; it cites roughly 0.2 mm printer accuracy as a starting point, with warping and shrinkage still relevant. This supports an adjustable clearance parameter and a coupon, not a universal tolerance claim. [Prusa dimensional-fit guidance](https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135)

For web delivery, Three.js can preview and export binary STL. STL has no built-in units or print settings, so the app should label dimensions as millimetres and export coordinates consistently in millimetres. A visualization mesh is not sufficient: every printed part must be a closed manifold solid, and disconnected parts must be separated and laid flat without collisions. Prusa's modeling guide identifies manifold geometry as a slicer requirement; its slicer guide calls out orientation, spacing, floating parts, and supports. [Three.js STLExporter](https://threejs.org/docs/pages/STLExporter.html), [Prusa modeling guide](https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135), [PrusaSlicer first-print guide](https://help.prusa3d.com/article/first-print-with-prusaslicer-3-0-0_1079761)

**Decision:** the primary download is a single binary STL containing the front, retainers, and any other custom printed parts as separate, non-overlapping shells arranged at `z=0` for the selected print bed. The user should not need to repair geometry, rescale, rotate, or manually separate parts. A printer-specific 3MF can be added later; universal ready-to-run G-code cannot be promised without a known printer, filament, and slicer profile.

## 6. Physical validation beats a prettier render

A compelling evidence chain is: calibration sheet verified -> each lens contour measured twice -> key dimensions compared with calipers -> printed 1:1 outline checked against the lens -> printed rim coupon assembled with a real lens -> final frame preview and STL. This directly addresses the challenge's validation stage and exposes failures early.

**Proposed engineering gates, not measured results:**

- Reference distance on printed sheet checked before capture.
- Two captures of each lens agree on width and height within 0.5 mm; otherwise recapture or edit.
- Measured width and height are within 0.5 mm of caliper measurements on selected test lenses; report actual errors, including failures.
- Lens seats in a coupon without visible forced bending and does not fall out under a gentle handling test.
- Downloaded STL contains all custom printed parts, opens in a slicer at the expected millimetre dimensions, fits the chosen bed, and slices without repair or manually moving parts.

These gates are ambitious targets. The observed results should be recorded in [validation.md](validation.md), not silently assumed.

## 7. ARKit and the web-app constraint

ARKit's raw tracking and scene-depth APIs are iOS app APIs. Apple documents scene depth through an `ARSession` in a native app, on supported LiDAR devices; a normal Safari web page cannot directly call that API. WebKit staff state that WebXR `immersive-ar` is not supported on iOS. [Apple ARKit scene depth sample](https://developer.apple.com/documentation/ARKit/displaying-a-point-cloud-using-scene-depth), [WebKit issue and staff response](https://bugs.webkit.org/show_bug.cgi?id=309550)

Safari **can** launch Apple's AR Quick Look from a website using a USDZ model. That is useful for an optional visual preview of the completed frame, but it does not give the web app ARKit's raw depth map or a metrology-grade scan. [Apple AR Quick Look for web pages](https://developer.apple.com/documentation/arkit/previewing-a-model-with-ar-quick-look), [Apple Quick Look gallery](https://developer.apple.com/quick-look-gallery/)

**Decision:** keep the core capture, measurement, frame generation, and slicer-ready STL in a normal mobile web app. Use the phone camera plus a printed scale board for lens measurements and a browser 3D preview. Add USDZ/Quick Look only if time remains. A separate native iOS capture helper would be an additional product, not a web-only implementation.

## Open risks and scope limits

| Risk | Early test or response |
| --- | --- |
| Transparent edge cannot be reliably segmented | Try alternate lighting; use a manual contour editor; keep AI proposal optional. |
| Lens is curved or sits above marker plane | Photograph farther away and near-perpendicular; compare with calipers; choose modest-curve demo lenses. |
| Lens slips or is squeezed | Print a short rim coupon and tune clearance and lip geometry before a whole frame. |
| Assembly geometry looks good but STL cannot print | Check mesh closure, part spacing and bed fit; import and slice the actual downloaded file before demo. |
| Available lenses do not match the person's prescription | Reject the pair for that recipient; a new frame cannot fix lens power. |
| Optical centres cannot align while rims and bridge fit | Flag the geometry as infeasible; choose another lens pair or have the provider revise the fitting plan. |
| Different lens powers or optical centres | Preserve lens identity, left/right/top and centre markings; have a provider verify any wearable pair. |
| Demo printer unavailable | Have a printable 1:1 paper outline and slicer-verified STL as fallback, but treat physical fit as unverified. |
