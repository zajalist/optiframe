# Adaptive lens retention

Status: design proposal, 3 October 2026. No CAD changes or physical fit validation accompany this document.

## Recommended next prototype

Evolve the existing **front lip + removable rear retainer** into a screw-fastened lens cassette with **replaceable compliant contact pads and controlled hard stops**. Generate each cassette from its own lens outline and measurements. Retain the existing independent left/right geometry and through-fastener approach.

The hard lips provide geometric capture of the lens. Small compliant contacts take up manufacturing variation and reduce concentrated contact; hard stops limit how far the retainer can close. Changing a liner or spacer should permit fit adjustment without reprinting the complete frame. The mechanism is a hypothesis requiring coupon tests. It cannot yet be described as a universal lock for arbitrary recycled lenses.

## What the generator actually makes today

The implementation in [`gpu/frame.py`](../gpu/frame.py), especially `build_parts`, creates five custom parts: one front, two rear retainers, and two temples.

| Feature | Current implementation | Implication |
|---|---|---|
| Thickness | Independent left/right scalar inputs; accepted values 1–6 mm | This is a software input range, not demonstrated retention capability. |
| Front lip | 2.0 mm axial thickness; aperture offset 0.7 mm inside the measured outline | Lip overlaps the projected lens edge, but actual bevel/contact location is unmeasured. |
| Outer rim | 5.3 mm outward offset from the lens outline | Room for fasteners; broad rim can constrain available pupil spacing. |
| Outer rail | Cavity offset 0.2 mm outward; axial height `edge_thickness + 0.3 mm` | Radial clearance and a fixed rear stop are built in. |
| Rear retainer | 1.8 mm thick; starts at the rear rail plane | Tightening against the rail fixes the gap. |
| Fasteners | Four M2 through fasteners per lens; two additional M2 hinge fasteners | Hardware lengths and assembly clearance still need checking on the printed kit. |
| Lens preview | Flat extrusion with the entered thickness | It does not represent curvature, bevels, a groove, or variable edge thickness. |

**Current retention limitation:** for an ideal flat lens with the entered thickness, the gap between the lips is its thickness plus 0.3 mm. The screws bottom the retainer against the rail, so tightening does not establish lens clamping preload. The lip may contain the lens, but rattle and rotation remain possible. Curved or uneven lenses may instead contact at isolated locations. Mesh watertightness and slicer import tests cannot establish retention.

The existing tests exercise unequal thicknesses, including 1.4/4.2 mm, and reject out-of-range inputs. Those are geometry tests only. The generator currently has no compliant liner, calibrated compression stop, or dedicated lens-fit coupon export.

## Why this mechanism

