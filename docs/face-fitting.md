# Face fitting: capabilities and export contract

Reviewed against the official platform documentation on 3 October 2026.

## What is available

| Surface | Available capture | Fitting limitation |
| --- | --- | --- |
| Web on iPhone | Normal camera photos and calibrated lens contours | Browser camera permission does not grant ARKit face anchors or TrueDepth. Enter fitting measurements manually or import the native JSON. |
| Web on compatible Android | ARCore-backed WebXR scene tracking; depth only when the browser/session actually exposes it | WebXR is not the native ARCore Augmented Faces API. Scene depth does not supply pupil positions. Use manual fitting or an explicitly supported native export. |
| Native iPhone app | Optional `ARFaceTrackingConfiguration` with eye transforms, after checking `isSupported` | The export is an eye-origin estimate relative to an AR face midline, not a clinically measured pupil distance. TrueDepth hardware presence is reported separately. |
| Native Android (future integration) | ARCore Augmented Faces supports a front-camera mesh and face-region poses | No Android face-fitting exporter is implemented here. A mesh is not a verified pupil measurement; it must not silently supply prescription alignment. |

Apple documents face tracking on Apple Neural Engine devices from iOS 14, including devices without TrueDepth. Therefore `ARFaceTrackingConfiguration.isSupported` is **not** evidence of infrared depth. The app separately checks for a front `.builtInTrueDepthCamera`. That flag reports hardware availability, not calibration or actual measurement accuracy. [Apple face configuration](https://developer.apple.com/documentation/arkit/arfacetrackingconfiguration)

Apple's eye transforms describe eye position and orientation relative to the face anchor. This implementation uses the local transform origins, without claiming that they are the visible pupil centres, an optical axis intersection, distance PD, or a fitted bridge reference. TrueDepth is promising input; comparative accuracy needs controlled measurements. [Apple left eye transform](https://developer.apple.com/documentation/arkit/arfaceanchor/lefteyetransform)

ARCore Augmented Faces requires a native front-camera session configured with `MESH3D`; it exposes a central pose, region poses and mesh. The browser WebXR API exposes XR sessions and poses, and does not bridge that native face API. The web capability check must not turn `isSessionSupported('immersive-ar')` into a “face measurement supported” result. [Google Android face guide](https://developers.google.com/ar/develop/java/augmented-faces/developer-guide), [WebXR specification](https://www.w3.org/TR/webxr/)

## Native iPhone flow

Open **Face measurements** before starting a lens session. It pauses the rear session, opens a separate front-camera view and checks permission/support. Existing lens frames disable entry: export them and start a new lens first, so two unrelated tracking sessions cannot mix points.

Look straight ahead from 30–65 cm, keep eyes open and relax the face. Do not orbit the phone for this estimate. A short frontal, stable sequence is used because different gaze directions change eye tracking and additional viewpoints alone do not certify pupil positions.

Capture completes automatically after 21 eligible samples spanning at least 1.9 seconds. The result shows the wearer's left and right estimates and offers an explicit JSON share action. No face images or meshes are exported or uploaded. Closing the view restores the lens camera; manual measurements remain available in the web fitting page.

### Gates and resets

- Normal camera tracking, exactly one currently tracked face, and a consistent face anchor identifier.
- Face forward axis within 12° of the face-to-camera direction. This uses camera-relative pose, not display orientation.
- Blink coefficients below 0.15, jaw opening below 0.2, and ambient light estimate at least 150 when available. These are conservative app heuristics, not calibrated illuminance thresholds.
- Eye origins on opposite sides of local `x = 0`; each offset 18–45 mm and total 40–85 mm. Bounds reject implausible output; they do not diagnose the wearer.
- Sampling no faster than approximately 10 Hz, at most 21 samples retained. A gap above 350 ms, lost tracking, missing/new face, interruption or backgrounding clears the window.
- Each side's population standard deviation must be at most 0.4 mm and full spread at most 1.2 mm. The median is exported. Low spread measures **repeatability**, not accuracy or confidence in the true pupil position.
- `ProcessInfo.thermalState` serious/critical pauses this face session and clears partial samples. It resumes after cooling while the view remains active. Browsers do not expose this native thermal signal, and slow web frames alone must not be labelled “overheating.” [Apple thermal state](https://developer.apple.com/documentation/foundation/processinfo/thermalstate-swift.enum)

On devices that support only one simultaneous face, ARKit may not expose another person in view; the app cannot guarantee detecting untracked bystanders. Keep only the intended wearer in view. Light estimation also cannot prove the absence of shadows or reflections.

## JSON contract v1

```json
{
  "schemaVersion": 1,
  "kind": "optiframe-face-fit",
  "units": "mm",
  "source": "arkit-eye-transform-estimate",
  "requiresProviderVerification": true,
  "reference": "ARFaceAnchor local x=0; eye-transform origins, not clinical pupil centres",
  "createdAt": "2026-10-03T20:00:00Z",
  "measurements": {
    "leftMonocularEstimateMm": 31.0,
    "rightMonocularEstimateMm": 34.0,
    "totalEstimateMm": 65.0
  },
  "quality": {
    "sampleCount": 21,
    "durationSeconds": 2.0,
    "leftStdDevMm": 0.1,
    "rightStdDevMm": 0.1,
    "thermalState": "nominal"
  },
  "capability": {
    "faceTrackingSupported": true,
    "trueDepthAvailable": true
  },
  "samples": [{"timestamp": 100.0, "leftMm": 31.0, "rightMm": 34.0}]
}
```

The example values are illustrative; `samples` is shortened here. Actual exports contain the full accepted window. Sample timestamps use ARFrame's monotonic session clock in seconds; `createdAt` is ISO 8601 wall time.

**Laterality:** left means the wearer's anatomical left, from `leftEyeTransform`; right means the wearer's anatomical right. A mirrored preview never swaps the labels. Each value is `abs(eyeTransform.columns.3.x) * 1000`. Their sum is the horizontal separation across ARFaceAnchor local `x = 0`. It is not the Euclidean separation, a nasal-bridge distance or the distance between lens optical centres.

### Web import rules

1. Validate schema/kind/units/source, finite bounded measurements, matching total, sample count, repeatability evidence and the required verification flag. Reject malformed files with a concise recoverable error. Native “supported” does not guarantee a trustworthy file.
2. Show the original provenance and the values as **estimates**. Require explicit review and provider verification before using or replacing manually entered distances. Do not mark a provider check complete from metadata alone.
3. Do not fill lens thickness, optical-centre markings, bridge geometry, vertical fitting height, temple length or prescription from this file; none is measured here.
4. Keep raw lens contour measurements and their scale independent of face estimates. A high quality score for one cannot validate the other.

## Validation status

`ios/OptiFrameCaptureTests/FaceFitMathTests.swift` covers units/laterality, implausible/non-finite values, stable-window duration, jitter, missing/out-of-order samples and frame-rate independence. Six XCTest methods were added. They have **not run in this Windows workspace**: no Swift/Apple SDK toolchain is installed. The native UI has not been device-rendered or signed here.

GitHub macOS run [37161373083](https://github.com/zajalist/optiframe/actions/runs/37161373083) successfully generated the Xcode project, compiled the unsigned simulator app and passed the capture math tests at commit `9ddc101`. This does not establish physical-device face measurement accuracy. Web import compatibility, including the actual 21-sample native contract, also passed the web regression suite.

Before release, generate the Xcode project, compile/run tests on a Mac, then test an iPhone with TrueDepth and a supported model without it. Verify portrait/landscape facing gates, camera denial, missing/multiple faces, left/right labelling, app background, retry, JSON sharing and restoration of the rear session. Exercise thermal handling with Xcode's device condition controls where available. Compare independent repeated captures against provider measurements; report bias and limits of agreement separately from within-capture jitter. Until then, this is an experimental native estimate flow, not validated fitting metrology.
