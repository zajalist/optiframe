# Direct lens clips — experimental print geometry

`retention_style: "clip"` seats each lens against the front lip and captures its
rear edge with four integral spring noses. It has no rear retaining rings or
loose lens pins. Two printed split pins connect the temples; there are no metal
screws or nuts in this mode. `snap` remains the separate printed-pin retainer
design, and `screw` keeps the M2 hardware design.

The rear spring paths follow the measured lens boundary offset by 1.7 mm.
Each 9 mm tangential arm has a 1.2 × 1.4 mm cross-section, one anchored root,
and 0.6 mm of actual air clearance underneath. A rounded, tapered nose extends
0.6 mm over the lens edge. All noses begin behind the lens's measured edge
thickness and seat allowance. Their lead-in is geometric; a safe insertion
force or audible click has not been demonstrated.

Placement searches each quarter of the perimeter and rejects a design if four
separated arms cannot fit the available rim stock without striking other front
geometry. The front must remain one connected, watertight solid. The preview
shows the same integral clips used for STL export.

The archive includes `left-clip-fit-coupon.stl` and
`right-clip-fit-coupon.stl`, also packed on the plate. Each uses its lens's edge
thickness and the same spring section on a **22 mm radius reference rim**.
These test print clearances and material response; they are not replicas of
the complete scanned lens shape. Coupons are excluded from assembled previews.

## Hinges

Both `clip` and printed-pin `snap` use a 3.0 mm split shaft through a 3.4 mm
hinge bore, a 5.0 mm head, a 3.8 mm barb and 13.9 mm grip length. Nominal axial
clearance is 0.15 mm at each retaining end. The snap fork has additional front
stock around its larger bore. Fork-to-lug clearance remains 0.45 mm per side.
The build plate puts these pins head-down. Screw-mode hinge geometry is unchanged.

## What is verified

Automated geometry checks cover all three frame styles using the stored scanned
lens pair: watertight STL round trips, connected roots, open under-arm slots,
installed-lens clearance, no assembled-part intersection, coupon inclusion,
and exclusion of coupons from try-on. Independent 1 mm and 6 mm thickness
cases are covered. These tests cannot establish functional mechanical strength.

## What needs printing

Print coupons first and check that the small air slots do not fuse. Inspect
supports, layer orientation, insertion force, pullout, creep, repeated flexing
and hinge wear with expendable test material before inserting lenses. PETG is
only a starting point for experimentation; brittle resin and PLA have no
validated retention performance here. Thickness alone does not describe the
lens bevel or curved edge. Reject a fit that requires force or leaves an edge
unretained. This prototype has not been physically validated for wear.
