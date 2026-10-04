# OptiFrame temple branding

## Artwork provenance

- Generated with Higgsfield `gpt_image_2_5` on 2026-10-04 UTC.
- Job: `6c18b470-6c55-4a60-a8f1-9a846307f09d`.
- Source PNG SHA-256: `d8ee8aa738ae465d46fac0dce0bf88f41b2e282833a8a23ef581c065477cc821`.
- [Original generated artwork](https://d8j0ntlcm91z4.cloudfront.net/user_3KA92iU6u67O0dIGe7uHUkaeji3/hf_20261004_011230_6c18b470-6c55-4a60-a8f1-9a846307f09d.png).
- Website asset: `web/assets/optiframe-logo.svg` (asymmetric spectacles symbol and OptiFrame wordmark).
- Manufacturing paths: `gpu/branding/logo-paths.json` (the exact generated spectacles symbol and wordmark contours, scaled to millimetres).

The brief requested a black, bold, minimal asymmetric spectacles symbol and a
separate OptiFrame wordmark on white. The artwork was visually inspected before
vectorization. This is generated artwork, not a third-party font file.

## Geometry

`gpu/temple_brand.py` engraves the existing spectacles symbol beside the wordmark
on the outer side of the wearer's left temple only. The right temple is plain.
The complete mark is 21.54 × 2.6 mm and 0.4 mm deep. The original symbol,
gap and wordmark are scaled uniformly by 2.6/3.5. The current 5 mm
stem retains 4.6 mm of material beneath each letter. The engraving is centred
26.5 mm behind the assembly origin, clear of the hinge. Its full span stays in
the common flat stock at assembly Z −42 to −10 mm on every style. It reads
correctly from outside. The low-level helper supports either side, but frame
construction applies it only to the left temple, in both preview and STL.

Debossing preserves the existing bounding box and broad printing face. It does
not add floating letters, change the lens seat, or cut the hinge. The module
rejects a changed stem geometry if the removed volume no longer matches the
intended shallow engraving. Artwork cannot silently move onto an unrelated
surface after a future temple redesign.

Only the branded left preview mesh exposes `branding.faceIndices`, `centre`,
`bounds`, and `finish: "silver-infill-preview"`. These indices select only the
actual recessed floor triangles at 0.4 mm depth; their total area must match
the vector artwork area. No outer rectangle, icon counters or uncut arm faces
are painted. The viewer may show silver infill for legibility. **This is an
illustrative finish, not a separate metal insert; STL is uncoloured.** Actual
paint/infill application and durability are not validated.

## Trace procedure

The source is 1024 × 688 pixels. Grayscale pixels below 100 become ink. OpenCV
`findContours` with `RETR_CCOMP` preserves letter counters. Each contour is
simplified with `approxPolyDP(epsilon=0.8 px)`, under 0.02 mm at the final size.
For the manufacturing mark, components below image row 350 are the wordmark;
coordinates use `u=(x-121)*3.5/149`, `v=(525-y)*3.5/149`. No invented font or
substituted text geometry is used. The SVG preserves both the symbol and letters.

The existing SVG's final path is the spectacles symbol with two preserved
lens holes. Its original bounds are X 251–764, Y 151–339; scale is 3.5/188
mm per SVG unit, with Y flipped for the manufacturing plane. It is placed
before the unchanged wordmark with a 1 mm gap. This reuses the traced artwork;
it does not regenerate or approximate the logo. The stored manufacturing paths
remain at their original 28.99 × 3.5 mm source size; `logo_polygons()` performs
the final uniform reduction to 21.54 × 2.6 mm.

## Checks and limits

Run `python -m unittest test_temple_brand -v` from `gpu/`.

Checks cover both sides at 90, 125, and 180 mm temple lengths; one closed positive
solid; unchanged bounds; expected engraved volume and depth; letter counters;
retained letter/dot material after a 0.15 mm erosion; rejection of incompatible
stem placement; and no modification of the input mesh.

All three temple styles also verify engraved-floor preview indices, outward
normals, matching artwork area, and preserved symbol counters.
Assembly tests cover all three styles and both retention modes, requiring left
branding and an unbranded right temple in both the solids and preview metadata.

These are geometry checks. Slicer resolution, first-layer detail, physical
legibility, mechanical fatigue, and printed fit have not been validated. Inspect
the actual slicer preview with the intended material and nozzle before printing.
Some fine strokes are narrower than a 0.4 mm nozzle and may not resolve at that
setting; the smaller signature is not a claim of reliable physical legibility.
