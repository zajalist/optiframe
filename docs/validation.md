# Validation record

Use this as a lab notebook during the hackathon. Report observed measurements; never turn the target gates into claimed results.

## Capture setup

| Field | Value |
| --- | --- |
| Date / device | TBD |
| Lens identifiers and top marks | TBD |
| Left/right measured edge thickness (mm) | TBD / TBD |
| Provider and prescription verification for each lens | TBD |
| Optical-centre marks / monocular pupil positions / fitting heights | TBD |
| Wearer frame width / bridge or nose fit measurements | TBD |
| Capture sheet reference distance, nominal / ruler checked | TBD |
| Background / lighting / camera distance | TBD |
| Printer / material / layer height | TBD |

## Measurement checks

| Lens | Capture 1 width × height (mm) | Capture 2 width × height (mm) | Caliper width × height (mm) | Largest discrepancy (mm) | Outline visually checked? |
| --- | --- | --- | --- | --- | --- |
| Left | TBD | TBD | TBD | TBD | TBD |
| Right | TBD | TBD | TBD | TBD | TBD |

Take caliper measurements at the lens's maximum horizontal and vertical extents in the chosen orientation. Record the actual values and note if curvature makes that comparison ambiguous.

### In-phone measurement gate

Print the sheet at 100%, without fit-to-page. Physically verify both 100 × 70 mm marker-centre spans and the 50 mm check line; homography cannot detect a uniformly mis-scaled print. Tap the white centres in order 1–4. Crossed, reversed, tiny or severely foreshortened marker layouts are rejected.

For each lens, enter real caliper width and height. Tap its provider-identified optical-centre mark and a distinct physical top mark. Save the first rectified capture dimensions, then load a different independently taken photograph of the same lens. Calibrate, review the second contour, and tap the same two physical marks again. The saved values survive loading a photo so the phone displays independent-repeat and caliper discrepancies against the current contour. Both width and height must differ by **no more than 0.5 mm** for both checks. Blank or invalid values remain pending. The evidence checkbox confirms actual calipers, an independent photo, and physically checked print scale; it resets on photo load and when saving repeat dimensions.

The save button also retains the first rectified outline in millimetres and its photo identity. The app translates each outline to its marked optical centre and rotates its marked top to the vertical axis before comparing independent photos. It applies no scale or shape fitting. It samples each edge at spacing no greater than 0.25 mm, finds the distance to the other contour's nearest line segment in both directions, and reports the symmetric maximum sampled distance. This **edge repeatability** must be ≤ 0.5 mm for checked export. Equal bounding dimensions alone cannot pass a changed outline. This is a sampled repeatability metric, not a guarantee of continuous contour distance or edge accuracy against the real lens. A wrong or imprecise top mark can hide or create edge discrepancies, so verify the same physical mark in both photos.

Use **Print 1:1 outline** for each rectified lens. It produces an A4 SVG with millimetre dimensions, optical-centre cross, physical top indication, and an independent 50 mm line. Print without fit-to-page scaling, check the line with a ruler, then place the actual loose lens on the contour in its marked orientation. Record edge deviations at multiple positions, especially corners or notches. This physical overlay is a proof tool; it cannot certify optical power, groove geometry or retention. A top mark less than 5 mm from the optical centre is rejected because small tap errors would produce unstable rotation.

The measurement-checked STL download requires these checks, a four-marker homography, an optical-centre mark and a top mark for both lenses. Confirmation is revoked whenever the contour, calibration, either mark, photo or benchmark inputs change; the raw entered reference values remain available for comparison. Numerical discrepancies are recomputed against the edited geometry and the operator must confirm its physical evidence again. Both exports and the preview wait for photo loading or ZIP import to finish. Selecting a new photo or ZIP supersedes pending imports; outdated import results cannot replace it. The explicitly **UNVERIFIED experimental STL** route permits fit experiments with two-point scale or missing physical evidence; it warns when lens orientation comes only from the photo. These are browser workflow gates, not server-side certification or tamper-proof evidence.

The app reports worst sampled local mm per working pixel and source pixel, including its 1600-pixel image downsampling. This is sampling resolution, not a precision guarantee. Size agreement does not establish every lens-edge point within 0.5 mm: curvature, parallax above the sheet, glare, manual marker placement and contour editing still need independent physical assessment. No real-lens accuracy result has been recorded here.

