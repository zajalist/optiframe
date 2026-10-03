---
name: OptiFrame
description: Editorial introduction and focused lens capture with optional illustrated guidance.
colors:
  welcome-ink: "#191b19"
  welcome-paper: "#eeeee5"
  welcome-muted: "#b7bab0"
  welcome-accent: "#d5ef83"
  welcome-line: "#41453d"
  welcome-accent-hover: "#e4f6b0"
  welcome-copy: "#d4d7cc"
  welcome-subtle: "#a8ae9f"
  welcome-paper-copy: "#51564c"
  welcome-paper-line: "#bbbfb2"
  welcome-outline: "#777d6c"
  welcome-sheet: "#272b24"
  scanner-background: "#101112"
  scanner-foreground: "#f5f5f5"
  scanner-muted: "#b9babc"
  scanner-accent: "#c8fa72"
  scanner-stage: "#050506"
  scanner-contour: "#e5efdc"
  scanner-active: "#d7d8da"
  guide-background: "#191c1b"
  guide-foreground: "#f5f5f2"
  guide-muted: "#b1b5b1"
  guide-accent: "#d4ecba"
  guide-button-ink: "#151915"
  guide-button-hover: "#e3eadf"
  guide-paper: "#e8e9e3"
  guide-contour: "#e1eadb"
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
  scanner-stage: "4px"
  scanner-control: "6px"
  circle: "50%"
  guide-control: "10px"
  guide-dialog: "20px"
spacing:
  scanner-action-gap: "8px"
  control-gap: "12px"
  scanner-stage-gap: "14px"
  scanner-header-gap: "16px"
  scanner-gutter: "20px"
  guide-shell: "12px 24px 24px"
components:
  welcome-primary:
    backgroundColor: "{colors.welcome-accent}"
    textColor: "{colors.welcome-ink}"
    typography: "{typography.welcome-button}"
    padding: "17px 23px"
  welcome-primary-hover:
    backgroundColor: "{colors.welcome-accent-hover}"
  welcome-outline:
    textColor: "{colors.welcome-paper}"
    padding: "13px 17px"
  welcome-outline-hover:
    backgroundColor: "{colors.welcome-paper}"
    textColor: "{colors.welcome-ink}"
  scanner-primary:
    backgroundColor: "{colors.scanner-foreground}"
    textColor: "{colors.scanner-background}"
    typography: "{typography.scanner-button}"
    rounded: "{rounded.scanner-control}"
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
    rounded: "{rounded.guide-control}"
    padding: "0 18px"
  guide-next-hover:
    backgroundColor: "{colors.guide-button-hover}"
---

# Design System: OptiFrame

## Overview

**Creative North Star: "Optically lit introduction, focused camera operation"**

OptiFrame has two deliberate surface families. The welcome page is a Persuade surface: graphite, lime, editorial ivory, generous Manrope typography, and a dramatically lit frame concept. The scanner is an Operate surface: system typography, a nearly black camera stage, compact instructions, and one next action. Their typography and density remain separate.

The optional tutorial belongs to Operate even when opened from the welcome page. It uses a native dialog with the proportions and controls of a phone guide, restrained motion, and precise diagrams derived from existing captured contours. The concept image is explicitly a generated illustration; neither imagery nor diagrams imply proven physical accuracy or a certified product.

**Key Characteristics:**

- Expressive, scrollable introduction with an optically lit concept hero.
- Minimal scanner contained within the viewport, without editorial sections or page scrolling.
- Optional guidance with independent left and right contours and one illustrated step at a time.
- Clear separation between a contour proposal and checked physical measurements.

Extracted from `web/welcome.html`, `web/welcome.css`, `web/welcome.js`, `web/simple.css`, `web/tutorial.css`, and `web/tutorial.js`. Tokens describe the implemented defaults; responsive changes and interaction details follow below. The existing studio is outside this documentation's token scope.

## Colors

### Primary

Welcome lime highlights the concluding phrase in the hero and the main scanner actions. Scanner lime is reserved for focus and aiming feedback. The tutorial uses a softer green for diagram annotations and progress. These are separate, existing colors, not aliases for a shared accent.

### Neutral

Welcome graphite supports ivory type and the illuminated image. The ivory process section reverses text to graphite, with its own muted copy and dividers. The reference-sheet image sits on a slightly lighter dark plane. Scanner near-black separates the camera stage from its surrounding controls; off-white carries the primary action. Guide charcoal, soft white, and muted gray support readable steps over a dark backdrop.

**The Surface Boundary Rule.** Keep welcome, scanner, and guide color assignments local to their implemented surfaces; importing the welcome stylesheet into the scanner or dialog would erase intentional differences.

## Typography

Manrope with Segoe UI and sans-serif fallbacks belongs to the welcome page. Tight tracking and medium weights give its large headings an editorial voice. The hero supports short deliberate lines; text remains live HTML over the image. Principle copy uses the welcome body role, while individual sections use their observed local sizes.

The scanner and guide use the platform system stack recorded in their tokens. Scanner instructions remain compact and subordinate to the stage. The guide title and body are larger for step-by-step reading, with descriptions capped at 42ch. Progress and measurements use tabular numerals where implemented.

