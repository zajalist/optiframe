# OptiFrame

**SNSF hackathon:** help a local eyewear provider make a frame for a particular person from two available, professionally verified lenses. The lenses can differ in prescription, size, and outline; the frame does not have to be symmetrical.

## The winning demo

An eyewear provider selects two lenses whose prescriptions have been checked for the recipient. On a phone, they enter the wearer's pupil positions and basic frame-fit measurements, then photograph each lens on a calibrated sheet. The app measures both outlines, places each lens independently in front of the corresponding eye, generates a custom frame, previews it, and downloads a **slicer-ready STL**. The demo ends with the real lenses seated in a printed test piece or frame.

## Build order

1. **Match:** record the recipient's right/left prescription and fitting measurements; require professional verification that each available lens is suitable. The app does not infer lens power from a photo.
2. **Measure:** capture and rectify each lens photo with four known-position markers; extract an outline in millimetres; allow touch-up.
3. **AI:** offer an AI outline proposal for difficult images, with a visible editable mask. Keep the final measurements geometric and inspectable.
4. **Design:** position each lens's marked optical centre independently for the wearer, then generate separate rims and a bridge. Prefer a simple two-part retaining rim for the prototype.
5. **Validate:** compare captures and caliper measurements, check optical-centre placement with the provider, print a fit coupon, then verify the exported STL slices without repair at the intended size.

The core proof is **verified lenses + wearer measurements -> two independent lens positions -> one asymmetric frame -> physical fit**. A splat or face scan is optional polish, not a measurement input.

**Export acceptance:** one download contains every custom printed part, laid out separately on the build plate, with closed printable geometry in millimetres. It must open in a slicer without mesh repair. The app must say when the selected printer bed is too small. Screws or other non-printed hardware are listed separately.

## Project notes

- [Research and evidence](docs/research.md) — optical and physical constraints, source evidence, and decisions.
- [Hackathon build plan](docs/build-plan.md) — scope, architecture, order of work, and demo.
- [Validation protocol](docs/validation.md) — concrete checks and pass/fail evidence.

## Status

Research and build plan only. No measurement accuracy or lens fit is claimed until it is tested with the actual lenses and printer.
