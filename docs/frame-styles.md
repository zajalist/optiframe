# Printable frame styles

`Settings.frame_style` accepts `classic`, `bold`, or `brow`. Omission selects
`classic`, preserving the existing geometry. Unknown values raise `ValueError`.

| Style | Outer rim profile |
| --- | --- |
| Classic | Existing 5.3 mm outward buffer of each measured lens |
| Bold | 6.5 mm outward buffer, adding 1.2 mm around the rim |
| Brow | Classic profile united with a copy translated 2 mm upward |

These styles add material around the supplied lens shape. They cannot turn a
round recycled lens into a rectangular one. Both rear retainers follow the same
outer style as the front. Lens contours, the 0.7 mm retaining lip, the 0.2 mm
seat clearance, independent thicknesses, optical positions, and M2 fastener
locations are unchanged. Hinges follow the actual outer bounds for styled rims
to retain fork clearance. The wider styles can require a larger printer bed or
fail the existing inter-rim clearance check at narrow pupil distances.

Preview returns `frameStyle`; export notes and `README.json` include
`frame_style`. Both use the same `build_parts` geometry path. STL generation still
validates serialized watertight solids and packs all five parts with 6 mm spacing.

CPU tests cover all three profiles, unchanged lens openings, preview/export
agreement, clear seats, nonintersecting assembled parts, unsupported styles, and
rejection of Bold when the pupil distances leave inadequate rim clearance.
These are experimental printable designs: physical lens fit, fastener retention,
hinge durability, and wearer comfort remain unvalidated.
