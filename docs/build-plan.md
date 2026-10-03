# Simple plan to win

## One-sentence pitch

**OptiFrame helps local eyewear providers pair verified lenses with a wearer and print a frame positioned for that person's eyes, even when the two lenses differ.**

## The minimum complete workflow

1. **Prepare the kit and wearer record.** Use two real lenses, ideally with different outlines and professionally checked prescriptions; a capture sheet; calipers; a phone; a printer and small screws. Record monocular pupil positions, fitting heights, and a basic frame/bridge-width measurement. Mark each lens `L` or `R`, its top edge, and its optical centre.
2. **Confirm optical suitability.** A provider enters or confirms each lens's measured prescription and suitability for the corresponding eye. Missing or mismatched data produces a visible **verification needed** state. The app does not diagnose prescriptions.
3. **Capture on phone.** Photograph one lens at a time. Four markers around it establish scale and perspective. Show a recapture prompt if markers are missing or image quality is poor.
4. **Confirm contours.** Show the proposed outline over the original photo at high zoom. Let users correct it. Show width, height, optical-centre mark, and orientation for each lens independently.
5. **Design.** Place each marked optical centre at that wearer's corresponding pupil position. Derive the bridge between independent rims, then set rim width, lens-edge thickness, temple span, and printer clearance. Flag lens or rim collisions and impossible bridge geometry. Preview both lenses inside the 3D assembly.
6. **Validate and export.** Show optical verification status, placement measurements, repeat-capture discrepancy, and fit-coupon outcome. Export one binary STL with all custom parts laid flat and separated on the selected printer bed. Import and slice that exact download without repair or resizing.

## Architecture, kept small

- **Phone UI:** an installable mobile web app with wearer measurements, lens verification status, capture, contour correction, dimensions, and preview. Native camera input is enough for the first version; a custom live camera view is optional.
- **Image processing:** OpenCV (browser or a small server endpoint) detects markers, rectifies the image, and extracts an initial contour. Decide client versus server after a quick phone performance test.
- **AI:** one segmentation endpoint for hard images, accepting a user click or box and returning a mask for correction. The mathematical scale and final contour remain explicit.
- **Geometry:** measured contour and optical-centre point for each lens + wearer pupil positions -> independently placed 2D paths -> closed front and rear retaining solids plus bridge -> print-bed layout -> STL export. Use existing geometry utilities if the chosen starter project has them.
- **Storage:** local project JSON is enough for the demo. No accounts or database are needed.

## Time-boxed order of work

| Phase | Work | Proof to keep |
| --- | --- | --- |
| 0. Feasibility (first 2–3 h) | Pick provider-verified lenses, record one wearer's basic fitting measurements, test backgrounds, verify capture sheet, and make one repeatable capture. | Lens verification record, original photo, rectified image, caliper dimensions. |
| 1. Measurement | Build capture, automatic outline, manual correction, independent L/R dimensions, and optical-centre marks. | Two different contour overlays and repeat-capture comparison. |
| 2. Physical geometry | Align each lens to its wearer's pupil position; generate two rims, bridge, retaining lips, and closed printable solids. Arrange all custom parts on a selected bed and export STL. | Alignment view and a clean slicer preview of the downloaded file. |
| 3. Fit loop | Print a short coupon; adjust clearance and thickness; print final front if time permits. | Photo/video of an actual lens being inserted and retained. |
| 4. AI and presentation | Add AI segmentation to difficult photos, then polish the before/after story and demo. | Saved example where AI helps and user can correct it. |

If the first capture cannot achieve a clean repeatable contour quickly, switch to manual trace over the rectified image. That preserves the end-to-end demo and still provides measured geometry.

For difficult transparent lenses, test a two-shot capture on a printed pattern: empty sheet, then sheet with lens, aligned using markers. Use the difference as an edge proposal and retain manual correction. In parallel, test Android WebXR depth, multi-view silhouettes, and a SiteSplat backend against the same physical lens. Promote cloud geometry into the printable rim only when it improves a measured fit.

The concrete capture algorithm and its validation gate are in [lens-capture-pipeline.md](lens-capture-pipeline.md).
The point-cloud experiments and comparison gates are in [capture-mode-experiments.md](capture-mode-experiments.md).

## Live demo script (about 90 seconds)

1. Hold up two different recycled lenses and the capture sheet.
2. Show the wearer's separate pupil positions and the provider's lens-verification status.
3. Capture each lens; show its overlaid outline, optical-centre mark, and measured dimensions.
4. Correct one imperfect edge; show each lens move independently to align with the wearer's eyes.
5. Show the resulting asymmetric frame, download the STL, slice that downloaded file without adjustments, and show the physical fit coupon or assembly.
6. End with measured errors and the optical checks that still require a professional.

## What to leave out

Unvalidated Gaussian-splat geometry in the printable model, ARKit-only scanning, face scanning, automatic prescription detection, accounts, a design marketplace, and dozens of styles. These do not close the central proof: the real lenses fit the printed frame. An optional Safari AR Quick Look preview can follow the working STL export.

## Winning evidence checklist

- [ ] Both physical lenses and their left/right/top/optical-centre marks are visible.
- [ ] The wearer's pupil positions are entered separately and both lenses are marked professionally verified or **verification needed**.
- [ ] Two genuinely different measured contours feed the design.
- [ ] Scale reference and dimensions are shown in millimetres.
- [ ] AI-assisted contour is clearly labelled and editable.
- [ ] The downloaded STL contains every custom printed part, correctly oriented and spaced, and slices without repair, scaling, or repositioning.
- [ ] Real fit test, optical-centre placement, and measured errors are shown, including a failed/revised attempt if there was one.
