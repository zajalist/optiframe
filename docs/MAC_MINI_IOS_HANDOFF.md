# OptiFrame — Mac mini / native iPhone handoff

Prepared 2026-10-04 UTC. Read the current source before editing: other agents may
have published newer web/backend changes. This document separates implemented
behavior from the next native work. The user will forward it manually.

## START HERE

On the Mac mini, clone `https://github.com/zajalist/optiframe.git` (private,
requires the user's GitHub access), start from the current `main`, and read
`docs/MAC_MINI_IOS_HANDOFF.md` in that checkout. Preserve any existing local work.
Use a task branch such as `codex/ios-uikit` for implementation, then reproduce
the existing simulator build/tests before migrating screens. The UIKit wizard
below is **planned work**; current native screens are mainly SwiftUI. Keep the
ARKit/TrueDepth services and data contracts while replacing UI incrementally.

**P0 native UI task:** reproduce the actual screenshot defect from CI artifact
`native-ui-proof` in run `37173479241`: the app is letterboxed and the primary
camera action is below the visible area. A missing generated launch-screen
setting is a candidate cause of compatibility sizing, **not a confirmed cause**.
Test `INFOPLIST_KEY_UILaunchScreen_Generation: YES` in XcodeGen alongside the
root/safe-area layout, regenerate, and verify on both Simulator and a physical
iPhone. Fix this before further decorative work. Preserve accessible large-text
scrolling while making normal camera actions reachable without scrolling.

## Assignment

Make the native iPhone experience feel like a polished camera app, using UIKit
extensively and Apple's real system controls. Preserve the existing ARKit,
TrueDepth, capture, import and measurement logic. Finish a coherent capture →
review → fitting → frame selection → try-on → export flow without claiming
unvalidated millimetric or clinical accuracy.

Design requirements: restrained neutral dark glass, SF typography/SF Symbols,
rounded touch controls, minimal copy, no green, no decorative face oval, no
scrolling to reach the main camera action at normal text sizes. Keep an accessible
scroll fallback for large Dynamic Type. Measurements belong on the actual lens
contour. Guides and technical settings belong in system sheets or disclosures.

## Repository and current evidence

- Private repository: `https://github.com/zajalist/optiframe`, branch `main`.
- Windows source checkout: `C:/Users/Admin/Documents/ChatGPT/hackathon-glasses`.
  Clone on the Mac; do not assume that Windows path exists there.
- Read `AGENTS.md` if present, `CONTEXT.md`, `DESIGN.md`, `ios/README.md`,
  `docs/face-fitting.md`, and the relevant files listed below.
- Native TrueDepth/review commit `85d3547e4b0965fe9021a9f5129997157140c2a1`:
  [unsigned build and 20 tests passed](https://github.com/zajalist/optiframe/actions/runs/37172412523).
- Native glass UI commit `041a62c66ae8eb9600de35c16ae335b31d7fa069`:
  [unsigned build and 20 tests passed](https://github.com/zajalist/optiframe/actions/runs/37172902498).
- Screenshot workflow follow-up `b9cd03acea9faa41299807800c1f90b78d6ea11c`:
  [build/tests and screenshot capture passed](https://github.com/zajalist/optiframe/actions/runs/37173479241).
  Download artifact `native-ui-proof`, file `iphone16-launch.png`. Its predecessor
  was cancelled after screenshot launch stalled; the bounded follow-up succeeded.
  The actual screenshot exposes unfinished UI: letterboxed viewport, oversized
  camera region, and primary actions below the fold. A white simulator camera
  region is not evidence of a functioning physical camera. Treat these as Mac
  UI priorities, not an approved visual baseline. Inspect the generated launch
  screen settings (`project.yml` currently lacks
  `INFOPLIST_KEY_UILaunchScreen_Generation`) and safe-area/root layout first.
- No signed device build, physical iPhone measurement validation, App Store
  release or TestFlight build has been verified. Simulator success is not any
  of those. The parent agent reports the full 113-test GPU suite now passes
  locally after an account-gating JavaScript fixture fix; verify fresh CI status
  separately rather than inferring it from native CI.

## Current native architecture

`ios/project.yml` is the XcodeGen source of truth: Swift 5.9, minimum iOS 18,
iPhone target, bundle ID `com.zajalist.optiframe.capture`, ZIPFoundation dependency.
Generated Xcode project files are not the place for durable project changes.

| File under `ios/OptiFrameCapture/` | Responsibility |
| --- | --- |
| `OptiFrameCaptureApp.swift` | SwiftUI app entry; opens `CaptureView`. |
| `CaptureView.swift` | Lens camera, mode/side controls, review/export; presents face scan and try-on. Currently a SwiftUI shell around ARSCNView. |
| `LensCapture.swift` | Rear ARSession lifecycle, original frame/pose/depth capture, bounded sequences, live server proposals, archive export. |
| `FrameProcessor.swift` | Image processing, quality metrics and projection helpers. |
| `FaceFitCapture.swift` | Separate front ARSession, capability/quality gates, stable draft, explicit confirmation and protected JSON export. |
| `FaceFitMath.swift` | Pure sample/window math, depth acceptance gate, export/review models. |
| `FaceFitView.swift` | Front preview and review → confirm → share interface. |
| `TryOnCapture.swift` | ARSCNView face tracking, actual assembled model, face occlusion and lifecycle. |
| `TryOnModel.swift` | Bounded JSON decoder, validation and CAD-mm → ARKit-m conversion. |
| `TryOnView.swift` | JSON file picker, live visual try-on, error/retry UI. |
| `OptiGlass.swift` | Current SwiftUI dark material/button helpers, Reduce Transparency/Motion handling. This is a baseline, not the requested UIKit migration. |

Tests live in `ios/OptiFrameCaptureTests/`: 7 capture-math, 9 face-fit-math and
4 try-on-model tests. Keep them passing when replacing view layers.

## UIKit-first implementation plan — next work, not already shipped

### Interaction direction from the latest review

Frame fit should lead with the eye mannequin and the actual reviewed lens
outlines. Place compact wearer-right/left height inputs below it on iPhone,
with arm length on one row. Use a side-by-side preview and controls on wider
windows. Keep rotation, mirroring, assignment swap and reset inside a collapsed
**Adjust lenses** disclosure. Use consistent SF Symbols with accessible action
names and short labels; do not expose a wall of text buttons or imply unsupported
drag gestures. Preserve exact numeric entry and visible units.

Test every wizard step with the keyboard open, large Dynamic Type, small iPhone,
landscape and iPad sizes. Content must scroll without stranding the primary
action, hiding errors, or discarding values. Keep measurement provenance and
prototype-only limitations visible where they affect export.

1. **Establish a UIKit shell.** Add a navigation/coordinator controller that owns
   workflow state and child view controllers. Embed current SwiftUI screens with
   `UIHostingController` while migrating one surface at a time; if the SwiftUI
   entry remains temporarily, expose the UIKit coordinator through
   `UIViewControllerRepresentable`. Never create a second ARSession just to
   redraw controls. Bind existing observable capture state on the main thread.
2. **Camera first.** Use an ARSCNView inside a UIViewController, constrained to
   available safe-area space. Place a compact native navigation bar above it
   and primary actions within thumb reach below/over it. Use UIButton
   configurations, UISegmentedControl, UIMenu and UIBarButtonItem. Move server
   configuration and capture guidance into UISheetPresentationController sheets.
   Keep keyboard, safe-area changes, interruptions and dismissals explicit.
3. **Build the guided wizard around existing services.** Model first lens,
   first review, second lens, pair summary, fitting, styles, try-on and export
   as typed states with deliberate retry/back behavior. The current native app
   exports one lens ZIP; the complete two-lens wizard currently lives on the web.
   Native automatic lens acceptance is new work: do not substitute a timer or a
   guessed outline for stable, calibrated backend evidence. Keep photo import
   and an accessible manual fallback discoverable.
4. **Review the real pixels and geometry.** Show the rectified contour with
   dimensions, plus a Source/Outline switch for the matching captured image.
   Map touches correctly through zoom/pan; provide drag refinement with an
   offset magnifier. Do not put four pixel-nudge buttons in the main view.
   Any source overlay must refer to its own frame, not a newer camera frame.
5. **Face scan and fitting.** Present the existing TrueDepth controller logic
   in UIKit, with one short guidance message, actual progress, a review screen
   and explicit confirmation. Let users edit/manual-enter values or skip for an
   illustrative prototype. Never label a skip as provider-verified. Use native
   fields with units, keyboard navigation and visuals driven by actual values.
6. **Catalog and try-on.** Use a UICollectionView with three real CAD styles
   (Classic, Bold, Brow), actual model previews, retention selection and current
   values. Keep style selection distinct from patient measurement. Import/render
   assembled meshes through the existing validated model pipeline. Native silver
   logo infill preview remains optional work; the engraving itself already exists.
7. **Review/export.** Use native sheets/share controller/document picker. Keep
   prototype and checked export provenance distinct. Preserve the existing ZIP,
   JSON, STL and coordinate contracts. Provide errors/retry for offline, invalid
   file, unapproved account, busy GPU, expired login and failed export.

Use Auto Layout and layout guides rather than fixed screen coordinates. Controls
need at least 44 pt hit regions (48 pt is the current target). Use preferred
text styles, `adjustsFontForContentSizeCategory`, meaningful accessibility labels,
values and traits, and sensible VoiceOver order. Announce state changes without
reading every camera frame. Respect Reduce Motion and Reduce Transparency,
including changes while the screen is open. Preserve the user's content when
moving between portrait, landscape, foreground/background and keyboard states.

## Actual UIKit / Liquid Glass APIs

Apple recommends standard UIKit controls and system bars/sheets rather than
rebuilding their materials. Build with an SDK that contains the APIs you use;
the current iOS 18 deployment minimum may remain. The existing macOS-15 CI
workflow does not explicitly select Xcode 26: update its SDK selection alongside
any iOS 26 API adoption and verify the installed Xcode version.
[Apple's UIKit migration session](https://developer.apple.com/videos/play/wwdc2025/284/)

For iOS 26+, use `UIButton.Configuration.glass()` and
`UIButton.Configuration.prominentGlass()` for suitable controls, guarded by
`if #available(iOS 26.0, *)`. On iOS 18–25 use existing system button
configurations, for example `.gray()` / `.filled()`. These are real UIKit APIs,
not SwiftUI material modifiers.
[glass](https://developer.apple.com/documentation/uikit/uibutton/configuration-swift.struct/glass()),
[prominentGlass](https://developer.apple.com/documentation/uikit/uibutton/configuration-swift.struct/prominentglass())

For custom floating controls on iOS 26, `UIVisualEffectView(effect: UIGlassEffect())`
is available; add subviews to its `contentView`. Use an availability guard and
fall back to `UIVisualEffectView(effect: UIBlurEffect(style: .systemThinMaterialDark))`
on older supported systems, with an opaque accessible fallback. Prefer system
bars/sheets where possible, avoid stacked glass-on-glass, and avoid overriding
their backgrounds in ways that defeat the system appearance.
[UIGlassEffect](https://developer.apple.com/documentation/uikit/uiglasseffect),
[Apple adoption guidance](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)

## TrueDepth measurement rules — preserve these

- Measurement mode requires both `ARFaceTrackingConfiguration.isSupported` and
  a front `.builtInTrueDepthCamera`. General visual try-on has the broader ARKit
  face-tracking capability gate; do not conflate the two.
- Each accepted face sample requires real `capturedDepthData` with `.absolute`
  accuracy, a fresh/distinct depth timestamp within 120 ms of its image, and
  normal tracking. RGB frames without depth are skipped, not assumed to have it.
- One tracked face, consistent anchor, 30–65 cm distance, roughly frontal
  orientation (12°), eyes open, relaxed jaw, sufficient estimated ambient light.
  These are app heuristics; light estimates are not calibrated lux readings.
- 21 samples over at least 1.9 s; a gap above 350 ms resets the sample window.
  Each side must have standard deviation ≤0.4 mm and total spread ≤1.2 mm.
  Low spread is repeatability, not true measurement accuracy.
- Values come from ARFaceAnchor **eye-transform origins** in metres converted
  to millimetres. These are eyeball centres, not clinically established pupil
  centres. Do not claim that infrared hardware alone validates prescription PD.
- Stop/pause on lost tracking, backgrounding, interruption or serious/critical
  thermal state. Discard late callbacks after dismissal/retry. Keep front and
  rear sessions separate; existing lens data disables switching sessions until
  exported/reset.
- Stable output first creates a draft. Only explicit confirmation produces the
  shareable measurement file. Retry removes the old export/draft. No face images,
  meshes or depth maps are persisted/uploaded by this measurement/try-on flow.

Confirmed face JSON stays `schemaVersion: 1`, `kind: "optiframe-face-fit"`,
`units: "mm"`, `source: "arkit-eye-transform-estimate"`,
`depthSource: "front-truedepth-absolute"`, `userReviewed: true`, and
`requiresProviderVerification: true`. Keep numeric measurements, quality,
capability and samples. Legacy JSON without depth fields is not proof of a
depth-gated scan.
[Apple captured depth](https://developer.apple.com/documentation/arkit/arframe/captureddepthdata),
[depth timestamp](https://developer.apple.com/documentation/arkit/arframe/captureddepthdatatimestamp),
[eye origin](https://developer.apple.com/documentation/arkit/arfaceanchor/lefteyetransform)

## Lens capture, preview and manufacturing contracts

- Original/enhanced JPEG, camera intrinsics, camera-to-world pose and optional
  depth/confidence must come from the **same ARFrame**. Sensor image axes are
  preserved; a portrait preview does not rotate stored pixels. ZIP schema 1,
  depth float32 metres and confidence uint8; see `ios/README.md` before touching
  projection or export code. Current sequences sample up to 12 attempts over
  about 9 seconds. They are JPEG bursts, not encoded video.
- Rear LiDAR is scene depth: transparent lens pixels can return background or
  no depth. Never use that as a verified lens surface or thickness. Scale and
  perspective still require the known-size reference and reviewed lens outline.
- Native live SAM proposals use HTTPS GPU `/api/segment`, one request in flight,
  and a matched source-frame overlay. No local SAM model or native realtime
  performance guarantee is shipped. CAD/segmentation run on the Windows GPU host.
- Native try-on accepts `/api/frame-preview` assembled JSON, not STL/build-plate
  layout: schema 1, millimetres, two optical reference triples, triangular meshes.
  Preserve importer limits and validation. Transform points as `(-x, y, z)/1000`
  after centring on the optical midpoint; reverse triangle winding. Preserve
  physical scale; the current 18 mm forward placement is illustrative.
- Styles: Classic/Bold/Brow have distinct manufactured temple profiles. Retention
  values are `screw` (M2 hardware) and `snap` (eight printed push pins, not simply
  forcing an arbitrary-thickness lens into a rigid rim). Both require physical
  retention/fit tests; preserve seats, hinge bores and clearances.
- The real OptiFrame symbol/wordmark is engraved **only on the wearer's left
  temple**, 21.54 × 2.6 mm, 0.4 mm recess. Right temple is plain. Preview metadata
  `branding.faceIndices` selects recessed floor triangles; silver is illustrative
  infill, while STL is uncoloured. Fine print legibility is unverified.
- Preserve `alignment_source` (`unspecified`, `provider-marked`, `illustrative`)
  and `measurement_source` (`manual`, `browser-iris-estimate`,
  `arkit-eye-transform-estimate`). Prototype skips must never become verified
  optical alignment or a checked wearer-ready export through a UI change.

## Web/backend/account boundary and current deployment limits

The public Vercel web frontend is live at `https://optiframe.zajalist.com`.
Its GPU `/api/*` calls are external rewrites to the desktop backend through the
current temporary Cloudflare tunnel. Verify deployment/configuration before
testing; the Windows GPU machine must remain awake and available. Do not stop
its supervisor or unrelated Cloudflare services from a Mac migration task.

Browser iPhone camera access does not expose native ARKit/TrueDepth. Android
WebXR/ARCore scene-depth support is not native Augmented Faces or verified pupil
measurement. Keep browser estimates and native estimates labelled by source.

Supabase approval code exists, but project/env/provider activation was **pending
when this handoff was written**. Never present it as activated without checking.
The authoritative `get_my_access` RPC must return approved status. GPU auth
verifies a Bearer token with Supabase `auth/v1/user` then that RPC; approval is
cached for at most 30 seconds. The private test key is an internal fallback,
not a public mobile-app credential. Never embed it, a service-role key, email
provider secret or signing credential in the app or handoff.

Native account login/Bearer refresh integration is not implemented yet. Add it
before distributing authenticated GPU features: use approved project settings,
secure OS credential storage, explicit sign-out/session-expiry handling and the
same server-enforced approval. Do not grant access based on local UI flags or
user-editable metadata. The planned native flow includes email sign-in and
Google OAuth with PKCE, a registered secure callback, state validation, and
explicit cancellation/error handling; preserve drafts when authentication is
cancelled and never ship OAuth client secrets in the app. The owner address
`zejbadr@gmail.com` gains access only through the server's trusted verified-email
check, never an email comparison in native UI. Email notification scheduling/provider configuration is
separate from account approval. See `docs/supabase-accounts.md` and
`docs/account-access-backend.md`.

## Mac build, device install and release

```sh
git clone https://github.com/zajalist/optiframe.git
cd optiframe
git pull --ff-only
xcodebuild -version
brew install xcodegen
cd ios
xcodegen generate
open OptiFrameCapture.xcodeproj
```

From the repository root, reproduce the unsigned simulator gates:

```sh
xcodebuild -project ios/OptiFrameCapture.xcodeproj -scheme OptiFrameCapture \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
xcodebuild -project ios/OptiFrameCapture.xcodeproj -scheme OptiFrameCapture \
  -destination 'platform=iOS Simulator,name=iPhone 16,OS=latest' \
  CODE_SIGNING_ALLOWED=NO test
```

Choose an installed simulator if that destination is unavailable. Keep both iOS
18 compatibility and iOS 26 system-control behavior in the test matrix when
adopting Liquid Glass. Capture screenshots from the actual simulator, including
small phone, large text, permission error, review and sheet states.

For a physical phone, the user must select their development team/signing in
Xcode, connect/trust the device and enable Developer Mode as required. No team,
signing identity, device registration or distribution credentials are supplied
here. Do not invent them or alter a different app's provisioning.

TestFlight additionally needs the user's Apple Developer/App Store Connect
setup, a matching registered app/bundle ID, version/build numbers, signed archive,
upload/processing, appropriate privacy/permission declarations and tester access.
Use Xcode Organizer after those prerequisites exist. An unsigned Simulator app
cannot be installed on the user's iPhone. Do not call the product released until
a signed install and actual device smoke test succeed.

## Acceptance checklist for the Mac agents

### Web lens adjustment contract to preserve in native UI

The web fitting flow now has optional lens controls backed by
`web/lens-adjustments.js` and `web/app.js`: rotation, horizontal mirroring,
left/right assignment and reset. State is source-capture keyed:
`{swapped:false,left:{rotation:0,mirror:false},right:{rotation:0,mirror:false}}`.
The `left` and `right` adjustment entries remain attached to the original
captures even after assignment changes. Swapping carries the source contour
and edge thickness; wearer pupil distances and vertical offsets stay on their
respective wearer sides.

These are rigid edits around the optical origin of the normalized millimetre
contour, with no scale change. The input contour is image-Y-down; mirror X first,
then rotate (`x'=cos*x+sin*y`, `y'=-sin*x+cos*y`). Positive rotation is
counterclockwise in that image. CAD applies its existing Y reflection once.
Reflection reverses vertex order to preserve polygon winding. Source photos,
calibration, contour points and optical marks remain intact. Reset restores the
original transform. Any nonidentity edit marks alignment illustrative and
blocks checked export; preview and the unverified prototype kit remain available.
Manual rotation or mirroring does not certify prescription axis or optical fit.

Session restoration requires the exact two source capture UUIDs, in order.
Replacing either capture resets the edits. Changing or resetting controls also
invalidates outstanding frame requests and their export/preview result. Native
agents should retain these semantics rather than treating display-only changes
as verified physical alignment.

### Device and release checks

1. Current build + all 20 existing tests pass; new tests target changed behavior.
2. UIKit wizard primary actions are reachable on a normal small-phone viewport;
   keyboard and large Dynamic Type do not hide controls. VoiceOver labels/order,
   Reduce Motion/Transparency and system sheet dismissals work.
3. Real camera permission allowed/denied, interrupted, background/foreground,
   thermal pause and retry cannot revive stale sessions or lose accepted data.
4. On a TrueDepth iPhone, fresh absolute-depth samples are actually received,
   draft review requires confirmation, and JSON preserves provenance. On a
   non-TrueDepth device, measurement mode is unavailable with a usable fallback.
5. Validate repeatability and independent ruler/caliper/reference measurements
   over several captures. Report measured errors, lighting/setup and rejected
   cases; a smooth contour is not evidence of dimensional accuracy. A clinical
   optical reference is required before claiming PD accuracy.
6. Lens outlines remain independent/asymmetric; shadows/reflections cannot
   silently become accepted edges. Inspect source and rectified views together.
7. Actual imported frame scale/orientation/occlusion and left-only logo are
   correct while turning the head. Try-on remains a visual estimate.
8. Both screw and snap outputs retain provenance and closed geometry. Physical
   assembly, retention, comfort and fine engraving are independently checked.
9. Approved account succeeds; pending/rejected/expired/offline states fail
   gracefully. No private key or service credential appears in a release build.
10. Deliver exact commit, Xcode/SDK/device versions, test output, actual UI
    screenshots, signed-install status and remaining limitations. Do not report
    planned UIKit work, simulator camera blanks or mocked measurements as a
    completed physical-device demonstration.
