# Short video capture for transparent lens edges

Research and CPU-only video inspection: 3 October 2026. This is an experimental capture plan, not a depth-reconstruction or accuracy claim.

## Current experiment scope

An opt-in web capture route, `?capture=sweep`, is implemented alongside the default quick capture. It collects 3–5 frames with distinct normalized marker quadrilaterals over approximately 1.2–4 seconds, sends their original views at up to 1600 px / JPEG quality 95%, refines each edge independently, and applies the existing strict whole-contour consensus in sheet millimetres. A reference photograph is retained for review. Different marker quadrilaterals indicate image/view change; they do not establish useful lighting variation or a known camera displacement.

This first experiment **does not** jointly aggregate edge probabilities, infer lighting, reconstruct surface depth, or correct lens-height parallax. The more capable edge-evidence aggregation described below is follow-up work. Keeping the default quick capture available allows a controlled comparison while persistent/competing-edge failures are investigated. Availability and device performance must be confirmed against the deployed build.

Release checks: 146 web tests passed, including exact JPEG provenance, diversity after outlier rejection, missing calibration, unsupported refinement, removal between lenses and cancellation. The public v24 page loads. A real phone sweep on the calibrated sheet remains untested; the previously supplied videos do not contain the four markers. The flashlight protocol below requires an original video or separate photos; the current sweep collector requires camera-view variation and does not automate a fixed-camera lighting sequence.

**Known unresolved failure:** the user identified the blue contour at the bottom-right of the lens as following its shadow instead of the physical rim. Treat that observation as a wrong edge, even if its contour is smooth or repeatable. A fix for grid-related false rejection does not correct this edge-selection error. Paired-gradient edge selection is being investigated; it is not yet evidence that the shadow problem is solved. Current whole-contour consensus must not be described as removing shadows.

## Recommendation

Use a **short, almost overhead sequence with changing reflections**, and combine image-supported edge evidence after registering each frame to the printed sheet. Prefer a stationary phone plus a small change in illumination for the first controlled experiment. Compare that with a small phone movement under fixed illumination. A wide orbit is unsuitable for the first metric contour pipeline because the lens edge is above the sheet plane.

This can improve edge selection without retraining SAM. More frames provide additional observations; they do not by themselves fine-tune the model or establish physical accuracy. Keep the original photographs available through the existing Photo/Outline review.

## What changes between frames

| Component | With a stationary lens and sheet | Consequence |
|---|---|---|
| Printed grid, text and stationary surface dirt | Remain fixed after sheet registration | A median can preserve them perfectly. Temporal consistency alone cannot identify the lens. |
| Cast shadow with fixed light | Generally remains fixed on the sheet despite camera movement | A phone sweep does not reliably average it away. The phone can also alter illumination by blocking light. |
| Reflections on the lens | Can move or change with view or illumination | Several views may expose an edge hidden by glare in another frame. A highlight is not a material point to triangulate. |
| Refraction of the background | Changes according to lens geometry, viewing rays and optical properties | Apparent background features inside the lens are unreliable correspondences for its surface. |
| Actual edge above the paper | Does not obey the paper's planar homography exactly | Camera translation causes residual displacement after sheet registration. |

