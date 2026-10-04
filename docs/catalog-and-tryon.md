# Fitting visuals and frame catalog

The phone fitting flow now includes an illustrative pupil-distance visual,
three real frame profiles, and optional camera try-on.

## Pupil distances

The mannequin reference was generated with Higgsfield (`gpt_image_2_5`, job
`7bc7f3cd-84a2-42ae-b787-e21631025c1a`). Its optimized WebP is embedded in
`web/assets/pupil-reference.js` (about 14 KB). It contains no patient data.
Pupil markers and dimension lines are independent SVG geometry driven by the
two entered values. Blank or invalid values display no guessed measurements.
The frontal illustration reverses wearer/viewer sides deliberately. It is
not a face scan and supplies no measurements to CAD.

Both input fields remain visible with the software keyboard. Enter advances
from left to right; invalid values disable Continue. Back navigation preserves
the original controls and their values.

## Catalog

Classic, Bold and Brow use the same measured lens openings. See
[frame styles](frame-styles.md) for actual geometry. Thumbnails are schematic
silhouettes; the large 3D viewer shows the generated assembly. Style selection
invalidates the previous mesh, rebuilds the preview and controls STL export.
The selected style is retained in session storage. Try-on requires a current
successful preview; an old assembly cannot substitute after changing style.

## Visual try-on

`face-tryon.js` loads the front camera on an explicit button press. MediaPipe
Tasks Vision 0.10.32 and the official face-landmarker model run locally; no
camera frames are uploaded. Three.js renders the selected generated mesh using
its optical references, pupil landmarks, face pose and depth-only face masking.
The preview is mirrored together with the camera image. A visual stand-off is
used for appearance; it never changes fit inputs or STL geometry.

This is browser camera try-on, not ARKit/ARCore or a calibrated fitting tool.
It cannot establish physical size, optical alignment or comfort. No face or a
frozen video frame hides the model. Close, page hiding and late permission
completion release camera resources. Models and WASM require an initial network
download. Official API reference:
https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js

## Verification

- 135 existing/frontend tests passed before try-on; 6 try-on geometry/lifecycle
  tests passed separately, including late permission and denied access.
- 18 backend frame tests passed for all style profiles, watertightness,
  unchanged lens openings, assembly clearance and preview/export agreement.
- Public endpoint returned all three named styles with seven preview meshes.
- Browser route: photo pair, fitting, markers, style selection, camera startup,
  no-face handling and Brow export completed. The downloaded ZIP reports Brow,
  contains five part STLs plus plate STL, and the plate decodes as watertight.
- Fitting/guide inspected at phone, short-height and desktop sizes. Invalid
  input and Back value preservation checked through the real UI.

Physical iPhone/Android face tracking, real lens retention and print durability
remain unverified. The existing shadow-following segmentation failure is not
fixed by this UI/catalog work.
