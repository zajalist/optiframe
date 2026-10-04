---
name: OptiFrame
description: Editorial introduction and focused lens capture with optional illustrated guidance.
colors:
  welcome-ink: "#191a1c"
  welcome-paper: "#f2f2f2"
  welcome-muted: "#b9bdc5"
  welcome-accent: "#e5eaf2"
  welcome-line: "#41454d"
  glass-hover: "#ffffff26"
  glass-primary: "#ffffff19"
  glass-foreground: "#f8f9fc"
  glass-hover-foreground: "#fff"
  scanner-live-contour: "#58c9ff"
  welcome-copy: "#d2d5dc"
  welcome-subtle: "#aeb4be"
  welcome-paper-copy: "#515660"
  welcome-paper-line: "#b9bdc5"
  welcome-outline: "#777d87"
  welcome-sheet: "#272b31"
  scanner-background: "#101112"
  scanner-foreground: "#f5f5f5"
  scanner-muted: "#b9babc"
  scanner-accent: "#c6defa"
  scanner-stage: "#050506"
  scanner-contour: "#e5eaf2"
  scanner-active: "#d7d8da"
  guide-background: "#262a32"
  glass-dark: "#292d34"
  glass-control: "#ffffff10"
  glass-dialog: "#20242be6"
  guide-foreground: "#f5f6f8"
  guide-muted: "#b6bdc8"
  guide-accent: "#d6e5f8"
  guide-button-ink: "#17191d"
  guide-button-hover: "#e3eaf5"
  guide-paper: "#e8ebf0"
  guide-contour: "#e1e9f4"
typography:
  welcome-display:
    fontFamily: 'Manrope, "Segoe UI", sans-serif'
    fontSize: "clamp(62px,6.4vw,96px)"
    fontWeight: 650
    lineHeight: 1.06
    letterSpacing: "-.04em"
  welcome-headline:
    fontFamily: 'Manrope, "Segoe UI", sans-serif'
    fontSize: "clamp(35px,3.5vw,54px)"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-.035em"
  welcome-body:
    fontFamily: 'Manrope, "Segoe UI", sans-serif'
    fontSize: "16px"
    lineHeight: 1.8
  welcome-button:
    fontFamily: 'Manrope, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 700
  scanner-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-.02em"
  scanner-body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: ".8125rem"
    lineHeight: 1.4
  scanner-button:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: ".9375rem"
    fontWeight: 600
  guide-title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-.025em"
  guide-body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  control-radius: "999px"
  panel: "24px"
  studio-field: "14px"
  circle: "50%"
  guide-dialog: "30px"
spacing:
  scanner-action-gap: "8px"
  control-gap: "12px"
  scanner-stage-gap: "14px"
  scanner-header-gap: "16px"
  scanner-gutter: "20px"
  guide-shell: "12px 24px 24px"
components:
  welcome-primary:
    backgroundColor: "{colors.glass-primary}"
    textColor: "{colors.glass-foreground}"
    typography: "{typography.welcome-button}"
    rounded: "{rounded.control-radius}"
    padding: "17px 23px"
  welcome-primary-hover:
    backgroundColor: "{colors.glass-hover}"
    textColor: "{colors.glass-hover-foreground}"
  welcome-outline:
    backgroundColor: "{colors.glass-control}"
    textColor: "{colors.glass-foreground}"
    rounded: "{rounded.control-radius}"
    padding: "13px 17px"
  welcome-outline-hover:
    backgroundColor: "{colors.glass-hover}"
    textColor: "{colors.glass-hover-foreground}"
  scanner-primary:
    backgroundColor: "{colors.scanner-foreground}"
    textColor: "{colors.scanner-background}"
    typography: "{typography.scanner-button}"
    rounded: "{rounded.control-radius}"
    padding: "0 30px"
  scanner-primary-active:
    backgroundColor: "{colors.scanner-active}"
  scanner-shutter:
    rounded: "{rounded.circle}"
    width: "72px"
    height: "72px"
    padding: "4px"
  guide-dialog:
    backgroundColor: "{colors.guide-background}"
    textColor: "{colors.guide-foreground}"
    typography: "{typography.guide-body}"
    rounded: "{rounded.guide-dialog}"
    width: "min(480px, calc(100vw - 32px))"
  guide-next:
    backgroundColor: "{colors.guide-foreground}"
    textColor: "{colors.guide-button-ink}"
    rounded: "{rounded.control-radius}"
    padding: "0 18px"
  guide-next-hover:
    backgroundColor: "{colors.guide-button-hover}"
---

# Design System: OptiFrame

## Overview

**Creative North Star: "Optically lit introduction, focused camera operation"**

OptiFrame has two deliberate surface families. The welcome page is a Persuade surface: charcoal, silver, slate, generous Manrope typography, and a dramatically lit frame concept. The scanner is an Operate surface: system typography, a nearly black camera stage, compact instructions, and one next action. Their typography and density remain separate. Rounded pill controls and a restrained glass finish now connect the welcome, scanner, and fitting workspace.