OpenCV documents homography as a mapping between planes; its perspective correction is valid for the represented plane. It is not an orthographic scan of a curved object above that plane. [OpenCV homography tutorial](https://docs.opencv.org/4.13.0/d9/dab/tutorial_homography.html)

The light-path triangulation research explicitly models the changed light paths introduced by refractive/specular objects. This supports treating reflected/refracted features differently from ordinary surface features, rather than feeding them to generic point-cloud matching and assuming the result measures the lens. [Kutulakos and Steger, *A Theory of Refractive and Specular 3D Shape by Light-Path Triangulation*](https://www.microsoft.com/en-us/research/wp-content/uploads/2005/05/tr-2005-12.pdf)

### Parallax can exceed the desired tolerance

For an illustrative pinhole camera at height `D` above the sheet, an edge point at height `h`, and a lateral camera displacement `b` at constant height, its displacement in sheet-rectified coordinates is approximately `b × h / (D − h)`. This is a simple geometric calculation, not a measurement of the supplied lenses.

At `D = 300 mm`, `h = 3 mm`, and `b = 50 mm`, the residual is approximately **0.51 mm**. Even the apparent scale of an elevated, parallel outline is enlarged by `D / (D − h)` in this simplified model. The real lens has varying height and view-dependent visible edges. Averaging does not automatically remove that bias.

Therefore, do not align contours independently to make a sweep look consistent. Preserve the sheet coordinates and reject disagreement. To support larger viewpoints later, measure the edge plane/profile and camera intrinsics/pose, or use a controlled fixture with a reference at the relevant edge height.

## Cheap pipeline to prototype

1. **Acquire 2–3 seconds locally.** Keep the video preview responsive. Collect a bounded set of sharp frames, approximately five usable observations, instead of sending every preview frame to the GPU. The duration and count are initial experiment settings.
2. **Check the reference in every candidate.** Require all four sheet markers, sufficient pixel coverage, focus and usable exposure. Reject a moving lens, paper movement, clipped rim or failed calibration. Record timestamps and the actual candidate images.
3. **Rectify to a shared millimetre coordinate system.** Use the sheet homography separately for every accepted image. Maintain raw images and original pixel-to-sheet mappings. Avoid per-lens recentering, rescaling or rotation to hide disagreement.
4. **Find a coarse lens region, then image-supported edges.** SAM supplies localization. The local edge-refinement search supplies competing candidate edges and evidence around that region. Give weak, blurred or glare-affected sectors lower weight. Never average a large grid/text mask into the lens.
5. **Aggregate edge evidence by sector before choosing one loop.** For corresponding normal/radial search locations, combine normalized edge costs robustly across frames. Select a path supported by several distinct observations. Keep alternative peaks long enough to detect a competing shadow or bevel edge. A median of final contours alone loses this ambiguity.
6. **Reject persistent competing edges.** If the same false edge dominates every frame, neither a median nor smoothing fixes it. Trigger a brief light-adjustment cue or a different capture rather than bridging the uncertain region silently.
7. **Apply bounded final cleanup.** Preserve asymmetric corners. Record raw outlines, image-refined outlines, contributing frames, rejected observations and physical-unit displacement limits. Export only after the existing geometric and review gates pass.

The current code already provides image edge refinement and sheet-coordinate contour fusion. The proposed addition is selection of genuinely varied, usable observations and aggregation of their image evidence; the current median must not be advertised as that complete implementation.

An optional registered empty-sheet image can expose stationary print/background structure. Treat differences as another cue: refracted grid lines and changed illumination make simple pixel subtraction unreliable. Do not erase every printed line near a real rim.

## Two inexpensive capture comparisons

### A. Fixed phone, varied light — first choice

Put the lens and sheet flat and stationary and support the capture phone almost overhead. Use a **second phone's flashlight** for three separate observations: light off, light from the left, and light from the right. Keep the capture phone, lens and sheet fixed. Avoid shining the flashlight directly into the camera; use diffuse illumination where practical. Retain consistent exposure when the camera permits it, while still checking for clipping or underexposure in every observation.

This is a controlled experiment: compare whether the suspected shadow edge changes while an independently checked physical rim remains supported. It does not justify assuming that every stable edge is correct or every moving edge is a reflection. Save all three original images and competing edge proposals; do not silently choose the darkest, brightest or outermost boundary. An empty-sheet reference under the same lighting states can help identify print/background structure.

An onboard **continuous torch** may be offered only when the active camera advertises the relevant capability and applying it succeeds. Torch is defined by the image-capture specification, but that definition does not guarantee support in Brave on iPhone, any other browser, or a particular camera. Continuous illumination from a light fixed beside the capture camera also provides less lighting-direction diversity than the separate-phone test. Do not enable a default strobe or make flashlight availability a capture requirement. [W3C MediaStream Image Capture](https://www.w3.org/TR/image-capture/)

### B. Small phone sweep, fixed light

Make a gentle movement while keeping the four markers visible. Start with approximately 10–20 mm lateral travel near the overhead position as an **unvalidated protocol setting**, not a guaranteed accuracy envelope. Compare sheet-registered edge displacement with A. If it exceeds the fusion tolerance, stop asking the user to hold still indefinitely and request a more overhead capture or adjusted lighting.

Test a larger orbit separately as an experimental depth mode. The cheap contour workflow should not wait for COLMAP or claim its background points represent the transparent lens surface. Research systems that capture these objects use explicit optical/background models and controlled acquisition. [MERL, *Acquisition and Rendering of Transparent and Refractive Objects*](https://merl.com/publications/TR2002-30)

## Evidence from the supplied videos

Inspected local `IMG_1620.mov` and `IMG_1621.mov` with FFprobe and OpenCV; no GPU model or segmentation service was started. Five evenly distributed frames per file were extracted, visually reviewed, and passed through the production `detectSheetMarkers` function.

| File | Encoded video | Duration | Video frames | Frames inspected | Four-marker detection |
|---|---|---:|---:|---|---|
| IMG_1620.mov | H.264, 1280 × 720, nominal 59 fps | 11.492 s | 677 | 1.137 / 3.446 / 5.737 / 8.029 / 10.337 s | 0 of 5 |
| IMG_1621.mov | H.264, 1280 × 720, nominal 59 fps | 18.898 s | 1,113 | 1.885 / 5.654 / 9.441 / 13.227 / 16.997 s | 0 of 5 |

Visual observations: both show a loose lens on a marked/dirty pale surface, changing framing/view, and changing rim visibility. The first contains bright edge reflections; the second has darker/tinted appearance and visible surface markings through the lens. No printed four-marker capture sheet is visible in the ten sampled frames. Several samples place the lens close to an image edge.

**Usable evidence:** these files can stress-test raw edge visibility, glare handling, blur and tracking in image coordinates. They cannot validate the proposed sheet-rectified multi-view fusion or millimetre accuracy from the sampled footage. No known scale or caliper ground truth accompanies it. A new sequence on the printed sheet is required for that test.

Temporary local artifacts from this inspection:

- `%TEMP%/IMG_1620.mov-sweep-contact.jpg`
- `%TEMP%/IMG_1621.mov-sweep-contact.jpg`
- `%TEMP%/optiframe-sweep-video-evidence.json`

## Minimal benchmark before enabling a guided sweep

Use one clear lens, one dark lens and the empty sheet. For each lens, record a stationary baseline, protocol A and protocol B with identical sheet placement, plus an independent repeat. Measure physical width/height and compare a 1:1 outline at several edge locations. Keep ambiguous rim/bevel locations labelled separately from known ground truth.

Report: acceptance rate; false capture on the empty sheet; edge disagreement by sector in millimetres; dimension bias against the physical measurements; clipped/blurred-frame rejection; retained frame count; and acquisition plus refinement time on the actual phone/network. Compare raw SAM, single-frame image refinement, current contour median, and multi-frame edge-evidence aggregation. A cleaner-looking path or lower between-frame variance alone is not a successful accuracy result.