Run synthetic calibration and browser state checks with `node --test web/calibration.test.mjs web/measurement.test.mjs`. They test homography, invalid marker geometry, contour dimensions, the pass threshold, downsampling math, revoking evidence after edits and blocking export during photo loading; they provide no physical accuracy evidence.

### Service observations (2026-10-03)

Printed-background preprocessing comparison: SAM now receives the original pixels from a lens-target crop with 18% context padding, instead of a contrast-enhanced full page. Target-centred masks are mapped back by integer translation; masks reaching the crop boundary are rejected. This removes surrounding page text and many markers from model context without inpainting a possible lens edge. Grid visible through the lens remains present. Three warm local RTX 5070 runs per case measured approximately 57–61 ms for the isolated dark-lens target and 60–61 ms for the clear-lens screenshot target, compared with approximately 81–88 ms for warm full-page processing (one 215 ms startup-adjacent run excluded from that range). The clear case is a screenshot containing the earlier bad overlay, not a raw calibration photo. Visual inspection found complete lens contours in both cases. Cropping shifted some contour bounds by 1–4 pixels, so this is not evidence of improved physical accuracy. An overly wide prompt still selected the grid in both variants; automatic marker-based targeting and measurement rejection remain necessary.

End-to-end regression with the supplied 960 × 1280 dark-lens photo on the printed 100 × 70 mm sheet: the earlier wide SAM prompt selected the printed grid and falsely showed 104.4 × 76.6 mm with a blank outline. A lens-sized prompt returned a 114-vertex contour around pixel bounds [354, 308]–[604, 478]. Grid-line-resistant automatic marker detection found centres [282, 263], [680, 255], [704, 520], [283, 535]. The live public web flow displayed the rectified outline at **61.2 × 44.5 mm**. This is a visual and software regression check, not a millimetre accuracy benchmark: the physical lens has not yet been measured with a ruler or calipers. The web flow now rejects sheet-sized contours and draws the result SVG visibly.

Local RTX 5070, protected FastAPI `/api/segment`, SAM2.1 small on CUDA: supplied 1280 × 720 video frames returned HTTP 200 in 8.88 s (IMG_1620 at 5 s) and 9.4 s (IMG_1621 at 8 s); prior visual inspection reported contours of 81 and 88 vertices. These observations demonstrate request success and latency only. No corresponding caliper dimensions or independently measured lens-edge errors are available.

Visual check of the saved overlays: both green contours broadly follow the visible circular lens rim despite bright glare and marks on the background. The 1620 frame has a faint upper-left edge and highlights near the right edge; the 1621 frame has a bright top highlight and dirt visible through the lens. Those are useful stress cases for transparent-object segmentation, but a plausible overlay cannot show whether the chosen curve follows the true outer edge within 0.5 mm. Neither video frame contains the calibrated sheet in view, and there is no caliper ground truth. Treat these as **segmentation demonstrations only**, then repeat on the marker sheet with two independent captures for dimensional validation.

Local warm/cold latency check on the original 1280 × 720 JPEG from IMG_1620 (5 s), boxed around the lens, RTX 5070: isolated `gpu/benchmark.py --iterations 2 --gpu` took 14,772.75 ms on first SAM use and 90.95–95.18 ms on two warm runs (median 93.06 ms). The same live backend took 9,386 ms for its first local request, then 661 ms for a warm public-tunnel request including network and upload. This is a single image and small sample, so it is a direction for startup optimization, not a throughput guarantee or accuracy evidence. The live backend was warmed for phone testing.

October 3 live-update check with the existing public service, using a 1280 × 720 JPEG (16.5 KB) from the supplied video and the same lens box: three serial local `/api/segment` requests took **222, 90, 88 ms**; three HTTPS requests through the public tunnel took **653, 243, 243 ms**. With the live controller's 50 ms inter-request gap, the latter warm-path sample suggests roughly three updates per second in this network state. A client-side translation tracker moves the visible overlay between SAM responses at up to about 11 Hz, but those tracked positions are previews only; the captured contour comes from one completed SAM response and its own JPEG. Actual phone camera, upload size, radio latency, capture quality, and sustained thermal behavior are unmeasured. Longer filming selects among scored real frames; it does not fine-tune SAM weights or establish millimetre accuracy.