The optional tutorial belongs to Operate even when opened from the welcome page. It uses a native dialog with the proportions and controls of a phone guide, restrained motion, and precise diagrams derived from existing captured contours. The concept image is explicitly a generated illustration; neither imagery nor diagrams imply proven physical accuracy or a certified product.

**Key Characteristics:**

- Expressive, scrollable introduction with an optically lit concept hero.
- Minimal scanner contained within the viewport, without editorial sections or page scrolling.
- Optional guidance with independent left and right contours and one illustrated step at a time.
- Clear separation between a contour proposal and checked physical measurements.
- Shared rounded controls and frosted primary and secondary surfaces with opaque fallbacks.

Extracted from `web/welcome.html`, `web/welcome.css`, `web/welcome.js`, `web/simple.css`, `web/simple.js`, `web/tutorial.css`, `web/tutorial.js`, and the overriding shared `web/glass.css`. Tokens describe the implemented defaults; responsive changes and interaction details follow below. Studio coverage here is limited to the shared control finish, panel shapes, and field radii.

## Colors

### Primary

Welcome silver highlights the concluding hero phrase. Primary landing actions use translucent white glass with a brighter bevel, and secondary actions use a quieter translucent fill. Scanner focus and tutorial technical annotations use pale blue. Live contour review uses cyan; exported outline previews use silver. These roles stay distinct.

### Neutral

Welcome charcoal supports silver-white type and the illuminated image. The neutral white process section reverses text to charcoal, with its own slate copy and dividers. The reference-sheet image sits on a slightly lighter dark plane. Scanner near-black separates the camera stage from its surrounding controls; off-white carries the primary action. Guide charcoal, soft white, and muted gray support readable steps over a dark backdrop.

**The Surface Boundary Rule.** Preserve each surface's typography, density, and accent assignments while sharing the rounded control finish through glass.css.

## Typography

Manrope with Segoe UI and sans-serif fallbacks belongs to the welcome page. Tight tracking and medium weights give its large headings an editorial voice. The hero supports short deliberate lines; text remains live HTML over the image. Principle copy uses the welcome body role, while individual sections use their observed local sizes.

The scanner and guide use the platform system stack recorded in their tokens. Scanner instructions remain compact and subordinate to the stage. The guide title and body are larger for step-by-step reading, with descriptions capped at 42ch. Progress and measurements use tabular numerals where implemented.

**The Operating Type Rule.** Preserve system typography in the scanner and tutorial, including when a tutorial opens over the Manrope welcome page.

## Layout

Welcome is a vertically scrolling editorial page. Desktop outer margins begin at 5%; several sections use 7% padding. The hero combines a left text block with a large right image. Below it, process and reference-sheet sections provide the practical steps. The process is a numbered list divided by rules, not a grid of cards.

At 1100px and below the hero and section gaps tighten. At 760px and below sections become a single column, gutters become 6%, secondary header links hide, and the hero image moves below the copy. Its mobile crop intentionally enlarges the optical object. At 1600px and above gutters incorporate a centered 1500px content measure. The 380px override adjusts the smallest hero composition. These values are recorded as breakpoints in the sidecar.

Scanner fills `100dvh` with a `100vh` fallback, caps width at 900px, and respects top and bottom safe-area insets. Header and action rows frame a shrinking camera stage. Both document and body suppress page overflow. There are no promotional sections inside this flow. Pair results stack vertically until the 650px breakpoint, then share a row. Short viewports reduce gaps and shutter size at 640px height.

Tutorial is optional and opens on request. Its native dialog is centered on larger screens and sits near the bottom on phones at 520px width or below. The default shell stacks header, visual, copy, progress, and actions. At 730px height the illustration shortens; at 570px height visual and copy share columns, with a narrow-screen override restoring a compact stack. Opening the guide locks background scrolling and closing restores focus to the trigger.

## Elevation & Depth

Welcome depth comes from the illuminated object image, graphite field, tonal shifts, and thin rules. Its primary surfaces have no card shadows. The hero image uses `mix-blend-mode: lighten`; the image alt text identifies the generated frame concept.

Glass controls combine translucent white fill, a reflective gradient, a bright upper bevel, a darker lower edge, and restrained lift shadows. Primary landing and secondary controls receive frosted backgrounds when standard or WebKit backdrop filtering is supported; the guide uses a stronger blur, inset highlight, and dialog shadow. Opaque colors are declared first, and reduced-transparency preferences disable filtering. Exact shadows, filter declarations, focus, and motion values live in `.impeccable/design.json`.

**The Clear Camera Rule.** Apply glass to small controls and the optional dialog; keep live camera images and measurement overlays unblurred.

