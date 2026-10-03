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

For each lens, enter real caliper width and height. Save the first rectified capture dimensions, then load a different independently taken photograph of the same lens, preserving its top-mark orientation. Calibrate and review that second contour. The saved values survive loading a photo so the phone displays independent-repeat and caliper discrepancies against the current contour. Both width and height must differ by **no more than 0.5 mm** for both checks. Blank or invalid values remain pending. The evidence checkbox confirms actual calipers, an independent photo, and physically checked print scale; it resets on photo load and when saving repeat dimensions.

The save button also retains the first rectified outline in millimetres and its photo identity. On a different photo, the app compares outlines after translating each polygon's area centroid to the origin. Keep the same marked top orientation: no rotation, scale fitting or shape fitting is applied. It samples each edge at spacing no greater than 0.25 mm, finds the distance to the other contour's nearest line segment in both directions, and reports the symmetric maximum sampled distance. This **edge repeatability** must be ≤ 0.5 mm for checked export. Equal bounding dimensions alone cannot pass a changed outline. This is a sampled repeatability metric, not a guarantee of continuous contour distance or edge accuracy against the real lens.

The measurement-checked STL download requires these checks and a four-marker homography for both lenses. Confirmation is revoked whenever the contour, calibration, optical centre, photo or benchmark inputs change; the raw entered reference values remain available for comparison. Numerical discrepancies are recomputed against the edited geometry and the operator must confirm its physical evidence again. Both exports and the preview wait for photo loading or ZIP import to finish. Selecting a new photo or ZIP supersedes pending imports; outdated import results cannot replace it. The explicitly **UNVERIFIED experimental STL** route permits fit experiments with two-point scale or missing physical evidence. These are browser workflow gates, not server-side certification or tamper-proof evidence.

The app reports worst sampled local mm per working pixel and source pixel, including its 1600-pixel image downsampling. This is sampling resolution, not a precision guarantee. Size agreement does not establish every lens-edge point within 0.5 mm: curvature, parallax above the sheet, glare, manual marker placement and contour editing still need independent physical assessment. No real-lens accuracy result has been recorded here.

Run synthetic calibration and browser state checks with `node --test web/calibration.test.mjs web/measurement.test.mjs`. They test homography, invalid marker geometry, contour dimensions, the pass threshold, downsampling math, revoking evidence after edits and blocking export during photo loading; they provide no physical accuracy evidence.

### Service observations (2026-10-03)

Local RTX 5070, protected FastAPI `/api/segment`, SAM2.1 small on CUDA: supplied 1280 × 720 video frames returned HTTP 200 in 8.88 s (IMG_1620 at 5 s) and 9.4 s (IMG_1621 at 8 s); prior visual inspection reported contours of 81 and 88 vertices. These observations demonstrate request success and latency only. No corresponding caliper dimensions or independently measured lens-edge errors are available.

Visual check of the saved overlays: both green contours broadly follow the visible circular lens rim despite bright glare and marks on the background. The 1620 frame has a faint upper-left edge and highlights near the right edge; the 1621 frame has a bright top highlight and dirt visible through the lens. Those are useful stress cases for transparent-object segmentation, but a plausible overlay cannot show whether the chosen curve follows the true outer edge within 0.5 mm. Neither video frame contains the calibrated sheet in view, and there is no caliper ground truth. Treat these as **segmentation demonstrations only**, then repeat on the marker sheet with two independent captures for dimensional validation.

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

## Scope of claim

The demo can claim a measured contour, wearer-specific geometric placement, and a tested mechanical fit only when the checks above are filled in. A prescription-ready or standards-compliant wearable frame needs professional optical and safety assessment.
