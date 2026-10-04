# Shadow-aware lens edges

## What changed

SAM still supplies the local lens proposal. The CPU refinement now scores pairs
of opposite intensity slopes across a thin rim (bright or dark), at half-widths
of 1–2.5 image pixels. A broad one-sided shadow boundary has little paired-rim
evidence even when its gradient is stronger than the physical rim.

The closed-loop search uses those scores, weaker attraction to the initial SAM
outline and a stronger continuity penalty. Acceptance checks paired evidence in
the original photograph. Grid-inpainted pixels cannot establish edge support.
Insufficient evidence never falls back to the stronger shadow edge.

Strongly dark interiors retain step-edge scoring, selected before refinement
using interior/background intensity statistics. This preserves the dark lens
example. The classifier measures appearance, not actual material opacity: a
very dark cast shadow can mimic an opaque object.

Both live preview and final burst refinement use the same implementation.
Original photographs and raw proposals remain available for review.

## Evidence

The original synthetic counterexample was accepted with 7.89 px mean boundary
error and 12.75 px p95. The new method accepts it at 0.27 px mean and 1.58 px p95.
These are sampled distances to the known synthetic polygon, not physical lens
accuracy or symmetric Hausdorff bounds.

In 48 variations of displacement, shadow blur and strength, the old method
accepted 39, including 30 above 3 px p95. The paired-rim method accepted 26 with
none above that threshold; 22 were rejected. A separate exploratory set of 36
shape/grid/rim-width cases still had 4 accepted contours above 3 px p95 (worst
3.69 px), so shadow rejection is improved but incomplete.

CPU refinement was about 28.5 ms median in the exploratory synthetic sweep,
versus 24.3 ms before. This excludes SAM, upload and camera latency.

Three existing user examples (clear lens, dark lens, and a screenshot-derived
clear lens) each passed five saved perturbation replays with presence checks.
Perturbations were only ±1 px translation and ±2 intensity: these are not
independent physical captures or ground truth. Median refinement was 18–26 ms.
Visual review of the clear original shows a better bottom boundary, but its
right-hand rim remains difficult to separate perfectly from the shadow.

## Reproduce

```powershell
C:/Python314/python.exe gpu/benchmark_shadow_selection.py
C:/Python314/python.exe gpu/benchmark_shadow_selection.py --matrix
C:/Python314/python.exe -m unittest discover -s gpu -p test_edge_refine.py
```

Tests cover the original stronger-shadow failure, mirrored shadow directions
with JPEG/noise, a shadow without a rim, blank/grid-only scenes, dark lenses,
comparable competing rims and broad corners. Keep original-photo review and
physical width/height verification before CAD.

## Next evidence to collect

Compare the same unmoved lens with light from opposite sides, or torch off/on,
and retain the original frames and calibration. A camera-only sweep can move
reflections, but a stationary light can leave the cast shadow fixed; averaging
those frames cannot guarantee its removal. Sheet homography also rectifies the
sheet plane, while an elevated lens rim can retain parallax.

Generic shadow removal can alter the very edge being measured. For now the
pipeline changes scoring, not the source image. Related primary references:
[OpenCV morphology](https://docs.opencv.org/4.x/d9/d61/tutorial_py_morphological_ops.html),
[texture-consistent shadow removal](https://pages.cs.wisc.edu/~fliu/project/shadrm.htm),
[shadow detection survey](https://arxiv.org/abs/1304.1233).
