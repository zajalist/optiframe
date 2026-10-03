/* Standalone WebXR CPU depth experiment. Matrices use WebXR column-major order. */
"use strict";

function multiplyPoint(matrix, point) {
  return [0, 1, 2, 3].map(row => point.reduce((sum, value, col) => sum + matrix[col * 4 + row] * value, 0));
}

function inverseMatrix(matrix) {
  const rows = Array.from({length: 4}, (_, r) => Array.from({length: 8}, (_, c) => c < 4 ? matrix[c * 4 + r] : Number(c - 4 === r)));
  for (let c = 0; c < 4; c++) {
    const pivot = rows.reduce((best, row, r) => r >= c && Math.abs(row[c]) > Math.abs(rows[best][c]) ? r : best, c);
    [rows[c], rows[pivot]] = [rows[pivot], rows[c]];
    const scale = rows[c][c];
    if (Math.abs(scale) < 1e-12) throw new Error("Invalid projection matrix");
    rows[c] = rows[c].map(value => value / scale);
    for (let r = 0; r < 4; r++) if (r !== c) {
      const factor = rows[r][c];
      rows[r] = rows[r].map((value, k) => value - factor * rows[c][k]);
    }
  }
  return Array.from({length: 16}, (_, i) => rows[i % 4][4 + Math.floor(i / 4)]);
}

// Depth is axial camera-plane distance, not Euclidean ray length.
function backProject(u, v, depth, inverseProjection, worldFromView) {
  const ray = multiplyPoint(inverseProjection, [2 * u - 1, 1 - 2 * v, -1, 1]);
  if (!Number.isFinite(depth) || depth <= 0 || Math.abs(ray[2]) < 1e-12) return null;
  const world = multiplyPoint(worldFromView, [-depth * ray[0] / ray[2], -depth * ray[1] / ray[2], -depth, 1]);
  const xyz = world.slice(0, 3).map(value => value / world[3]);
  return xyz.every(Number.isFinite) ? xyz : null;
}

function pointCloudPLY(frames) {
  const points = frames.flatMap(frame => frame.views.flatMap(view => view.samples.filter(sample => sample.point).map(sample => sample.point)));
  return ["ply", "format ascii 1.0", "comment OptiFrame experimental scene depth; units meters; XR local space", `element vertex ${points.length}`, "property float x", "property float y", "property float z", "end_header", ...points.map(point => point.join(" ")), ""].join("\n");
}

// Draw from bounded capture samples without retaining another copy of the cloud.
function drawPointCloud(ctx, canvas, frames, yaw = 0.35, pitch = -0.2) {
  const width = canvas.width, height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#101c24";
  ctx.fillRect(0, 0, width, height);
  const validCount = frames.reduce((n, frame) => n + frame.views.reduce((m, view) => m + view.samples.filter(sample => sample.point?.every(Number.isFinite)).length, 0), 0);
  if (!validCount) return 0;
  const stride = Math.max(1, Math.ceil(validCount / 6000));
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const projected = [];
  let validIndex = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const frame of frames) for (const view of frame.views) for (const sample of view.samples) {
    if (!sample.point || !sample.point.every(Number.isFinite) || validIndex++ % stride) continue;
    const point = sample.point;
    const rx = cy * point[0] + sy * point[2];
    const ry = cp * point[1] - sp * (-sy * point[0] + cy * point[2]);
    projected.push([rx, ry]);
    minX = Math.min(minX, rx); maxX = Math.max(maxX, rx);
    minY = Math.min(minY, ry); maxY = Math.max(maxY, ry);
  }
  const padding = Math.min(12, width / 10, height / 10);
  const scale = Math.min((width - 2 * padding) / Math.max(maxX - minX, 0.05), (height - 2 * padding) / Math.max(maxY - minY, 0.05));
  const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2;
  ctx.fillStyle = "#91e4fa";
  for (const [rx, ry] of projected) {
    ctx.fillRect(Math.round(width / 2 + (rx - centerX) * scale), Math.round(height / 2 - (ry - centerY) * scale), 2, 2);
  }
  return projected.length;
}