Optical mounts provide a useful mechanical precedent: Thorlabs offers retaining rings with an elastomer O-ring intended to reduce stress on the optic. This supports testing compliant contact under controlled retention; it does not establish eyewear suitability or a safe clamping force for recycled lenses. [Thorlabs retaining-ring design](https://www.thorlabs.de/newgrouppage9.cfm?objectgroup_id=1535&pn=SM20RR)

For an initial coupon, smooth cut elastomer pads are a simpler contact surface to inspect than a rough printed edge. Printed TPU inserts are another candidate when a printer supports them; the manufacturer describes TPU 95A as flexible and wear-resistant, but those properties alone do not establish compression set, coating compatibility, or suitability for contact with the wearer. [Prusament TPU 95A](https://prusament.com/materials/prusament-tpu-95a/)

| Option | Useful properties | Limitation for the present inputs |
|---|---|---|
| Rear retainer + replaceable pads + stops | Reuses current architecture; easy disassembly; independent thickness per lens | Requires measured contacts and a physical compression/retention test. Recommended first. |
| Split rim with screw closure and V-seat | Can give a slimmer conventional frame for a known bevel | Needs bevel location/profile and a matched seat; tightening changes radial pressure. A top photo cannot supply these. |
| Printed snap-only rim | Few parts | Fit, insertion force, fatigue and temperature dependence remain untested; repairability is poorer if a latch breaks. |

## Inputs and compatibility envelope

Keep the existing 1–6 mm input interval as an **unvalidated design target for separately generated lens cassettes**. Do not imply one fixed cassette adjusts through the entire interval. The first physical coupons should cover a modest thin/mid/thick set of available lenses, with actual measured values recorded.

Measure each loose lens at the intended contact locations—at least four cardinal positions, preferably eight around the perimeter. Record:

- Local edge thickness and its minimum/maximum.
- Edge form: flat, bevelled, grooved, chipped, or unknown.
- Front/back curvature and whether the lens rocks on the proposed contact arrangement.
- Marked physical top and optical centre, preserved when installing the lens.
- Material/coating information when available; do not infer these from the silhouette.

A single maximum edge-thickness input can size a cavity, but cannot determine distributed contact. If curvature prevents a stable seat, the required next input is a side/profile measurement or a different seat—not extra screw force. A damaged edge or an unknown contact condition fails prototype acceptance.

### Proposed adjustable geometry

1. Retain front and rear overlapping lips, verifying their actual overlap on the physical bevel and that they do not intrude into the required usable aperture.
2. Add mechanically retained, replaceable pads at defined perimeter contacts. Test their support pattern on a complete single-lens cassette; isolated pads alone cannot establish resistance to rotation.
3. Recalculate the rail or fastener-boss stop height to include the selected pad stack. Provide small replaceable spacers at hard stops for controlled fit trials.
4. Use through bolts, nuts and suitable load-spreading hardware. Do not rely on printed M2 threads for the first retention prototype.
5. Keep left and right settings independent. Position the assembled cassettes from the marked optical centres and wearer measurements.

For a locally planar contact, compression is approximately `lens contact thickness + front pad free thickness + rear pad free thickness − closed stop gap`. The desired compression must come from the material/contact test. For curved contacts, use their measured axial positions rather than this simplified stack formula.

**Do not add pads to the existing STL unchanged.** For example, putting two 0.5 mm pads into its nominal 0.3 mm spare gap would force approximately 0.7 mm of total pad compression for a flat lens. That is not an approved preload.

## Coupon matrix: design targets, not validated settings

Start with a complete rim and retainer for one inexpensive test lens, without bridge or temples. Include its orientation mark. Generate separate variants rather than making users force a tight fit.

| Variable | Initial trial values | Purpose |
|---|---|---|
| Radial cavity allowance | 0.15 / 0.25 / 0.35 mm | Find printer/material clearance without changing the measured lens silhouette. |
| Replaceable contact pad thickness | 0.5 / 0.8 / 1.0 mm, subject to available smooth stock | Explore conformity; stop spacing must be regenerated for each stack. |
| Stop spacer increments | 0.1 mm, if the actual process can reproduce them | Adjust closure reproducibly; measure printed shims rather than trusting nominal thickness. |
| Lens sample | Measured thin / mid / thick examples within the proposed 1–6 mm interval | Establish an observed operating subset rather than claiming the full range. |

Prusa explicitly states that mating-part tolerance has no universal value and needs adjustment for the process and geometry. These coupon allowances therefore remain experiment settings, not production limits. [Prusa dimensional-fit guidance](https://help.prusa3d.com/article/modeling-with-3d-printing-in-mind_164135)

## Prototype evidence to record

- [ ] Caliper and printed-outline comparison confirms the real contour before printing the cassette.
- [ ] Record printer, filament, orientation, layer height, measured cavity dimensions and pad stock.
- [ ] Lens inserts without forcing; lips and pads touch intended edge regions; no screw or rough support scar touches the lens.
- [ ] Hard stops close as designed; screw torque is recorded for the experiment, with no unsupported universal torque recommendation.
- [ ] No perceptible rattle or rotation under a repeatable documented handling test; record the actual applied loads and measurement method.
- [ ] Inspect for edge chips, coating marks and deformation before/after assembly. Have optical effects assessed using appropriate optical equipment.
- [ ] Recheck after repeated assembly and a documented time under load; record pad settling, fastener loosening and frame creep.
- [ ] Test cleaning and intended ambient conditions on the prototype materials; retain inspection photographs and failed samples.
- [ ] Repeat on the second, different lens before generating the complete frame.

Passing these development checks establishes only the tested lens/material/process combination. Prescription alignment, wearer fit, durability, and any applicable product qualification remain separate from printable mesh validation.

## Smallest implementation after the first coupon

Add explicit `radial_clearance_mm`, per-lens pad/stop settings and measured contact-thickness inputs to the CAD settings. Export a single-lens fit coupon and its settings alongside the full kit. Preserve the current contour and optical-centre coordinate contract. Include the selected pad material, actual hardware, tested closure gap and assembly order in the export notes. Do not expose a “universal fit” preset.