## Fit loop

| Revision | Clearance / edge-thickness settings | Coupon result | Change made |
| --- | --- | --- | --- |
| 1 | TBD | TBD | TBD |

Check that the lens seats without obvious forced bending, stays captured during gentle handling, and remains in its marked orientation. Record any crack, stress mark, or poor fit. Do not use a damaged lens for a wearable prototype.

## Wearer alignment and optical verification

Record the two vertical offset inputs as positions of the **marked lens optical centres** relative to one wearer baseline (positive up). These offsets and monocular PD place the printed rims; they do not establish that the resulting lens power, fitting height or prism is appropriate. Confirm each value and the completed frame on the wearer with an eye care professional.

| Eye | Lens prescription verified by provider? | Wearer's monocular pupil offset / fitting height (mm) | Lens optical-centre mark aligned? | Remaining concern |
| --- | --- | --- | --- | --- |
| Right | TBD | TBD | TBD | TBD |
| Left | TBD | TBD | TBD | TBD |

If prescriptions are missing or a lens is unsuitable, do not label the pair ready for a wearer. A 3D preview can demonstrate geometry while optical verification remains pending.

## Export check

### Synthetic slicer smoke test (2026-10-03)

PrusaSlicer 2.9.6 console imported the downloaded-format `plate.stl` generated from two synthetic asymmetric ellipses (25 × 19 and 23 × 17 mm radii; 32/31 mm monocular PD). It reported a **manifold mesh with 5 parts**, dimensions **212.19 × 99.19 × 13.50 mm**, and minimum Z=0. With a generic 220 × 220 mm bed, 0.4 mm nozzle, 0.2 mm layers and support enabled, it exported G-code without mesh repair or scaling. The generic estimate was 2 h 5 m and 17.77 cm³ filament. This checks software slicing of one sample only; the user's printer/material profile and physical lens fit remain untested. The temporary G-code is not a printer-ready file for an unknown machine.

The later independent-thickness/height version was also imported through PrusaSlicer `--info` with left/right edge thickness 2.2/3.1 mm and optical-centre heights +1.5/−1 mm. It reported 5 manifold parts, 212.20 × 99.17 × 13.50 mm and minimum Z=0. This is an import/mesh check; it was not sliced with the user's printer profile.

- [ ] The **downloaded** STL, not just the in-app preview, opens in a slicer.
- [ ] It contains the front and every other custom printed part; required screws or other hardware are listed.
- [ ] Each mesh is closed; the slicer reports no repair or missing surfaces.
- [ ] Slicer dimensions match the app's millimetre dimensions without scaling.
- [ ] Parts are flat on the bed, do not overlap or float, and fit the selected printer's build area without manual repositioning.
- [ ] Slice completes with the chosen printer/material profile; inspect first layer, thin walls, unsupported regions, and estimated print time.
- [ ] Final photo or short video shows the tested physical assembly.

## End-to-end regression, 2026-10-03

The `sheet-aware-lens-crop-v2` backend was exercised through the public HTTPS endpoint using the supplied dark-lens original photo and transparent-lens screenshot. All 18 tested prompt-size/position variations returned the lens rather than the printed sheet. This is robustness on two fixed images, not independent-capture or physical accuracy evidence. The screenshot contains the previous bad green overlay; the new review overlay is orange.

The backend preserves original pixels, excludes surrounding sheet context from SAM, rejects sheet-sized/irregular masks, and retries once with a tighter internal target when a recognised sheet permits it. It does not erase grid pixels visible through glass. Crowded and ambiguous marker layouts decline automatic sheet inference.

Warm direct GPU processing measured 62.4–138.9 ms across the prompt matrix. A separate eight-request benchmark with a 139,286-byte JPEG measured local HTTP median 71.5 ms (maximum 83.8 ms) and public HTTPS median 152.2 ms (maximum 598.1 ms, including first connection). These exclude phone encoding/rendering and cellular latency. Model cold load was about 12 seconds; the deployed service was warmed before handoff. The browser samples serially with a 50 ms gap, tracks between model updates, rejects responses older than two seconds, expires stale outlines, and recovers from request timeout/restart races. This is not a measured 30 FPS segmentation claim.