if (typeof module !== "undefined" && module.exports) module.exports = {multiplyPoint, inverseMatrix, backProject, pointCloudPLY, drawPointCloud};

if (typeof document !== "undefined") {
  const $ = id => document.getElementById(id);
  const status = message => { $("status").textContent = message; };
  const ctx = $("depth-preview").getContext("2d");
  const cloudCanvas = $("cloud-preview"), cloudCtx = cloudCanvas.getContext("2d");
  let yaw = 0.35, pitch = -0.2, dragging = null;
  let session = null, capture = null, gl = null, space = null, lastSample = -Infinity, startTime = null;
  let timeout = null, ending = false, settingUp = false, framePending = false, samplingFrozen = false;
  const diagnostics = () => { $("diagnostics").textContent = JSON.stringify({secureContext: isSecureContext, userAgent: navigator.userAgent, depthUsage: capture?.depthUsage, depthDataFormat: capture?.depthDataFormat, frames: capture?.frames.length || 0, sampledPoints: capture?.sampledPoints || 0, rawDepthEntries: capture?.rawDepthEntries || 0, missingDepthFrames: capture?.missingDepthFrames || 0, trackingLostFrames: capture?.trackingLostFrames || 0, referenceSpaceResets: capture?.referenceSpaceResets || 0, stopReason: capture?.stopReason, lastError: capture?.lastError}, null, 2); };
  const exportButtons = () => { $("json").disabled = !capture?.frames.length || !!session; $("ply").disabled = $("json").disabled || !capture?.sampledPoints; };
  const renderCloud = () => drawPointCloud(cloudCtx, cloudCanvas, capture?.frames || [], yaw, pitch);
  cloudCanvas.addEventListener("pointerdown", event => { dragging = {x: event.clientX, y: event.clientY}; cloudCanvas.setPointerCapture?.(event.pointerId); });
  cloudCanvas.addEventListener("pointermove", event => {
    if (!dragging) return;
    yaw += (event.clientX - dragging.x) * 0.01;
    pitch = Math.max(-1.5, Math.min(1.5, pitch + (event.clientY - dragging.y) * 0.01));
    dragging = {x: event.clientX, y: event.clientY}; renderCloud();
  });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) cloudCanvas.addEventListener(type, () => { dragging = null; });
  renderCloud();

  async function stop(message) {
    if (ending) return;
    ending = true;
    if (capture) capture.stopReason = message || "Capture stopped during setup.";
    if (message) status(message);
    try { await session?.end(); } catch (error) {
      if (capture) capture.lastError = `Could not end AR: ${error.message}`;
      status(`Could not end AR: ${error.message}. Use the browser's AR exit control.`);
    } finally {
      ending = false;
      if (session && capture && !framePending) scheduleFrame();
      diagnostics();
    }
  }

  function scheduleFrame() {
    if (!session || framePending) return;
    framePending = true;
    session.requestAnimationFrame(onFrame);
  }

  function drawSamples(samples) {
    const image = ctx.createImageData(32, 24);
    samples.forEach((sample, i) => {
      const value = sample.depthMeters ? Math.round(255 * Math.max(0, 1 - sample.depthMeters / 5)) : 0;
      image.data.set([value, value, value, 255], i * 4);
    });
    ctx.putImageData(image, 0, 0);
  }

  function onFrame(time, frame) {
    framePending = false;
    if (!session || ending) return;
    scheduleFrame();
    gl.bindFramebuffer(gl.FRAMEBUFFER, session.renderState.baseLayer.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (samplingFrozen) return;
    if (time - lastSample < 250) return;
    lastSample = time;
    try {
      const pose = frame.getViewerPose(space);
      if (!pose) { capture.trackingLostFrames++; status("Tracking unavailable. Move slowly toward the patterned board."); diagnostics(); return; }
      const views = [];
      for (const view of pose.views) {
        const depth = frame.getDepthInformation(view);
        if (!depth) continue;
        const inverseProjection = inverseMatrix(view.projectionMatrix);
        const worldFromView = Array.from(view.transform.matrix);
        const samples = [];
        for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) {
          const u = (x + .5) / 32, v = (y + .5) / 24;
          const meters = depth.getDepthInMeters(u, v); // API applies depth-buffer UV transform.
          const valid = Number.isFinite(meters) && meters > 0 && meters <= 5;
          samples.push({u, v, depthMeters: valid ? meters : null, point: valid ? backProject(u, v, meters, inverseProjection, worldFromView) : null});
        }
        // Copy everything during the active XR frame; API objects expire afterwards.
        const raw = session.depthDataFormat === "float32" ? new Float32Array(depth.data) : new Uint16Array(depth.data);
        if (capture.rawDepthEntries + raw.length > 4000000) {
          void stop("Depth memory limit reached. Download the captured frames.");
          return;
        }
        capture.rawDepthEntries += raw.length;
        views.push({eye: view.eye, projectionMatrix: Array.from(view.projectionMatrix), worldFromView, width: depth.width, height: depth.height, rawValueToMeters: depth.rawValueToMeters, normDepthBufferFromNormView: Array.from(depth.normDepthBufferFromNormView.matrix), rawDepth: Array.from(raw, value => Number.isFinite(value) ? value : null), samples});
        drawSamples(samples);
      }
      if (!views.length) { capture.missingDepthFrames++; $("coverage").textContent = "No depth in latest frame"; status("No depth yet. Move slowly; try an opaque object first."); }
      else {
        capture.frames.push({timestampMs: time - startTime, worldFromViewer: Array.from(pose.transform.matrix), emulatedPosition: pose.emulatedPosition, views});
        const valid = views.reduce((sum, view) => sum + view.samples.filter(sample => sample.point).length, 0);
        const sampled = views.reduce((sum, view) => sum + view.samples.length, 0);
        capture.sampledPoints += valid;
        $("coverage").textContent = `${Math.min(15, Math.floor((time - startTime) / 1000))}/15 s · ${capture.frames.length}/60 frames · ${capture.sampledPoints.toLocaleString()} points · ${Math.round(valid / sampled * 100)}% valid depth in latest frame`;
        renderCloud();
        status(`${capture.frames.length}/60 depth frames · ${valid} valid samples in latest frame. Move slowly around the fixed stand.`);
      }
      diagnostics();
      if (capture.frames.length >= 60) void stop("Capture complete. Download JSON and PLY.");
    } catch (error) {
      capture.lastError = `${error.name}: ${error.message}`;
      diagnostics();
      void stop(`Depth capture failed: ${error.message}. Download any captured frames or use photo capture.`);
    }
  }

  $("start").addEventListener("click", async () => {
    if (session || settingUp) return;
    settingUp = true;
    $("start").disabled = true;
    let activeSession = null, activeGL = null, sessionEnded = false;
    const stillActive = () => !sessionEnded && session === activeSession;
    const releaseGL = () => {
      if (!activeGL) return;
      activeGL.getExtension("WEBGL_lose_context")?.loseContext();
      if (gl === activeGL) gl = null;
      activeGL = null;
    };
    try {
      session = await navigator.xr.requestSession("immersive-ar", {requiredFeatures: ["depth-sensing", "dom-overlay"], domOverlay: {root: $("overlay")}, depthSensing: {usagePreference: ["cpu-optimized"], dataFormatPreference: ["luminance-alpha", "float32"]}});
      activeSession = session;
      capture = null;
      samplingFrozen = false;
      $("coverage").textContent = "Waiting for depth frames";
      renderCloud(); exportButtons(); diagnostics();
      session.addEventListener("end", () => {
        sessionEnded = true;
        framePending = false;
        if (capture && !capture.stopReason) capture.stopReason = "AR session ended by the browser or device.";
        releaseGL();
        clearTimeout(timeout); session = null; $("stop").disabled = true; $("start").disabled = settingUp;
        $("start").textContent = "Start new 15-second scan";
        exportButtons(); diagnostics(); renderCloud();
        if (capture?.frames.length && !capture.sampledPoints) status("Depth captured but no valid 3D points. Download JSON diagnostics; try an opaque object for a point cloud.");
        else if (capture?.stopReason) status(capture.stopReason);
        else if (!capture?.frames.length) status("Session ended without depth frames. Try an opaque object or continue with photos.");
        else status(`Capture ended: ${capture.frames.length} depth frames. Download both files before starting again.${capture.lastError ? ` Error: ${capture.lastError}` : ""}`);
      }, {once: true});
      if (session.depthUsage !== "cpu-optimized" || !["luminance-alpha", "float32"].includes(session.depthDataFormat)) throw new Error("This device did not provide a supported CPU depth format");
      const canvas = document.createElement("canvas");
      gl = canvas.getContext("webgl", {xrCompatible: true, alpha: true});
      activeGL = gl;
      if (!gl) throw new Error("WebGL is unavailable");
      await gl.makeXRCompatible();
      if (!stillActive()) { releaseGL(); return; }
      session.updateRenderState({baseLayer: new XRWebGLLayer(session, gl)});
      space = await session.requestReferenceSpace("local");
      if (!stillActive()) return;
      capture = {schema: "optiframe-webxr-depth-v1", createdAt: new Date().toISOString(), userAgent: navigator.userAgent, units: "meters", coordinateFrame: "WebXR local; right-handed; Y up; camera looks down -Z; column-major matrices", warning: "Experimental scene points; transparent lenses may return background. No lens measurement, board alignment, fusion, confidence or RGB capture.", depthUsage: session.depthUsage, depthDataFormat: session.depthDataFormat, sampleGrid: [32, 24], maxDepthMeters: 5, sampledPoints: 0, rawDepthEntries: 0, missingDepthFrames: 0, trackingLostFrames: 0, referenceSpaceResets: 0, frames: []};
      space.addEventListener("reset", () => { samplingFrozen = true; capture.referenceSpaceResets++; capture.lastError = "XR local reference space reset; capture stopped to prevent mixing coordinate frames"; void stop(capture.lastError); });
      startTime = performance.now(); lastSample = -Infinity;
      $("stop").disabled = false; exportButtons(); diagnostics();
      status("AR started. Move slowly. Capture ends automatically after 15 seconds.");
      timeout = setTimeout(() => void stop("15 seconds complete. Download JSON and PLY."), 15000);
      scheduleFrame();
    } catch (error) {
      if (sessionEnded) return;
      const message = `AR depth unavailable: ${error.name}: ${error.message}. Use Android Chrome, enable Google Play Services for AR, or continue with photos.`;
      await stop(); status(message); $("start").disabled = false; $("start").textContent = "Retry AR depth";
    } finally {
      settingUp = false;
      $("start").disabled = !!session;
      if (!session) releaseGL();
    }
  });
  $("stop").addEventListener("click", () => void stop("Capture stopped. Download both files."));
  function download(extension, content, type) {
    const url = URL.createObjectURL(new Blob([content], {type}));
    const link = document.createElement("a"); link.href = url;
    link.download = `optiframe-android-${capture.createdAt.replace(/[:.]/g, "-")}.${extension}`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  $("json").addEventListener("click", () => download("json", JSON.stringify(capture), "application/json"));
  $("ply").addEventListener("click", () => download("ply", pointCloudPLY(capture.frames), "text/plain"));

  (async () => {
    diagnostics();
    try {
      if (!isSecureContext) throw new Error("HTTPS or forwarded localhost is required; a plain HTTP LAN address cannot use AR");
      if (!navigator.xr || !await navigator.xr.isSessionSupported("immersive-ar")) throw new Error("Immersive AR is unavailable in this browser/device");
      $("start").disabled = false; $("start").textContent = "Start 15-second AR scan";
      status("Immersive AR supported. Start to check CPU depth availability and grant camera access.");
    } catch (error) { $("start").textContent = "AR unavailable"; status(`${error.message}. Continue with photo capture using the link above.`); }
  })();
}
if (typeof document !== 'undefined') {
  for (const link of document.querySelectorAll('a[href="/"]')) {
    if (location.hash) link.hash = location.hash;
  }
}
