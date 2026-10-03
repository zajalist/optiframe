# OptiFrame product

<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
Humanitarian teams and local eye-care providers working with available recycled lenses and a particular wearer. An eye-care provider checks prescription suitability and marks each lens's optical centre and top orientation.

## Product Purpose
Measure two potentially different loose lenses, place them for one wearer, and produce an experimental printable frame kit. Success means the physical lenses fit the printed retainers and the provider verifies optical alignment and wearer fit.

## Positioning
The frame is generated around the actual recovered lenses and the wearer's separate left and right pupil positions, rather than requiring matching lenses or a standard symmetric frame.

## Operating Context
Each lens is photographed against a flat printed reference of known size. The operator reviews the proposed contour, uses physical calipers or a ruler, checks an independent capture, and then inspects the 3D assembly and STL in a slicer. Android WebXR and iPhone ARKit depth captures are experimental measurements of the scene, not validated lens surfaces.

## Capabilities and Constraints
- The current web app imports photos, video frames, and iPhone capture ZIPs; it proposes contours with aligned image difference or SAM2.1 on the available GPU.
- Four printed marker centres 100 × 70 mm apart give a homography and scale; physical print size must be verified.
- Two independent lens contours, optical centres, monocular pupil distances, edge thicknesses and vertical fitting offsets feed an asymmetric frame design.
- The frame export provides individual STL parts and a single build plate STL. The geometry is experimental until tested with the actual lenses, fasteners, printer, and wearer.
- Lens power, prescription suitability, optical-centre marks, orientation and wearable safety remain with an eye-care professional.
- Real-lens edge accuracy to a millimetre target has not yet been demonstrated with physical ground truth.

## Brand Commitments
The product name is OptiFrame. The user asked for a minimal, professional interface that keeps technical controls available without showing them all at once.

## Evidence on Hand
The user supplied a process collage and two short videos of clear lenses. SAM overlays from two video frames visibly follow the rims, but those frames do not include calibrated physical scale or caliper measurements. Software tests and a synthetic slicer smoke test are recorded in `docs/validation.md`; real phone and physical lens tests remain open.

## Product Principles
1. Show one next action at a time.
2. Separate contour proposals from checked physical measurements.
3. Preserve independent left and right lens shape and alignment.
4. Keep raw depth experiments outside printable geometry until they beat the calibrated-photo baseline.
