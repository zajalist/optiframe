# OptiFrame

**SNSF hackathon:** help a local eyewear provider make a frame for a particular person from two available, professionally verified lenses. The lenses can differ in prescription, size, and outline; the frame does not have to be symmetrical.

## The winning demo

An eyewear provider selects two lenses whose prescriptions have been checked for the recipient. On a phone, they enter the wearer's pupil positions and basic frame-fit measurements, then photograph each lens on a calibrated sheet. The app measures both outlines, places each lens independently in front of the corresponding eye, generates a custom frame, previews it, and downloads a **slicer-ready STL**. The demo ends with the real lenses seated in a printed test piece or frame.

## Build order

1. **Match:** record the recipient's right/left prescription and fitting measurements; require professional verification that each available lens is suitable. The app does not infer lens power from a photo.
2. **Measure:** capture and rectify each lens photo with four known-position markers; extract an outline in millimetres; allow touch-up.
3. **AI:** offer an AI outline proposal for difficult images, with a visible editable mask. Keep the final measurements geometric and inspectable.
4. **Design:** position each lens's marked optical centre independently for the wearer, then generate separate rims and a bridge. Prefer a simple two-part retaining rim for the prototype.
5. **Validate:** compare captures and caliper measurements, check optical-centre placement with the provider, print a fit coupon, then verify the exported STL slices without repair at the intended size.

The core proof is **verified lenses + wearer measurements -> two independent lens positions -> one asymmetric frame -> physical fit**. A splat or face scan is optional polish, not a measurement input.

**Export acceptance:** one download contains every custom printed part, laid out separately on the build plate, with closed printable geometry in millimetres. It must open in a slicer without mesh repair. The app must say when the selected printer bed is too small. Screws or other non-printed hardware are listed separately.

## Project notes

- [Research and evidence](docs/research.md) — optical and physical constraints, source evidence, and decisions.
- [Lens capture pipeline](docs/lens-capture-pipeline.md) — low-cost kit, transparent-edge extraction, point-cloud decision, and test gates.
- [Capture-mode experiments](docs/capture-mode-experiments.md) — Android ARCore/WebXR depth, multi-view silhouette clouds, SiteSplat comparison, and selection gates.
- [Hackathon build plan](docs/build-plan.md) — scope, architecture, order of work, and demo.
- [Validation protocol](docs/validation.md) — concrete checks and pass/fail evidence.

## Run the prototype

```powershell
python -m pip install -r gpu/requirements.txt
python -m uvicorn segment:app --app-dir gpu --host 127.0.0.1 --port 8765
```

Open <http://127.0.0.1:8765>. The home page is a single, no-scroll phone capture screen. Scan one lens at a time: start the camera, tap the lens if the live outline is missing or on the wrong object, capture, and review its perspective-corrected dimensions. The sheet's four white dots are detected automatically when confidence is high; otherwise tap them in printed order. A still-photo fallback asks for one tap on the lens before SAM runs. Camera permission and preview waits end after 12 seconds with a retry path. The [advanced frame builder](web/studio.html) remains a separate screen and receives both measured captures through session storage when the operator opens it from a completed pair. There, mark each optical centre and physical top, enter wearer fitting inputs, preview the 3D assembly, and download the five-part build-plate STL. See [GPU service and frame export](gpu/README.md) and [iPhone capture app](ios/README.md).

The **live outline** streams the rear camera and repeatedly requests SAM 2.1 contours from the GPU. Tap the lens to move a tighter prompt box or drag the box around it. The overlay follows the video between completed requests using a visual translation estimate; the saved JPEG and contour always come from one actual completed SAM frame. More filming offers more candidates and the app keeps its best scored frame; it does not train or fine-tune model weights. The existing `/api/segment` endpoint is used automatically when a running service has not yet loaded `/api/live-segment`.

The separate [Android depth experiment](web/android-ar.html) uses WebXR depth and tracked poses on supported Android Chrome to accumulate a sampled scene point cloud. It exports PLY and raw depth/pose JSON after a bounded 15-second scan. COLMAP is not used in the phone path because the ARCore depth feed already provides metric scene samples and standard image matching is unreliable through a clear lens. The cloud is experimental background/scene evidence, not the lens surface or STL input.

## Status

This is an **experimental printable prototype**, not a validated medical device or proven lens fit. Four-marker perspective rectification and in-phone caliper/repeat benchmarks are implemented. Measurement-checked export requires both lenses to pass width and height discrepancies ≤ 0.5 mm against actual calipers and an independent capture, saved-outline edge repeatability ≤ 0.5 mm after alignment by the same marked optical centre and physical top, and confirmation of physically verified print scale. An explicitly UNVERIFIED experimental export remains available for fit tests. The reported source/working mm per pixel includes image downsampling and does not establish edge accuracy. Run the synthetic calibration/browser tests with `node --test web/calibration.test.mjs web/measurement.test.mjs`.

Each lens panel can also download an A4 **1:1 outline proof**. Print at 100%, verify its 50 mm line, and compare several positions around the actual loose lens edge. This gives the missing physical check beyond width/height and independent-photo repeatability.

Android web camera capture works without ARCore and offers experimental WebXR depth capture where the browser/device supports it. Depth and raw point clouds are experimental evidence; they are not used to size clear lenses. No physical measurement accuracy or lens fit is claimed until the actual lenses and printer pass the [validation protocol](docs/validation.md).

The synthetic five-part plate imported as manifold and sliced in PrusaSlicer 2.9.6 with generic settings; see the exact dimensions and limits in the [validation record](docs/validation.md). Run the local timing benchmark with `python gpu/benchmark.py --iterations 5`.
