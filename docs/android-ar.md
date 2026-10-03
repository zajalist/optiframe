# Android AR depth phone test

Open `/android-ar.html` in **Android Chrome** on a depth supported ARCore phone. This is a capture experiment, not a lens measurement feature. No phone has been validated by this implementation yet.

## Get to the page quickly

Use the project's running web service over HTTPS. Alternatively connect an Android phone by USB, enable USB debugging, and forward the existing server port:

```powershell
adb reverse tcp:8765 tcp:8765
```

On the phone open `http://localhost:8765/android-ar.html`. Chrome DevTools port forwarding is another supported option. A plain `http://192.168.…` LAN URL is **not** a secure context for WebXR. Google Play Services for AR must be installed and enabled. Camera permission and CPU depth support are checked when starting; `isSessionSupported` alone cannot prove depth support.

This page also works with a standalone static server for a quick experiment (no GPU service needed):

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory web
```

Photo processing requires the full service described in the README.

## Fifteen-second experiment

1. First scan an opaque object near a patterned board, 0.5–1 m away. Tap **Start 15-second AR scan**, accept camera access and move slowly. The heatmap shows sampled depth: brighter is nearer, black is invalid or outside the 5 m export range. The other canvas shows sampled 3D points and can be dragged to rotate them during or after capture.
2. Capture stops after 15 seconds, 60 successful frames, or four million raw depth entries. The WebXR DOM overlay is required so Stop and progress remain accessible during the immersive session. During AR, the overlay background is transparent and previews are hidden to leave the camera unobstructed; previews and downloads return after exit.
3. After leaving AR, download JSON and PLY separately. PLY is enabled only if depth yielded at least one valid point; JSON remains available for diagnosis. Confirm Chrome saves both nonempty files. Starting again replaces the in-memory capture. Reloading loses unsaved data.
4. Repeat with the upright clear lens and an empty stand. Keep lens/board fixed during each scan. Record phone model, Android/Chrome versions, frame count, valid samples, board offset, lighting and caliper dimensions in validation notes.
5. Inspect whether the cloud follows the board instead of the lens. The normal photo flow remains the reference contour and fallback when this test fails.

## Export contract and limits

`optiframe-webxr-depth-v1` JSON contains full raw row-major depth values per captured view, depth width/height, selected format, `rawValueToMeters`, the normalized view-to-depth-buffer transform, projection matrix, view-to-local matrix, viewer-to-local matrix, timestamps relative to session setup, tracking diagnostics, and a 32 × 24 grid of sampled view UVs with metric depth and local XYZ. Invalid samples are `null`. Raw float NaNs/infinities are encoded as `null`; zero depth remains zero. For luminance-alpha raw values are unsigned 16-bit entries. Multiply raw values by `rawValueToMeters` to obtain metres.

Sampling uses `getDepthInMeters(u,v)` so the runtime applies depth orientation/UV mapping. Back-projection inverts the view projection, treats depth as axial distance from the camera plane, then transforms by the view pose. Units are **metres**, axes are WebXR local (Y up, camera forward -Z). Projection and pose matrices are column-major. The XR origin is arbitrary and different on each scan. A reference-space reset stops capture to avoid combining different origins. Frames with an emulated position are skipped and counted separately, because rotation-only tracking must not supply invented translation to fusion.

The live preview and PLY now use incremental voxel fusion of valid 0–5 m samples. Each 10 mm scene voxel receives one averaged contribution per captured frame; the running mean gives every frame equal weight. The cloud is capped at 50,000 occupied voxels, and dropped observations are reported. PLY includes an `observations` field counting contributing frames per voxel. JSON retains the original raw depth and every sampled point, plus fusion settings and counts, so this derived cloud can be reproduced. Fusion is computed during the scan; there is no reconstruction wait after capture. The 10 mm voxel is a scene sampling choice, **not a precision claim**. Repeated observations are temporal support, not sensor confidence or independent geometric evidence.

No RGB photos, native raw-depth confidence, fiducial board pose, board registration, lens-volume crop, outlier removal, mesh or accuracy estimate is generated. PLY still represents the scene, including background. The live viewer decimates fused points only for display. Compare raw maps and repeated scans before using any geometry. Transparent lenses can yield board depth or missing depth; averaging cannot recover the missing glass surface. This export is not imported into OptiFrame's frame design and provides no lens dimensions.

## Runnable numerical check

From the repo root, run the following Node check. It checks inverse projection, image Y direction, axial rather than radial depth, pose rotation/translation, rejection of invalid depth and PLY counts. It requires no browser or dependencies.

```powershell
node -e 'const a=require("node:assert/strict"),m=require("./web/android-ar.js"); const p=[1,0,0,0,0,1,0,0,0,0,-1.02,-1,0,0,-.202,0],i=m.inverseMatrix(p),pose=[0,0,-1,0,0,1,0,0,1,0,0,0,1,2,3,1]; function near(actual,expected){actual.forEach((v,k)=>a.ok(Math.abs(v-expected[k])<1e-8));} near(m.backProject(.5,.5,2,i,pose),[-1,2,3]); near(m.backProject(.75,.25,2,i,pose),[-1,3,2]); near(m.multiplyPoint(p,m.multiplyPoint(i,[.5,.25,-1,1])),[.5,.25,-1,1]); a.equal(m.backProject(.5,.5,0,i,pose),null); a.equal(m.backProject(.5,.5,NaN,i,pose),null); const ply=m.pointCloudPLY([{views:[{samples:[{point:[1,2,3]},{point:null}]}]}]); a.ok(ply.includes("element vertex 1")); a.ok(ply.endsWith("1 2 3\n")); console.log("Android depth math/export checks passed");'
node --check web/android-ar.js
```

These checks do not validate physical depth scale or phone WebXR support. Run the opaque-object test against a known size and distance before scanning lenses.

## Real-device field checklist

No ARCore phone has been validated yet. The Node checks use simulated sessions and cannot establish browser support, depth scale, camera behavior or physical accuracy.

- Record the exact phone model, Android build, Chrome version, Google Play Services for AR version, page URL and whether HTTPS or USB localhost forwarding was used. Copy the diagnostics before starting and after each scan; report permission denials and exact error text.
- Start with an opaque object of known dimensions beside the patterned board. Record caliper dimensions, phone-to-object distance, board offset, lighting and a photo of the arrangement. Hold everything fixed except the phone. Run at least three scans before testing the clear lens and empty stand with the same arrangement.
- For every scan, report elapsed time, stop reason, frame count, raw depth entry count, selected depth usage/format, missing depth frames, tracking lost frames, reference-space resets and valid point count. Preserve JSON and PLY together with a scan identifier. Report whether points follow the object, board or neither; report missing depth and drift without interpreting them as lens geometry.
- Exercise manual stop, browser AR exit during startup, leaving/returning to Chrome, tracking loss/recovery and two consecutive scans. Confirm the Start button recovers, no capture continues after exit, diagnostics change during tracking loss and each download contains the intended scan. Where a limit is reached, retain its stop reason from JSON and the page status.
- Confirm downloads are nonempty and readable: JSON raw lengths equal width × height for each view, sample grids contain 768 entries, transforms contain 16 values, and PLY vertex count equals `fusion.points`. Each PLY row contains XYZ and its frame-observation count. Raw non-null samples generally outnumber fused vertices. Compare the opaque object's cloud and known distance before making any depth-scale claim. Record mismatches and attach the original files.

Run the focused numerical and simulated lifecycle suite with `node --test web/android-ar.test.cjs`, then `node --check web/android-ar.js`. The suite covers projection/pose math, invalid depth, PLY counts, session exit during both asynchronous setup stages, context cleanup, tracking diagnostics, memory-limit stop, frame-balanced fusion, voxel limits, emulated tracking rejection, and cloud reset between scans. Passing it does not validate an Android device.

## Desktop processing benchmark (2026-10-03)

A synthetic 60-frame, 768-point-per-frame planar sequence with small deterministic jitter supplied 46,080 samples to `SceneCloud`: 912 fused vertices, 28.7 ms total fusion (0.48 ms per frame), 0.96 ms ASCII PLY serialization, 40,052-byte PLY. These measurements use desktop Node and exclude capture, phone tracking and rendering. They show that the fusion step adds no long reconstruction job; they do not establish phone performance, denoising accuracy or transparent-surface recovery.

## API references

- [Google WebXR requirements and secure port forwarding](https://developers.google.com/ar/develop/webxr/requirements)
- [W3C WebXR Depth Sensing](https://www.w3.org/TR/webxr-depth-sensing-1/)
- [Immersive Web depth API explainer: formats, UV transforms and axial depth](https://github.com/immersive-web/depth-sensing/blob/main/explainer.md)
- [Google ARCore Depth overview](https://developers.google.com/ar/develop/depth)