Both photos were rectified with the production JavaScript marker detector and 100 × 70 mm homography, then passed through public `/api/frame-preview` and `/api/frame`. Detected spans were about 61.07 × 43.69 mm and 48.15 × 45.09 mm. The test deliberately used **example** 36/34 mm pupil distances, 2.5 mm thicknesses and bounding-box centres/photo-up orientation; these are not wearer measurements or optical marks. Production fitting requires explicit patient values and provider-marked centres/tops.

The real contours exposed two now-covered regressions: densely sampled valid boundaries were falsely rejected as narrow sections, and float32 STL serialization collapsed numerical sliver triangles in the packed plate. The generator preserves these two measured contours exactly, checks nonlocal boundary separation, and reimports serialized STLs for watertight/positive-volume checks.

The downloaded test ZIP contains five individual parts plus `plate.stl`. All six files reload as watertight positive-volume meshes. PrusaSlicer 2.9.6 reports the plate manifold, five parts, 159.21 × 157.36 × 13.50 mm, minimum Z=0. The kit carries an `EXAMPLE-FIT-NOT-PATIENT.json` provenance file. Physical fit, printed tolerances, prescription alignment and actual phone camera/AR depth remain unvalidated.

Regression gates after integration: **44 Python tests and 70 web tests passed**. Web CI includes both `.mjs` and Android `.cjs` tests.

The same downloaded plate completed generic slicing with a 220 × 220 mm bed, 0.4 mm nozzle, 0.2 mm layers and supports. This smoke test validates slicer acceptance; its temporary G-code is not supplied as a machine-specific print file.

## Rounded interface release — 3 October 2026

The shared glass-control stylesheet preserves the capture JavaScript, keeps blur off camera/measurement surfaces, and includes opaque and reduced-transparency fallbacks. The 70 web regression tests passed again. Public GPU health reported CUDA and a loaded model; eight HTTPS segmentation requests on the same 139,286-byte dark-lens JPEG all returned HTTP 200 and a 132-point contour. Median request latency was 156.8 ms; the maximum was 662.4 ms including connection setup. These desktop HTTP timings exclude iPhone camera encoding, rendering and mobile networking. Physical iPhone camera operation still requires the user's device test.

## Automatic capture and fitting release — 3 October 2026

The `edge-supported-lens-v3` pipeline adds shape and distributed boundary evidence before treating a SAM mask as a lens candidate. Actual SAM runs accepted both supplied lens images and rejected blank images, grid/text scenes and the rendered empty capture sheet, including nine sheet/resolution/prompt variations. This is a conservative edge-presence gate, not an object classifier: a printed oval or another curved object may still pass. Low-contrast or rectangular real lenses can be rejected.

Automatic capture requires at least four distinct completed camera frames over 1.1 seconds, fresh responses, visible calibration, bounded contour motion, usable sharpness and image scale. Empty/stale frames reset the gate. Second-lens rearming needs sustained edge absence with usable sharpness/brightness and visible calibration. It does not establish physical lens identity; occlusion can still rearm the same lens.

Bright white paper no longer suppresses a well-supported lens solely because pixels are clipped. The browser supplies distance, lighting, stability and background guidance, and requests continuous focus/exposure/white balance only when the camera advertises them. Slow responses are labelled slow processing, never inferred overheating. The native face flow reads the actual iOS thermal state.

Local validation: **98 web tests and 51 Python tests passed**, including 27 Python subtests. Public endpoint processing of both supplied photos again generated seven preview meshes and five STL parts plus the build plate; all serialized STLs reloaded as watertight. Preview and export took about 2 seconds in this desktop request. A warm eight-request HTTPS benchmark measured median 175.9 ms, maximum 614.8 ms; these are not phone camera-to-screen timings. The first segmentation after a service restart took 7.5 seconds to load the model.

The web fitting wizard consumes the real native 21-sample export format and labels whether TrueDepth hardware was available. Repeatability thresholds and capability metadata do not establish pupil measurement accuracy. The iOS simulator workflow and actual device validation are recorded separately in `docs/face-fitting.md`.