**The Operating Type Rule.** Preserve system typography in the scanner and tutorial, including when a tutorial opens over the Manrope welcome page.

## Layout

Welcome is a vertically scrolling editorial page. Desktop outer margins begin at 5%; several sections use 7% padding. The hero combines a left text block with a large right image. Below it, two-column principle, process, and preparation sections alternate reading and visual emphasis. The process is a numbered list divided by rules, not a grid of cards.

At 1100px and below the hero and section gaps tighten. At 760px and below sections become a single column, gutters become 6%, secondary header links hide, and the hero image moves below the copy. Its mobile crop intentionally enlarges the optical object. At 1600px and above gutters incorporate a centered 1500px content measure. The 380px override adjusts the smallest hero composition. These values are recorded as breakpoints in the sidecar.

Scanner fills `100dvh` with a `100vh` fallback, caps width at 900px, and respects top and bottom safe-area insets. Header and action rows frame a shrinking camera stage. Both document and body suppress page overflow. There are no promotional sections inside this flow. Pair results stack vertically until the 650px breakpoint, then share a row. Short viewports reduce gaps and shutter size at 640px height.

Tutorial is optional and opens on request. Its native dialog is centered on larger screens and sits near the bottom on phones at 520px width or below. The default shell stacks header, visual, copy, progress, and actions. At 730px height the illustration shortens; at 570px height visual and copy share columns, with a narrow-screen override restoring a compact stack. Opening the guide locks background scrolling and closing restores focus to the trigger.

## Elevation & Depth

Welcome depth comes from the illuminated object image, graphite field, tonal shifts, and thin rules. Its primary surfaces have no card shadows. The hero image uses `mix-blend-mode: lighten`; the generated illustration is captioned as a frame concept.

Scanner uses functional shadows only for the aiming crosshair and loupe. The guide uses a single substantial dialog shadow and a dark native backdrop to separate guidance from its invoking surface. Exact shadow, focus, and motion values live in `.impeccable/design.json`.

The hero arrives once with a reveal and small translation. Tutorial motion explains reflected light, settling capture brackets, and printer layers; it does not automatically advance steps. Reduced-motion preferences disable these animations and smooth scrolling.

## Shapes

Welcome actions and editorial planes use square edges and thin borders. Scanner stage corners are slightly rounded; primary controls are modestly rounded and the shutter is circular. The tutorial has a more rounded dialog shell, rounded actions, and small progress marks. These radii express local function rather than a universal card style.

Tutorial lens silhouettes are the two distinct captured contours from `gpu/fixtures/scanned-lens-outlines.json`, rounded to two decimal places in the implementation. Preserve their asymmetry, contour detail, and orientation. Paper, reference grid, optical-centre crosses, arrows, and measurement lines remain SVG geometry. The diagrams explain the process; their visual precision is not evidence of validated millimetre accuracy.

## Components

### Welcome actions and navigation

The lime primary action uses an inline arrow and directs users into the scanner. Outline links provide secondary document actions; unboxed text actions open guides. Hover lightens the primary fill, reverses outline actions, or underlines text. Keyboard focus uses a visible accent outline, with a darker green outline on the ivory section. The wordmark and scanner link stay available on mobile. Same-site scanner and home links preserve a session access fragment.

### Scanner stage and controls

The stage is the largest available region. A compact heading, step label, and instruction identify the next task. A circular shutter captures; the regular primary action confirms or advances in later states. Disabled actions fade, active shutter presses scale the inner disk, and keyboard focus remains visible. Photo import and camera retry are compact stage controls. Pair previews preserve left and right identities.

### Optional tutorial

The capture guide contains five steps; the printing guide contains six. A step has one diagram, a short title, concise instructions, progress, Back, and Next. The last action closes the guide with a task-specific label. Close, backdrop click, and native Escape dismiss it. Arrow keys change steps, dots jump directly, focus moves to the current title, and Tab stays within enabled dialog controls. Guidance is available on demand rather than blocking capture at startup.

The SVG diagram is decorative to assistive technology because nearby copy conveys the task. It is constrained to the visual container, and diagram text explicitly disables inherited strokes so landing styles cannot outline its labels. The guide includes the calibration-sheet link only where applicable. Keep the existing contour geometry when refining its diagrams; conceptual frame outlines remain explanatory previews.

## Do's and Don'ts

### Do:

- **Do** preserve the expressive welcome page and compact scanner as separate surface families.
- **Do** keep tutorial guidance optional, keyboard accessible, and readable at short phone heights.
- **Do** use the existing independent contours for technical diagrams and clearly label generated concept imagery.
- **Do** retain reduced-motion behavior, visible focus, and physical measurement checks.

### Don't:

- **Don't** add landing-page sections, promotional cards, Manrope headings, or page scrolling to the scanner.
- **Don't** replace the two lens contours with a symmetric generic glasses icon in instructional diagrams.
- **Don't** imply proven millimetre accuracy, validated physical fit, or certified eyewear through claims or imagery.
- **Don't** promote local landing composition or tutorial radii into a universal style for every application surface.