The existing Higgsfield frame concept image is retained and rendered in grayscale. It settles once over 4.5 seconds with small translation, rotation, scale, and brightness changes. Fine-pointer hover triggers one 650ms reflection pass across landing glass controls; the hero and control reflections do not loop. Tutorial motion explains reflected light, settling capture brackets, and printer layers; it does not automatically advance steps. Reduced-motion preferences disable these animations and smooth scrolling.

## Shapes

Welcome, scanner, guide, and studio actions share pill corners. The shutter remains circular. The camera stage, reference-sheet container, and studio lens panels share the panel radius; the guide uses the larger dialog radius. Studio canvas and numeric-field surfaces use the smaller studio-field radius. Editorial sections keep their existing composition and dividers.

Tutorial lens silhouettes are the two distinct captured contours from `gpu/fixtures/scanned-lens-outlines.json`, rounded to two decimal places in the implementation. Preserve their asymmetry, contour detail, and orientation. Paper, reference grid, optical-centre crosses, arrows, and measurement lines remain SVG geometry. The diagrams explain the process; their visual precision is not evidence of validated millimetre accuracy.

## Components

### Welcome actions and navigation

The opening header and hero occupy at least one dynamic viewport; the light collection becomes visible only after scrolling. Style concepts sit on an open product shelf with glass selection pills. The process overview is a compact row of three clickable Scan, Fit and Print diagrams; detailed instructions stay in the guides. Glass highlights and refraction-like edges belong on controls, never on camera pixels or measured outlines.

The translucent primary glass pill uses a plain text label and directs users into the scanner. Secondary document and scanner navigation actions have frosted fills; the hero guide trigger is also a pill. Other inline guide links retain their text treatment. Primary hover brightens its translucent fill and reflective gradient; pill presses scale slightly. Keyboard focus uses a visible accent outline, with a darker blue outline on the neutral white section. The wordmark and scanner link stay available on mobile. Same-site scanner and home links preserve a session access fragment.

### Scanner stage and controls

The stage is the largest available region. A compact heading identifies the lens. Stable, supported camera evidence triggers capture; there is no live shutter. The primary action confirms or advances in later states. Photo import and camera retry remain compact stage controls. One actionable capture cue appears at a time. Pair previews preserve left and right identities.

### Phone fitting

The landing page scrolls through the frame concept, selectable style concepts and a concise capture-to-print guide, following the user's updated brief. Camera capture remains within one viewport. Fitting is a separate viewport sequence: summary, measurement source, pupil distances, edge thicknesses, left/right marks, fitting settings, actual assembly and print preparation. Use the platform font, neutral paper background and rounded silver controls. Dimensions sit within the lens silhouettes. Keep necessary measurement provenance and errors concise; do not add explanatory panels or decorative arrows. Numeric fields adapt to the software keyboard. Optional detailed physical verification remains in the advanced studio.

### Optional tutorial

The capture guide contains five steps; the printing guide contains six. A step has one diagram, a short title, concise instructions, progress, Back, and Next. The last action closes the guide with a task-specific label. Close, backdrop click, and native Escape dismiss it. Arrow keys change steps, dots jump directly, focus moves to the current title, and Tab stays within enabled dialog controls. Guidance is available on demand rather than blocking capture at startup.

The SVG diagram is decorative to assistive technology because nearby copy conveys the task. It is constrained to the visual container, and diagram text explicitly disables inherited strokes so landing styles cannot outline its labels. The guide includes the calibration-sheet link only where applicable. Keep the existing contour geometry when refining its diagrams; conceptual frame outlines remain explanatory previews.

## Do's and Don'ts

### Do:

- **Do** preserve the expressive welcome page and compact scanner as separate surface families.
- **Do** keep tutorial guidance optional, keyboard accessible, and readable at short phone heights.
- **Do** use the existing independent contours for technical diagrams and clearly label generated concept imagery.
- **Do** retain reduced-motion behavior, visible focus, and physical measurement checks.
- **Do** use the shared pill and panel radii, with opaque fallbacks and reduced-transparency support for glass surfaces.

### Don't:

- **Don't** add landing-page sections, promotional cards, Manrope headings, or page scrolling to the scanner.
- **Don't** replace the two lens contours with a symmetric generic glasses icon in instructional diagrams.
- **Don't** imply proven millimetre accuracy, validated physical fit, or certified eyewear through claims or imagery.
- **Don't** blur the camera image or measurement overlays, or import the landing page's editorial layout into the scanner.
## Copy restraint

The landing frame uses the existing Higgsfield concept image with one 2.4-second studio-light reveal. It stops after settling; reduced motion, data saving and backgrounding suppress the effect. No extra media request, perpetual animation or UI decoration is added. A proposed Higgsfield video could not be generated because the workspace had no credits; it is not a shipped asset.

Keep controls text-only, without decorative arrows. Do not add slogans, floating captions, process ribbons, or repeated calls to action. Keep instructions in the capture/printing guides and preserve only necessary measurement and error guidance in the scanner.

