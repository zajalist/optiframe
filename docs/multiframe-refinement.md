# Multi-frame lens refinement

## Pipeline

1. A lightweight live preview locates a plausible lens and visible reference markers.
2. Capture five distinct frames over approximately 300 ms and rank their focus. Preserve original pixels.
3. Upload the five JPEGs in one `/api/segment-burst` request. SAM runs serially on the shared GPU predictor.
4. Refine each proposed edge against local image gradients. Long printed lines are suppressed in the scoring image; their inpainted pixels cannot count as positive edge evidence. Require support around the original image and reject unsupported proposals.
5. Detect each frame's four markers independently and map its contour into the same 100 × 70 mm sheet coordinates.
6. Select at least three mutually consistent contours. Do not translate, rotate or resize individual contours to make them agree. Combine their radial boundaries using a median.
7. Apply bounded final denoising and return one closed loop, projected back onto an accepted reference photo. Keep raw SAM contours, image-refined contours, correction diagnostics and rejected-frame counts with the capture.

This refines geometry from multiple observations; it does not train or fine-tune SAM weights. Five adjacent frames may share the same systematic error.

## Meaning of perspective correction

The four-marker homography removes perspective for points on the sheet plane. It is a planar rectification, not recovery of a three-dimensional orthographic lens surface. A raised/curved edge and wrinkled paper can still introduce parallax and calibration error. See [OpenCV's homography explanation](https://docs.opencv.org/3.4.20/d9/dab/tutorial_homography.html).

## Geometry limits

- At least three valid, distinct observations must form a mutually agreeing majority.
- Pairwise radial disagreement: 95th percentile at most 0.6 mm, maximum at most 1 mm.
- Radial resampling is rejected if original vertices deviate by more than 0.12 mm from the sampled polygon.
- Final smoothing moves radial samples by at most 0.12 mm; its additional width/height change is at most 0.2 mm.
- Persistent narrow spikes and ambiguous/folded outlines are rejected.

These bounds apply to the fusion/resampling/denoising stages, **not** to correction of a bad SAM proposal or to physical measurement error. Image-based refinement can move a wrong SAM edge farther, and records its sampled point-to-segment correction in pixels. A clean curve is not proof of accurate metrology. Reference scale, calipers and independent captures remain necessary.

## Evidence, 3 October 2026

The user's new clear-lens photo reproduced loops at printed-grid crossings and shadow-related notches. Five synthetic variants (pixel translations and tiny brightness changes) all passed the former single-frame quality gates but varied by about 0.92 mm in reported height. Unrefined fusion correctly declined them.

After image-based edge refinement, all five variants passed original-image support and fusion. Refinement took 26–34 ms/frame in the local CPU experiment, with eight supported sectors. Approximately 12.5–14.8% of candidate edge samples fell on suppressed grid pixels and were excluded from positive evidence. Fusion's 95th-percentile radial residual was about 0.128 mm and maximum residual about 0.362 mm. These are synthetic repeatability observations from one photo, not independent phone captures or physical accuracy.

Regression suite: 124 web tests and 68 Python tests passed. Coverage includes empty scenes, blank/grid-only refinement, dark lenses, broad corners, blur, cancellation, stale results, disagreement, narrow spikes between samples, coordinate inversion, exact-frame identity and capture provenance.

## API

`POST /api/segment-burst`: repeated multipart `images` fields (3–5), plus `boxes` as a JSON array of pixel boxes in matching order. Maximum 6 MB per image and 20 MB total; 1600 pixels per side and 2.6 megapixels. Response `{frames:[...]}` preserves order. Individual unsupported images/refinements return an `error` entry. Malformed counts/boxes return 422; upload limits return 413; unavailable/busy GPU returns 503. The browser bounds the entire refinement request and pauses briefly after rejection to show one actionable cue.
