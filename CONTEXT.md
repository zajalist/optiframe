# OptiFrame domain context

OptiFrame is a frame-design aid for a local eye-care provider who has two **actual, inspected lenses** and a particular wearer. A printed frame can position existing lenses; it cannot make an unsuitable prescription suitable. The provider remains responsible for lens power, eye assignment, optical-centre marks, orientation, and wearer fitting.

## Terms and ownership

| Term | Meaning | Source of truth |
| --- | --- | --- |
| Lens item | One physical recycled lens, assigned to left or right eye and marked at its top and optical centre | Provider / physical label |
| Prescription suitability | Whether this lens's optical properties suit that wearer's eye | Eye-care provider, never image AI |
| Lens contour | Closed outer edge of the physical lens, expressed in millimetres relative to its marked optical centre | Reviewed calibrated photo; cross-checked with calipers and repeat capture |
| Edge thickness | Measured thickness at the retaining edge | Calipers; not inferred from a front photo |
| Wearer alignment | Separate pupil positions and vertical fitting offsets for left and right eyes | Provider measurements |
| Assembly coordinates | Millimetre coordinates of the fitted front, retainers, temples and lens placeholders | Parametric CAD model |
| Build-plate coordinates | Separate parts rotated and spaced at Z=0 for slicing | Plate packer; distinct from assembly coordinates |

## Status boundaries

1. **Captured** means a phone image, archive, video frame, or depth sample exists. It carries no scale by itself.
2. **Measured** means a visible contour has been corrected and mapped using a physically verified reference sheet.
3. **Measurement checked** means each lens's width, height and repeated edge agree within the current 0.5 mm target. This is repeatability evidence, not proof that every true edge point is within 0.5 mm.
4. **Geometry checked** means meshes are closed, assembly solids do not intersect, and all custom printed parts fit on the selected build plate.
5. **Print tested** requires a slicer check with the actual printer profile and a physical lens fit test. Current synthetic slicing does not establish this status.
6. **Wearable** requires professional optical and physical assessment. The app does not grant this status automatically.

Android WebXR and iPhone ARKit point clouds are experimental scene observations. A transparent lens can yield background depth. Point clouds stay out of CAD until a specific capture mode beats the calibrated photo baseline against physical measurements.

Research and source links: [docs/research.md](docs/research.md). Current hardware evidence and missing checks: [docs/validation.md](docs/validation.md). Geometry and API contracts: [gpu/README.md](gpu/README.md).
