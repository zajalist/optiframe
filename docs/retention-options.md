# Lens retention prototypes

`settings.retention_style` selects actual printed geometry: `screw` (default),
`snap` (shown as **Push pins**) or `clip` (shown as **Clip-in**).
`preview.retentionStyle` and the ZIP's `README.json.retention_style` identify
the selected mechanism. These prototypes have not been physically validated for wear.

## Direct lens clip-in

`clip` means the lens itself clicks into the rim. It is distinct from the separate
push pins described below. The interface submits `clip` without substituting
screw or pin geometry, and rejects an assembly whose reported retention differs.
Print the kit's fit coupon before inserting a real lens. Follow the generated
kit instructions for material, lens thickness and assembly limits; a smooth
preview is not evidence of retention strength or a fit for every bevel.

## Screw rings

The existing five-part kit uses a front seat and separate rear ring per lens.
Eight M2 through fasteners secure the rings. Two additional M2 screws form the
temple hinges. Check the screw lengths, nuts and head clearances before assembly.

## Push-pin rings (legacy `snap`)

The experimental thirteen-part kit contains the same five main pieces plus eight
printed split push pins. Each ring has four 3.4 mm bores matched by front bores.
The 3.0 mm pin shafts have two legs divided by a 0.7 mm slit; their 3.8 mm barbs
must compress while passing through the bore, then expand beyond the front face.
A 5.0 mm rear head and the forward barb shoulders retain the stack. Pins and
rings are detached parts, not decorative additions to the screw geometry.

Pins enter from the rear. Their shafts clear the bores by 0.2 mm radially, and
each end allows 0.15 mm axial play. The tapered front tips extend 1.5 mm ahead of
the frame. The forward shoulders are 0.15 mm ahead of the front face. Lens seats
retain the existing 0.3 mm depth allowance; this does not establish correct
clamping for a curved or bevelled lens.

Two M2 hinge screws and nuts are still required. Removing a pin requires access
to compress both forward barbs. Removal usability and repeated flexing have not
been tested. A push pin is not a certified positive locking fastener.

## Thickness and print checks

Each lens uses its own measured edge thickness from 1–6 mm. Its ring position and
four pin lengths follow that thickness. Do not mix left and right pins when
their lengths differ. This is parametrically sized retention, not one universal
clip for every thickness, bevel, curvature or material.

The build plate places every pin flat-head-down with tips upward, retains 6 mm
part separation, and checks bed bounds. Export checks every STL for watertight
positive-volume geometry, including float32 serialization. Preview uses the
same solids. The head footprint must fit within available rim stock; unsuitable
outlines are rejected instead of bypassing clearance checks.

PETG is only a starting point for test coupons. Print a spare pin and a matching
3.4 mm bore stack at the intended thickness before risking a lens. Measure
insertion force, pullout, fatigue, layer splitting, temperature sensitivity and
dimensional shrinkage. Review the split-leg resolution and barb overhangs in the
slicer. Brittle resin and PLA are not assumed to tolerate the required flex.
No material, printer settings, retention force or wearer safety is validated by
the generated meshes or tests. Reject loose, cracked or difficult-to-insert
parts; never force the lens into a seat.
