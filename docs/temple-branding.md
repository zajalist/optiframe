# OptiFrame temple branding

## Artwork provenance

- Generated with Higgsfield `gpt_image_2_5` on 2026-10-04 UTC.
- Job: `6c18b470-6c55-4a60-a8f1-9a846307f09d`.
- Source PNG SHA-256: `d8ee8aa738ae465d46fac0dce0bf88f41b2e282833a8a23ef581c065477cc821`.
- [Original generated artwork](https://d8j0ntlcm91z4.cloudfront.net/user_3KA92iU6u67O0dIGe7uHUkaeji3/hf_20261004_011230_6c18b470-6c55-4a60-a8f1-9a846307f09d.png).
- Website asset: `web/assets/optiframe-logo.svg` (asymmetric spectacles symbol and OptiFrame wordmark).
- Manufacturing paths: `gpu/branding/logo-paths.json` (the exact generated wordmark contours, scaled to millimetres).

The brief requested a black, bold, minimal asymmetric spectacles symbol and a
separate OptiFrame wordmark on white. The artwork was visually inspected before
vectorization. This is generated artwork, not a third-party font file.

## Geometry

`gpu/temple_brand.py` engraves the wordmark on the outer side of both temples.
Its letters are about 18.44 × 3.5 mm overall and 0.4 mm deep. The current 5 mm
stem retains 4.6 mm of material beneath each letter. The engraving is centred
30 mm behind the assembly origin, clear of the hinge. Each side is oriented to
read correctly from outside. It is part of the preview and STL solid when
`apply_temple_brand` is applied during frame construction.

Debossing preserves the existing bounding box and broad printing face. It does
not add floating letters, change the lens seat, or cut the hinge. The module
rejects a changed stem geometry if the removed volume no longer matches the
intended shallow engraving. Artwork cannot silently move onto an unrelated
surface after a future temple redesign.

## Trace procedure

The source is 1024 × 688 pixels. Grayscale pixels below 100 become ink. OpenCV
`findContours` with `RETR_CCOMP` preserves letter counters. Each contour is
simplified with `approxPolyDP(epsilon=0.8 px)`, under 0.02 mm at the final size.
For the manufacturing mark, components below image row 350 are the wordmark;
coordinates use `u=(x-121)*3.5/149`, `v=(525-y)*3.5/149`. No invented font or
substituted text geometry is used. The SVG preserves both the symbol and letters.

## Checks and limits

Run `python -m unittest test_temple_brand -v` from `gpu/`.

Checks cover both sides at 90, 125, and 180 mm temple lengths; one closed positive
solid; unchanged bounds; expected engraved volume and depth; letter counters;
retained letter/dot material after a 0.2 mm erosion; rejection of incompatible
stem placement; and no modification of the input mesh.

These are geometry checks. Slicer resolution, first-layer detail, physical
legibility, mechanical fatigue, and printed fit have not been validated. Inspect
the actual slicer preview with the intended material and nozzle before printing.
