# OptiFrame

**SNSF hackathon:** turn two recycled eyeglass lenses, even if they have different outlines, into a measured, printable custom frame.

## The winning demo

On a phone, photograph each lens on a calibrated capture sheet. Confirm the detected outline, choose a bridge width, inspect the 3D frame, and download its STL. Show the physical lenses seated in a printed test piece or frame. Put measured dimensions and a fit check beside the preview so the result is credible.

## Build order

1. **Measure:** capture and rectify each lens photo with four known-position markers; extract an outline in millimetres; allow touch-up.
2. **AI:** offer an AI outline proposal for difficult images, with a visible editable mask. Keep the final measurements geometric and inspectable.
3. **Design:** generate a separate rim for each outline, joined by an adjustable bridge. Prefer a simple two-part retaining rim for the prototype.
4. **Validate:** compare repeated captures and caliper measurements, print a small fit coupon, then export and print the final design.

The core proof is **two different real lenses -> two measured contours -> one frame -> physical fit**. A splat or face scan is optional polish, not a measurement input.

## Project notes

- [Research and evidence](docs/research.md) — what the sources support, open questions, and decisions.
- [Hackathon build plan](docs/build-plan.md) — scope, architecture, order of work, and demo.
- [Validation protocol](docs/validation.md) — concrete checks and pass/fail evidence.

## Status

Research and build plan only. No measurement accuracy or lens fit is claimed until it is tested with the actual lenses and printer.
