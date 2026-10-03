# Simple plan to win

## One-sentence pitch

**OptiFrame turns two discarded lenses into one measured, printable frame, with a visible proof of fit.**

## The minimum complete workflow

1. **Prepare the kit.** Two real lenses, ideally with visibly different outlines; a printable calibration sheet; a ruler or calipers; a phone; a printer and a few small screws. Mark each lens `L` or `R` and its top edge before it leaves its old frame.
2. **Capture on phone.** Photograph one lens at a time. Four markers around it establish scale and perspective. Show a recapture prompt if markers are missing or image quality is poor.
3. **Confirm contours.** Show the proposed outline over the original photo at high zoom. Let users drag points or add/remove edge points. Show width and height in millimetres for each lens independently.
4. **Design.** Set bridge width, left/right placement, rim width, lens-edge thickness, and a printer-clearance knob. Generate the front frame and matching retaining pieces. Preview both lenses inside the 3D assembly.
5. **Validate and export.** Show captured measurements, repeat-capture discrepancy, and fit-coupon outcome. Export binary STL in millimetres; load it in a slicer.

## Architecture, kept small

- **Phone UI:** one web page with capture, contour correction, dimensions, and preview. Native camera input is enough for the first version; a custom live camera view is optional.
- **Image processing:** OpenCV (browser or a small server endpoint) detects markers, rectifies the image, and extracts an initial contour. Decide client versus server after a quick phone performance test.
- **AI:** one segmentation endpoint for hard images, accepting a user click or box and returning a mask for correction. The mathematical scale and final contour remain explicit.
- **Geometry:** measured contour points -> smoothed closed 2D paths -> front and rear retaining rims plus bridge -> Three.js mesh -> STL export. Use existing geometry utilities if the chosen starter project has them.
- **Storage:** local project JSON is enough for the demo. No accounts or database are needed.

## Time-boxed order of work

| Phase | Work | Proof to keep |
| --- | --- | --- |
| 0. Feasibility (first 2–3 h) | Pick lenses, test backgrounds, print and verify reference sheet, make one repeatable capture. | Original photo, rectified image, caliper dimensions. |
| 1. Measurement | Build capture, automatic outline, manual correction, and independent L/R dimensions. | Two different contour overlays and repeat-capture comparison. |
| 2. Physical geometry | Generate two rims, bridge, retaining lips, 3D preview, and STL. | Slicer screenshot with correct dimensions. |
| 3. Fit loop | Print a short coupon; adjust clearance and thickness; print final front if time permits. | Photo/video of an actual lens being inserted and retained. |
| 4. AI and presentation | Add AI segmentation to difficult photos, then polish the before/after story and demo. | Saved example where AI helps and user can correct it. |

If the first capture cannot achieve a clean repeatable contour quickly, switch to manual trace over the rectified image. That preserves the end-to-end demo and still provides measured geometry.

## Live demo script (about 90 seconds)

1. Hold up two different recycled lenses and the capture sheet.
2. Capture each lens; show its overlaid outline and measured dimensions.
3. Correct one imperfect edge on screen; show the geometry update.
4. Change bridge width and show the asymmetric 3D frame update.
5. Export STL, show its dimensions in a slicer, then show the physical fit coupon or assembled frame.
6. End with the validation numbers and one honest limitation.

## What to leave out

Gaussian splats, full 3D lens reconstruction, face scanning, automatic prescription detection, accounts, a design marketplace, and dozens of styles. They do not close the central proof: the real lenses fit the printed frame.

## Winning evidence checklist

- [ ] Both physical lenses and their left/right/top orientation are visible.
- [ ] Two genuinely different measured contours feed the design.
- [ ] Scale reference and dimensions are shown in millimetres.
- [ ] AI-assisted contour is clearly labelled and editable.
- [ ] 3D preview and a slicer-opened STL are shown.
- [ ] Real fit test and measured errors are shown, including a failed/revised attempt if there was one.