Actual browser interaction at 390 × 844 used the supplied photo files, confirmed both contours, entered explicitly synthetic fitting values, placed test optical marks, rendered the generated asymmetric assembly, exercised Front/Parts, and reached export success. The browser download event could not be confirmed, while the independent HTTP test verified downloaded ZIP contents. The summary also fit 320 × 568. No console warnings/errors appeared in the full flow. A small mark-canvas clipping issue was fixed with scoped intrinsic sizing; that final CSS was loaded but the captured-state visual recheck was unavailable after the in-app browser session ended. These desktop browser checks do not replace physical iPhone camera tests.

## Auto-capture mobile latency repair — 3 October 2026

After the user reported no automatic capture while stationary, deterministic replay reproduced two timing defects. The old 600 ms maximum sample interval reset every serial request taking 650 ms; the old 900 ms age limit separately rejected 1050 ms replies. Fix: limit idle time after the previous response, and use the existing two-second frame-freshness limit. Geometry, calibration, distinct-frame and lens-presence requirements remain enforced.

An integrated session test then reproduced another blocker: the previous overlay expired while the next serial request was pending and erased the stability history. Expiry now clears the displayed result, while the gate independently checks the next response for freshness, idle gaps, presence and geometry. A four-frame sequence with 1050 ms simulated request latency now reaches the actual capture callback; it previously never did. The live status shows stable progress or the specific quality/calibration blocker. All **100 web tests pass** after the repair. This reproduces a software cause of the reported symptom; it is not a physical iPhone acceptance test.

The running GPU was also saturated while two OptiFrame server copies were active. The obsolete copy was stopped and the public worker restarted. Two actual public segmentation requests after the final restart completed in **588 ms and 203 ms** for the supplied dark photo and clear-lens screenshot. Replaying these observations through production calibration, guidance and capture gates at 300, 650 and 1100 ms sampling intervals triggered capture for both images. These repeated-image timing checks do not measure physical stability or lens accuracy.

SAM access now has a bounded 250 ms queue wait and returns retryable HTTP 503 when occupied, instead of accumulating stale camera requests. Health includes worker occupancy, inference age and last completed inference duration. **54 Python tests pass**, including lock release on failure and the busy endpoint response.

## Sharp-still capture flow — 3 October 2026

Following the report of slow/noisy live segmentation and repeated "Hold steady", a controller regression reproduced indefinite waiting with alternating 0.9 mm preview-edge jitter. The automatic scanner now uses a 960-pixel, JPEG78 preview and a separate still measurement. Two or more valid preview observations spanning at least 350 ms with at most 1.5 mm contour disagreement trigger a local three-frame burst. These relaxed preview checks only start capture; they are not measurement evidence. Camera movement, missing markers, absent lens, bad scale and poor image quality still block triggering.

The burst normally samples for about 150–180 ms, ranks focus within the lens region, and retains the original best frame at up to 1600 pixels (never upscaled). It rejects a frozen camera. The chosen JPEG95 is frozen on screen, segmented separately, and checked again for lens presence, calibration, quality and plausible dimensions. Only that photo's contour and marker coordinates reach review. No sharpening, generated detail or averaged contour enters measurement. Burst ranking does not guarantee accurate focus on a transparent edge or millimetre accuracy.

All **109 web tests passed**, including preview jitter, rejecting blurry/absent final lenses, preserving exact final JPEG/contour identity, and cancelled/restarted bursts. A separate review caught a shared capture-lock race, now protected by operation ownership. Public requests on the two supplied fixtures succeeded at preview/final settings: dark 484/242 ms; clear screenshot 177/249 ms. Source fixtures are 1280 pixels, so the final setting preserved their native resolution; it does not demonstrate a real 1600-pixel phone capture. This small desktop HTTPS sample excludes phone encoding, burst time, rendering and radio latency. Physical phone acceptance remains pending.

## Scope of claim

The demo can claim a measured contour, wearer-specific geometric placement, and a tested mechanical fit only when the checks above are filled in. A prescription-ready or standards-compliant wearable frame needs professional optical and safety assessment.
