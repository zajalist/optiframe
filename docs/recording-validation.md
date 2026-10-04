# Historical recording replay

## Scope

Tested the previously supplied `IMG_1620.mov` and `IMG_1621.mov` through the
existing production HTTP backend on localhost. No additional SAM process or GPU
model was loaded. These are **older recordings**, not the newly reported
recording of an on-sheet capture that fails after refining.

Contact sheets were inspected before choosing prompts. Both videos show lenses
on a textured/marked tabletop, with changing viewpoint, reflections and shadows.
Neither contains the calibration sheet or another known-size reference. Several
frames cut off the lens at the image boundary. A millimetre homography, calibrated
video fusion and measurement-accuracy result would therefore be invalid.

The replay uses 24 evenly distributed frames per video, maximum image side
1600 px and JPEG quality 95. Loose prompt boxes were placed around the visible
lens using the contact sheet. This is a segmentation diagnostic; the supplied
prompt assistance means it is not an unassisted browser capture success rate.
The production marker detector found no four-marker set in all 48 frames.

## Results

| Input | Duration | Frames tested | Refined contours accepted | Median HTTP | p95 HTTP |
|---|---:|---:|---:|---:|---:|
| IMG_1620.mov | 11.49 s | 24 | 0 | 87.6 ms | 96.0 ms |
| IMG_1621.mov | 18.90 s | 24 | 2 | 87.9 ms | 125.1 ms |

Each video contained approximately 15 sampled views with the full lens visible;
the accepted counts remain 0/15 and 2/15 on that subset. Frame visibility was
reviewed visually, not established by a ground-truth annotation dataset.

Of 48 frames, 44 failed **before** edge refinement: 30 returned `no-closed-edge`
and 14 returned `insufficient-edge-evidence`. The former can also represent a
rejected/truncated SAM proposal; the current public response intentionally does
not distinguish every internal mask-restoration failure. Four frames reached
refinement: two passed and two failed its original-image evidence check.

Four three-frame burst requests completed in 251–263 ms. Their selected frames
remained rejected, consistent with the individual results. Batching alone did
not fix weak evidence. No calibration or metric consensus was fabricated for
these uncalibrated clips.

### Two specific refinement failures

The cached raw proposals were evaluated with the same CPU refinement function:

- IMG_1621 sample 8: six supported sectors, where seven are required. Median
  paired-rim evidence was 0.01223, above the 0.010 median floor.
- IMG_1621 sample 9: seven supported sectors, but median paired-rim evidence was
  0.00926, below the 0.010 floor.

The raw SAM outlines look plausible in those two views, but accepting them by
lowering one threshold would not establish their true boundary. The replay
identifies a real usability limitation: clear-looking tinted edges can have too
little paired-gradient evidence in part of their perimeter. Most historical
clear-lens failures occur even earlier in proposal/presence validation.

## Negative checks

Six natural empty-table crops from these videos and three synthetic blurred
shadows without a lens were submitted to the live endpoint. All nine returned
no detected lens. Synthetic shadow blur sigmas were 2, 5 and 10 px. This is a
small negative set and does not establish a general false-positive rate.

## Existing calibrated still: burst consistency

A separate existing user photo containing all four printed markers was replayed
as five slight translation/brightness perturbations. All five refinements and
the existing rectified-contour fusion passed; the five-frame HTTP burst took
589 ms. The resulting outline measured 47.53 × 35.84 mm under the printed-sheet
scale assumption.

Fusion reported 0.199 mm spread, 0.700 mm maximum spread and 0.578 mm pairwise
spread. Width ranged from 47.50–47.69 mm and height from 35.79–35.86 mm across
the five inputs. These figures measure **repeatability of perturbations of one
photo**, not independent captures, physical dimensions or boundary accuracy.
There is no ruler/caliper ground truth in this replay.

## Next evidence needed

Use the actual new recording showing the lens and all four calibration markers
through the failing capture. Preserve per-frame rejection diagnostics, camera
distance and lighting changes. Then compare calibrated contours across real
viewpoints and against independently measured dimensions. Candidate changes
should retain the empty-table and shadow-only negatives.

Useful bounded engineering work includes recording the median evidence and
weak-sector locations internally, improving the original proposal when a
visible rim is missed, and accumulating compatible original-image evidence
across calibrated views. Do not globally relax the acceptance thresholds on the
basis of one tinted lens or display a smoothed contour as verified geometry.

## Local artifacts

Reproducer: `Saved/replay-validation.py` (`contact` or `replay`). It reads the
access key from the process environment and sends requests only to
`http://127.0.0.1:8766`; it does not print credentials. Reports and contact sheets
are local temporary artifacts under `%TEMP%/optiframe-recording-validation/`:
`report.json`, both `*-contact.jpg` files, and both `*-overlays.jpg` files. Images
and full contour reports are not committed as public research assets.
# Follow-up: small lens / missing overlay screenshot

The 21:49 iPhone screenshot reproduced a separate client failure: the camera crop's four markers were found at the 960-pixel segmentation resolution (about 235 pixels across), but all four were lost by the 480-pixel live plane tracker. The inferred outline was consequently hidden while the status still said "Lens found". v37 tracks at the same resolution as inference, requires a currently tracked plane before automatic capture, and invalidates stability after marker loss. Distance guidance now takes precedence over a generic edge/light hint; the 300-pixel marker-span floor asks this setup to move closer. This is a reproduced UI/tracking failure, not evidence of physical edge accuracy. The four relevant capture test suites passed 64 tests.

