import { createAutoCaptureGate } from './auto-capture.js?v=23';
import { createCaptureGuidance, frameBrightness, optimizeCameraTrack } from './capture-guidance.js?v=23';
import { captureSharpFrame } from './sharp-frame.js?v=22';
import { fuseContours } from './contour-fusion.js?v=22';
import { sheetHomography, project, unproject } from './calibration.js?v=22';
import { createViewSweep, countDistinctViews } from './view-sweep.js?v=24';
// Live camera proposals are only inputs to the existing photo review flow.
const MAX_SIDE = 1280;
const INTERVAL_MS = 50;
const STARTUP_TIMEOUT_MS = 12000;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const centerBox = [0.3, 0.32, 0.7, 0.68];

function boundedStartup(operation, timeoutMs, signal, timeoutMessage, onLateResult = () => {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      callback(value);
      return true;
    };
    const cancel = () => finish(reject, new DOMException('Camera start cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(reject, new Error(timeoutMessage)), timeoutMs);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    Promise.resolve(operation).then(value => {
      if (!finish(resolve, value)) onLateResult(value);
    }, error => { finish(reject, error); });
  });
}

export function createLiveSegmentSession({
  video, overlay, status, captureButton, onCapture, apiFetch = fetch, side = 'lens',
  mediaDevices = navigator.mediaDevices, intervalMs = INTERVAL_MS,
  startupTimeoutMs = STARTUP_TIMEOUT_MS,
  requestTimeoutMs = 8000, maxResultAgeMs = 2000,
  locateTarget = null, minimalStatus = false,
  autoCapture = false, calibrateFrame = null,
  stillCapture = true, captureFrame = captureSharpFrame, viewSweep = false,
  onRemovalChange = () => {},
}) {
  if (!video || !overlay || !status || !captureButton || typeof onCapture !== 'function')
    throw new TypeError('Live segmentation needs video, overlay, status, captureButton and onCapture');

  const context = overlay.getContext('2d');
  let stream = null;
  let timer = null;
  let request = null;
  let generation = 0;
  let box = [...centerBox];
  let target = null;
  let latest = null;
  let best = null;
  let previousUpdateAt = null;
  let cadenceHz = null;
  let working = null;
  let resultExpiry = null;
  let capturePending = null;
  let boxVersion = 0;
  let animation = null;
  let trackingBase = null;
  let lastTrackAt = 0;
  let legacyApi = false;
  let startupAbort = null;
  let manualTarget = false;
  let lastLocateAt = -Infinity;
  let frameId = 0;
  let refinementRetryAt = 0, refinementHint = '';
  const sweepMode = autoCapture && viewSweep;
  const sweep = createViewSweep();
  const sharpStill = autoCapture && stillCapture && !sweepMode;
  // Preview agreement only triggers a new still; it is never exported as measurement evidence.
  const autoGate = createAutoCaptureGate({ maxAgeMs: maxResultAgeMs,
    ...(sweepMode ? {durationMs:0,minFrames:1} : sharpStill ? {durationMs: 350, minFrames: 2, toleranceMm: 1.5} : {}) });
  const guidance = createCaptureGuidance();
  let autoState = 'searching';
  function setAutoState(next) {
    const changed = (autoState === 'remove') !== (next === 'remove');
    autoState = next;
    if (changed) onRemovalChange(next === 'remove');
  }
  const trackingCanvas = document.createElement('canvas');
  const trackingContext = trackingCanvas.getContext('2d', { willReadFrequently: true });

  function message(value, routine = false) { status.textContent = minimalStatus && routine ? '' : value; }
  function clearResult(preserveGate = false) {
    if (!preserveGate) autoGate.invalidate();
    clearTimeout(resultExpiry);
    resultExpiry = null;
    latest = null;
    best = null;
    trackingBase = null;
    captureButton.disabled = true;
    draw();
  }
  function dimensions() {
    const width = video.videoWidth;
    const height = video.videoHeight;
    const factor = Math.min(1, (sweepMode ? 1600 : sharpStill ? 960 : MAX_SIDE) / Math.max(width, height));
    return [Math.max(1, Math.round(width * factor)), Math.max(1, Math.round(height * factor))];
  }
  function draw() {
    if (!overlay.width || !overlay.height) return;
    context.clearRect(0, 0, overlay.width, overlay.height);
    if (target) {
      const x = target[0] * overlay.width;
      const y = target[1] * overlay.height;
      context.save();
      context.beginPath();
      context.arc(x, y, 16, 0, Math.PI * 2);
      context.fillStyle = '#102031cc';
      context.fill();
      context.strokeStyle = '#e7eef8';
      context.lineWidth = 2;
      context.stroke();
      context.beginPath();
      context.moveTo(x - 8, y);
      context.lineTo(x + 8, y);
      context.moveTo(x, y - 8);
      context.lineTo(x, y + 8);
      context.stroke();
      context.restore();
    }
    if (!latest?.contour?.length) return;
    // Automatic overlays follow the current sheet plane, never an old camera
    // pose. The original SAM contour remains untouched for measurement.
    if (autoCapture && !latest.displayContour?.length) return;
    context.beginPath();
    (autoCapture ? latest.displayContour : latest.contour).forEach(([x, y], index) => {
      const px = autoCapture ? x : (x + (latest.offset?.[0] || 0)) * overlay.width / latest.width;
      const py = autoCapture ? y : (y + (latest.offset?.[1] || 0)) * overlay.height / latest.height;
      if (index) context.lineTo(px, py);
      else context.moveTo(px, py);
    });
    context.closePath();
    context.strokeStyle = '#58c9ff';
    context.lineWidth = 3;
    context.stroke();
  }
  function setBoxNormalized(value) {
    if (capturePending) return;
    if (!Array.isArray(value) || value.length !== 4 || value.some(v => !Number.isFinite(v)))
      throw new TypeError('Box must contain four finite normalized coordinates');
    const [x0, y0, x1, y1] = value;
    if (!(0 <= x0 && x0 < x1 && x1 <= 1 && 0 <= y0 && y0 < y1 && y1 <= 1 &&
          x1 - x0 >= 0.03 && y1 - y0 >= 0.03))
      throw new RangeError('Box must be inside the preview and at least 3% wide and high');
    box = [...value];
    manualTarget = true;
    autoGate.invalidate();
    boxVersion++;
    request?.abort();
    trackingBase = null;
    latest = null;
    best = null;
    captureButton.disabled = true;
    draw();
    message('Tracking the lens you tapped. Hold steady.', true);
  }
  function pointer(event) {
    const rect = overlay.getBoundingClientRect();
    const fingerOffset = event.pointerType === 'touch' ? 64 : 0;
    return [clamp((event.clientX - rect.left) / rect.width, 0, 1),
      clamp((event.clientY - rect.top - fingerOffset) / rect.height, 0, 1)];
  }
  overlay.addEventListener('pointerdown', event => {
    if (!stream || capturePending) return;
    autoGate.invalidate();
    target = pointer(event);
    overlay.setPointerCapture?.(event.pointerId);
    draw();
  });
  overlay.addEventListener('pointermove', event => {
    if (!stream || !target || capturePending) return;
    target = pointer(event);
    draw();
  });
  overlay.addEventListener('pointerup', event => {
    if (!stream || !target || capturePending) return;
    const [tapX, tapY] = pointer(event);
    target = null;
    const halfWidth = 0.2;
    const halfHeight = 0.18;
    const x = clamp(tapX, halfWidth, 1 - halfWidth);
    const y = clamp(tapY, halfHeight, 1 - halfHeight);
    setBoxNormalized([x - halfWidth, y - halfHeight, x + halfWidth, y + halfHeight]);
  });
  overlay.addEventListener('pointercancel', () => { target = null; if (!capturePending) draw(); });

  function grayFrame(source) {
    if (!trackingContext) return null;
    const width = 240;
    const height = Math.max(1, Math.round(width * overlay.height / overlay.width));
    trackingCanvas.width = width;
    trackingCanvas.height = height;
    trackingContext.drawImage(source, 0, 0, width, height);
    const rgba = trackingContext.getImageData(0, 0, width, height).data;
    const gray = new Uint8Array(width * height);
    for (let index = 0; index < gray.length; index++) {
      const pixel = index * 4;
      gray[index] = (rgba[pixel] * 77 + rgba[pixel + 1] * 150 + rgba[pixel + 2] * 29) >> 8;
    }
    return { gray, width, height };
  }
  function trackSheetPlane() {
    if (!latest) return;
    latest.displayContour = null;
    if (!trackingContext || !calibrateFrame || !latest.sheetContour?.length || !video.videoWidth || !video.videoHeight) return;
    try {
      const scale = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
      const width = Math.max(1, Math.round(video.videoWidth * scale));
      const height = Math.max(1, Math.round(video.videoHeight * scale));
      trackingCanvas.width = width; trackingCanvas.height = height;
      trackingContext.drawImage(video, 0, 0, width, height);
      const current = calibrateFrame(trackingContext.getImageData(0, 0, width, height), []);
      if (!Array.isArray(current?.markers) || current.markers.length !== 4) return;
      const homography = sheetHomography(current.markers);
      latest.displayContour = latest.sheetContour.map(point => {
        const [x, y] = unproject(point, homography);
        if (x < 0 || y < 0 || x > width || y > height) throw new Error('Lens outside current view');
        return [x * overlay.width / width, y * overlay.height / height];
      });
    } catch {
      // Missing dots or invalid perspective hide the proposal until the sheet
      // can be located again. Do not fall back to translation or a stale pose.
      latest.displayContour = null;
    }
  }
  function trackOnce() {
    if (!stream || capturePending) return;
    animation = requestAnimationFrame(trackOnce);
    if (!latest || !video.videoWidth || (!autoCapture && !trackingBase)) return;
    if (performance.now() - lastTrackAt < (autoCapture ? 200 : 90)) return;
    lastTrackAt = performance.now();
    if (autoCapture) {
      trackSheetPlane();
      draw();
      return;
    }
    try {
      const current = grayFrame(video);
      if (!current || current.width !== trackingBase.width || current.height !== trackingBase.height) return;
      const { width, height, gray: reference } = trackingBase;
      const x0 = Math.max(9, Math.ceil(box[0] * width));
      const y0 = Math.max(9, Math.ceil(box[1] * height));
      const x1 = Math.min(width - 9, Math.floor(box[2] * width));
      const y1 = Math.min(height - 9, Math.floor(box[3] * height));
      if (x1 - x0 < 16 || y1 - y0 < 16) return;
      let bestDifference = Infinity;
      let bestShift = [0, 0];
      for (let dy = -8; dy <= 8; dy++) {
        for (let dx = -8; dx <= 8; dx++) {
          let difference = 0;
          let count = 0;
          for (let y = y0; y < y1; y += 5) {
            for (let x = x0; x < x1; x += 5) {
              difference += Math.abs(reference[y * width + x] - current.gray[(y + dy) * width + x + dx]);
              count++;
            }
          }
          difference /= count;
          if (difference < bestDifference) { bestDifference = difference; bestShift = [dx, dy]; }
        }
      }
      // Reject changed lighting/scene content instead of letting the outline drift.
      latest.offset = bestDifference < 15
        ? [bestShift[0] * latest.width / width, bestShift[1] * latest.height / height]
        : [0, 0];
      draw();
    } catch {
      trackingBase = null; // Tracking is optional; segmentation remains authoritative.
    }
  }

  function schedule(token) {
    if (token === generation && stream)
      timer = setTimeout(() => { void sample(token); }, intervalMs);
  }
  async function canvasBlob(canvas, quality = .86) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('Could not capture a camera frame');
    return blob;
  }
  function legacyQuality(frame, contour, prompt, clippedFraction) {
    let twiceArea = 0;
    contour.forEach(([x, y], index) => {
      const [nextX, nextY] = contour[(index + 1) % contour.length];
      twiceArea += x * nextY - nextX * y;
    });
    const boxArea = (prompt[2] - prompt[0]) * (prompt[3] - prompt[1]);
    const coverage = Math.abs(twiceArea) / 2 / boxArea;
    let sharpness = 0.5;
    try {
      const { gray, width, height } = grayFrame(frame);
      let gradient = 0;
      let count = 0;
      for (let y = 1; y < height - 1; y += 3) {
        for (let x = 1; x < width - 1; x += 3) {
          const index = y * width + x;
          gradient += Math.abs(gray[index] - gray[index + 1]) +
            Math.abs(gray[index] - gray[index + width]);
          count++;
        }
      }
      sharpness = Math.min(1, gradient / Math.max(1, count) / 28);
    } catch { /* Image quality still has glare and contour coverage. */ }
    const glare = Math.max(0, 1 - Number(clippedFraction || 0) / 0.08);
    const area = coverage > 0.85 ? 0 : Math.min(1, coverage / 0.25);
    return { score: Math.round(sharpness * glare * area * 10_000) / 10_000,
      clippedFraction: Number(clippedFraction || 0), coverage: Math.round(coverage * 10_000) / 10_000 };
  }
  async function segmentFrame(body, signal, frame, prompt) {
    let response = await apiFetch(legacyApi ? '/api/segment' : '/api/live-segment',
      { method: 'POST', body, signal });
    if (!legacyApi && (response.status === 404 || response.status === 405)) {
      legacyApi = true;
      response = await apiFetch('/api/segment', { method: 'POST', body, signal });
    }
    const data = response.headers?.get('content-type')?.includes('json') === false
      ? { detail: await response.text() } : await response.json();
    if (!response.ok) throw new Error(data.detail || 'Live edge proposal failed');
    if (!legacyApi) return data;
    const sam = data.candidates?.find(candidate =>
      candidate.method === 'sam2.1-hiera-small-cuda' && candidate.contour?.length >= 3);
    if (!sam) throw new Error('GPU lens contour unavailable; check the prompt box or GPU service');
    return { width: data.width, height: data.height, contour: sam.contour,
      quality: legacyQuality(frame, sam.contour, prompt, data.clippedFraction),
      method: sam.method };
  }
  async function sample(token) {
    timer = null;
    if (token !== generation || !stream || working || !video.videoWidth) return;
    const job = { abort: new AbortController() };
    working = job;
    request = job.abort;
    try {
      const [width, height] = dimensions();
      const mediaTime = video.currentTime;
      const frame = document.createElement('canvas');
      frame.width = width;
      frame.height = height;
      frame.getContext('2d').drawImage(video, 0, 0, width, height);
      if (locateTarget && !manualTarget && performance.now() - lastLocateAt >= 700) {
        lastLocateAt = performance.now();
        try {
          const found = locateTarget(frame.getContext('2d').getImageData(0, 0, width, height));
          if (Array.isArray(found) && found.length === 4 && found.every(Number.isFinite) &&
              found[0] >= 0 && found[1] >= 0 && found[2] <= 1 && found[3] <= 1 &&
              found[2] - found[0] >= 0.03 && found[3] - found[1] >= 0.03) box = found;
        } catch { /* Manual targeting remains available if sheet detection fails. */ }
      }
      const promptVersion = boxVersion;
      const capturedAt = new Date().toISOString();
      const startedAt = performance.now();
      const blob = await canvasBlob(frame, sweepMode ? .95 : sharpStill ? .78 : .86);
      if (token !== generation || promptVersion !== boxVersion) return;
      const prompt = [Math.floor(box[0] * width), Math.floor(box[1] * height),
        Math.ceil(box[2] * width), Math.ceil(box[3] * height)];
      const body = new FormData();
      body.append('image', blob, `${side}-live.jpg`);
      body.append('box', JSON.stringify(prompt));
      const data = await boundedStartup(segmentFrame(body, job.abort.signal, frame, prompt),
        requestTimeoutMs, job.abort.signal, 'Connection is slow. Retrying…');
      if (token !== generation || promptVersion !== boxVersion) return;
      const sampledId = Number.isFinite(mediaTime) ? mediaTime : ++frameId;
      let calibration = null;
      let brightness = null;
      if (autoCapture && calibrateFrame) {
        try {
          const pixels = frame.getContext('2d').getImageData(0, 0, width, height);
          brightness = frameBrightness(pixels);
          calibration = calibrateFrame(pixels, data.contour || []);
        }
        catch { /* Missing or unstable calibration cannot qualify for capture. */ }
      }
      if (data.presence?.detected === false || (autoCapture && data.presence?.detected !== true)) {
        if (sweepMode) sweep.reset();
        clearResult(true);
        const decision = autoGate.update({ presence: data.presence, quality: data.quality, brightness, calibration, sampledAt: startedAt,
          now: performance.now(), id: sampledId, dragging: Boolean(target) });
        setAutoState(decision.state);
        const advice = guidance.update({ calibration, width, height, minMarkerSpan: sharpStill ? 225 : 300, quality: data.quality, presence: data.presence,
          brightness, latencyMs: performance.now() - startedAt, now: performance.now(), state: autoState });
        message(advice.message);
        return;
      }
      if (data.width !== width || data.height !== height || !Array.isArray(data.contour) || data.contour.length < 3 ||
          !data.contour.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) &&
            point[0] >= 0 && point[0] <= width && point[1] >= 0 && point[1] <= height) ||
          !Number.isFinite(data.quality?.score))
        throw new Error('Live edge response has invalid dimensions or contour');
      const updatedAt = performance.now();
      const latencyMs = Math.round(updatedAt - startedAt);
      if (updatedAt - startedAt > maxResultAgeMs)
        throw new Error('Camera frame arrived too late. Retrying…');
      if (previousUpdateAt !== null) {
        const rate = 1000 / Math.max(1, updatedAt - previousUpdateAt);
        cadenceHz = cadenceHz === null ? rate : cadenceHz * 0.7 + rate * 0.3;
      }
      previousUpdateAt = updatedAt;
      latest = { ...data, offset: [0, 0],
        sheetContour: calibration?.contour?.map(point => [...point]), displayContour: null };
      if (autoCapture) {
        if (sweepMode && updatedAt < refinementRetryAt) { message(refinementHint); return; }
        trackingBase = null;
        trackSheetPlane();
        lastTrackAt = performance.now();
      } else {
        try { trackingBase = grayFrame(frame); } catch { trackingBase = null; }
      }
      if (autoCapture || !best || updatedAt - best.sampledAt > maxResultAgeMs / 2 || data.quality.score >= best.quality.score) {
        best = { blob, contour: data.contour.map(point => [...point]),
          width, height, quality: data.quality, capturedAt, latencyMs, sampledAt: startedAt,
          markers: calibration?.markers?.map(point => [...point]) };
        captureButton.disabled = false;
      }
      clearTimeout(resultExpiry);
      resultExpiry = setTimeout(() => {
        if (token !== generation) return;
        // Expiring the displayed frame must not erase a valid sequence while
        // its next serial inference is still pending. The gate separately
        // rejects stale replies, idle gaps, missing lenses and changed geometry.
        clearResult(autoCapture);
        message(working ? 'Processing…' : 'Connection interrupted. Retrying…');
      }, Math.max(0, maxResultAgeMs - (updatedAt - startedAt)));
      draw();
      if (autoCapture) {
        if (sharpStill && updatedAt < refinementRetryAt) { message(refinementHint); return; }
        const advice = guidance.update({ calibration, width, height, minMarkerSpan: sharpStill ? 225 : 300, quality: data.quality, presence: data.presence,
          brightness, latencyMs, now: updatedAt, state: autoState });
        const decision = autoGate.update({ ...data, quality: advice.ready ? data.quality : null, calibration, sampledAt: startedAt,
          now: updatedAt, id: sampledId, dragging: Boolean(target) });
        setAutoState(decision.state);
        if (sweepMode) {
          if (decision.state==='remove') {sweep.reset();message('Remove the first lens');return;}
          if (!calibration?.markers?.length || decision.reason==='calibration') {
            sweep.reset();message('Show all four dots');return;
          }
          if (decision.capture) autoGate.reset();
          const sweepResult=sweep.update({...data,quality:advice.ready?data.quality:null,
            calibration,blob,width,height,capturedAt,sampledAt:startedAt,id:sampledId,
            dragging:Boolean(target)},updatedAt);
          if (sweepResult.ready) await captureSweep(sweepResult,token,job.abort.signal);
          else if (sweepResult.state==='retry') {
            sweep.reset();refinementRetryAt=updatedAt+1200;
            refinementHint='Move slowly around the lens';message(refinementHint);
          } else message(!advice.ready?advice.message||'Keep all four dots visible':'Move slowly around the lens');
          return;
        }
        const blocker = {stale:'Connection is slow. Retrying…', calibration:'Show all four dots',
          blur:'Let the camera focus', quality:'Edge unclear. Adjust the light', outline:'Keep one lens inside the dots'}[decision.reason];
        message(decision.state === 'remove' ? 'Remove the first lens' : !advice.ready ? advice.message
          : blocker || (decision.state === 'steady' ? 'Lens found' : advice.message));
        if (decision.capture) {
          if (sharpStill) await captureStill(token, job.abort.signal);
          else await capture(best, true);
        }
      } else message('Lens found. Hold steady and capture.', true);
    } catch (error) {
      if (token === generation && error.name !== 'AbortError') {
        if (sweepMode) sweep.reset();
        clearResult();
        message(performance.now()<refinementRetryAt ? refinementHint : `No lens edge yet. ${error.message}`);
      }
    } finally {
      job.abort.abort();
      // A restarted camera owns its new request and schedule independently.
      if (working === job) {
        request = null;
        working = null;
        schedule(token);
      }
    }
  }

  async function captureSweep(result,token,signal) {
    const pending={};capturePending=pending;clearTimeout(resultExpiry);
    try {
      const combined=fuseContours(result.frames.map(frame=>({id:frame.id,contour:frame.calibration.contour})));
      const accepted=result.frames.filter(frame=>combined.diagnostics.acceptedIds.includes(frame.id));
      const acceptedViews=countDistinctViews(accepted);
      if(acceptedViews<3){const error=new Error('Need three agreeing views. Try a smaller arc.');error.code='CONTOUR_FUSION_UNSTABLE';throw error;}
      const reference=accepted.reduce((a,b)=>b.quality.score>a.quality.score ||
        (b.quality.score===a.quality.score&&b.quality.sharpness>a.quality.sharpness)?b:a);
      if(token!==generation||signal.aborted)return;
      const refinement={...combined.diagnostics,inputFrames:result.frames.length,
        captureMode:'view-sweep',viewCount:acceptedViews,observedViews:result.viewCount,collectionMs:result.elapsedMs,
        views:result.frames.map(frame=>({id:frame.id,capturedAt:frame.capturedAt,
          sampledAt:frame.sampledAt,normalizedMarkerQuad:frame.normalizedMarkerQuad,homography:frame.homography})),
        rawContours:result.frames.map(frame=>({id:frame.id,capturedAt:frame.capturedAt,
          contour:(frame.rawContour||frame.contour).map(p=>project(p,frame.homography))})),
        imageRefinedContours:result.frames.map(frame=>({id:frame.id,contour:frame.calibration.contour,diagnostics:frame.edgeRefinement})),
        rawReferenceContour:(reference.rawContour||reference.contour).map(p=>[...p])};
      message('Refining…');
      await onCapture({file:new File([reference.blob],`${side}-sweep.jpg`,{type:'image/jpeg'}),
        contour:combined.contour.map(p=>unproject(p,reference.homography)),width:reference.width,height:reference.height,
        markers:reference.calibration.markers.map(p=>[...p]),refinement,quality:reference.quality,
        capturedAt:reference.capturedAt,latencyMs:performance.now()-Math.min(...result.frames.map(frame=>frame.sampledAt)),source:'view-sweep'});
      if(token===generation)stop();
    } catch(error) {
      if(token===generation&&error.name!=='AbortError') {
        refinementRetryAt=performance.now()+1500;
        refinementHint=error.code==='CONTOUR_FUSION_UNSTABLE'?'Edges disagree. Try a smaller arc.':error.message;
      }
      throw error;
    } finally {
      if(capturePending===pending)capturePending=null;
      if(token===generation){sweep.reset();autoGate.reset();}
    }
  }

  async function captureStill(token, signal) {
    const pending = {};
    capturePending = pending;
    clearTimeout(resultExpiry);
    if (animation !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(animation);
    animation = null;
    target = null;
    message('Capturing…');
    try {
      const selected = await captureFrame(video, {maxSide:1600, box:[...box], signal});
      if (token !== generation || signal.aborted) return;
      const frames=Array.isArray(selected.frames)?selected.frames.slice(0,5):[selected];
      const observations=[], prepared=[], ids=new Set();
      overlay.width=selected.canvas.width; overlay.height=selected.canvas.height;
      context.drawImage(selected.canvas,0,0,overlay.width,overlay.height);
      message('Refining…');
      const started = performance.now();
      const deadline=started+Math.min(requestTimeoutMs,8000);
      for (let index=0;index<frames.length;index++) {
        if(token!==generation || signal.aborted)return;
        const candidate=frames[index], id=candidate.id??candidate.sampledAt??index;
        if(ids.has(id))continue;
        ids.add(id);
        const frame=candidate.canvas, width=frame.width, height=frame.height;
        const pixels=frame.getContext('2d').getImageData(0,0,width,height);
        const found=!manualTarget&&locateTarget?locateTarget(pixels):null;
        const targetBox=Array.isArray(found)&&found.length===4&&found.every(Number.isFinite)?found:box;
        const prompt=[Math.floor(targetBox[0]*width),Math.floor(targetBox[1]*height),Math.ceil(targetBox[2]*width),Math.ceil(targetBox[3]*height)];
        const blob=await canvasBlob(frame,.95);
        if(token!==generation || signal.aborted)return;
        prepared.push({id,candidate,frame,width,height,blob,prompt});
      }
      const remaining=deadline-performance.now();
      if(remaining<=0)throw new Error('Refinement timed out. Retrying…');
      let results;
      if(frames.length>1) {
        const body=new FormData();
        prepared.forEach(item=>body.append('images',item.blob,`${side}-${item.id}.jpg`));
        body.append('boxes',JSON.stringify(prepared.map(item=>item.prompt)));
        const response=await boundedStartup(apiFetch('/api/segment-burst',{method:'POST',body,signal}),remaining,signal,'Refinement timed out. Retrying…');
        const payload=await response.json();
        if(!response.ok)throw new Error(payload.detail||'Could not refine the burst');
        if(!Array.isArray(payload.frames)||payload.frames.length!==prepared.length)throw new Error('Incomplete burst response');
        results=payload.frames;
      } else {
        const item=prepared[0],body=new FormData();body.append('image',item.blob,`${side}-still.jpg`);body.append('box',JSON.stringify(item.prompt));
        results=[await boundedStartup(segmentFrame(body,signal,item.frame,item.prompt),remaining,signal,'Refinement timed out. Retrying…')];
      }
      if(token!==generation || signal.aborted)return;
      for(let index=0;index<prepared.length;index++) {
        const {id,candidate,frame,width,height,blob}=prepared[index], data=results[index];
        if(!data||data.error)continue;
        if(data.width!==width||data.height!==height||!Array.isArray(data.contour)||
            data.contour.some(p=>!Array.isArray(p)||p.length!==2||p.some((v,i)=>!Number.isFinite(v)||v<0||v>(i?height:width))))continue;
        const pixels=frame.getContext('2d').getImageData(0,0,width,height);
        let calibration;
        try {calibration=calibrateFrame?.(pixels,data.contour);} catch {continue;}
        const now=performance.now();
        const advice=createCaptureGuidance().update({...data,calibration,brightness:frameBrightness(pixels),now});
        const checked=createAutoCaptureGate({durationMs:0,minFrames:1}).update({...data,
          quality:advice.ready?data.quality:null,calibration,sampledAt:now,now,id});
        if(!checked.capture)continue;
        observations.push({id,contour:calibration.contour,calibration,data,blob,candidate,width,height});
      }
      let reference=observations[0], refined, refinement;
      if(frames.length>1) {
        const combined=fuseContours(observations);
        reference=observations.find(item=>combined.diagnostics.acceptedIds.includes(item.id));
        const h=sheetHomography(reference.calibration.markers);
        refined=combined.contour.map(p=>unproject(p,h));
        refinement={...combined.diagnostics,inputFrames:frames.length,
          rejectedFrames:frames.length-combined.diagnostics.acceptedFrames,
          rejectedIds:frames.map((frame,index)=>frame.id??frame.sampledAt??index).filter(id=>!combined.diagnostics.acceptedIds.includes(id)),
          rawContours:observations.map(item=>({id:item.id,capturedAt:item.candidate.capturedAt,
            contour:item.data.rawContour ? item.data.rawContour.map(p=>project(p,sheetHomography(item.calibration.markers))) : item.contour})),
          imageRefinedContours:observations.map(item=>({id:item.id,contour:item.contour,diagnostics:item.data.edgeRefinement})),
          rawReferenceContour:(reference.data.rawContour||reference.data.contour).map(p=>[...p])};
      } else if(!reference)throw new Error('Still edge unclear. Adjust the light');
      const {blob,width,height,calibration,data,candidate}=reference;
      await onCapture({file:new File([blob],`${side}-still.jpg`,{type:'image/jpeg'}),
        contour:refined||data.contour.map(p=>[...p]),width,height,markers:calibration.markers.map(p=>[...p]),refinement,
        quality:data.quality,capturedAt:candidate.capturedAt,latencyMs:performance.now()-started,source:refinement?'multi-frame':'sharp-still'});
      if (token===generation) stop();
    } catch(error) {
      if(token===generation && error.name!=='AbortError') {
        refinementRetryAt=performance.now()+2200;
        refinementHint=error.code==='CONTOUR_FUSION_UNSTABLE' ? 'Edge unclear. Use softer light.' : error.message;
      }
      throw error;
    } finally {
      if (capturePending===pending) capturePending=null;
      if (token===generation && stream) {
        autoGate.reset();
        [overlay.width,overlay.height]=dimensions();
        if (typeof requestAnimationFrame==='function') animation=requestAnimationFrame(trackOnce);
      }
    }
  }

  async function start({ requireRemoval = false } = {}) {
    stop();
    autoGate.reset({ requireRemoval });
    setAutoState(requireRemoval ? 'remove' : 'searching');
    manualTarget = false;
    lastLocateAt = -Infinity;
    box = [...centerBox];
    const token = generation;
    if (!mediaDevices?.getUserMedia) throw new Error('This browser does not expose a camera. Open in Safari or use a photo.');
    startupAbort = new AbortController();
    const signal = startupAbort.signal;
    message('Opening camera…', true);
    try {
      const acquired = await boundedStartup(mediaDevices.getUserMedia({
        audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: sharpStill || sweepMode ? 1920 : 1280 } },
      }), startupTimeoutMs, signal, 'Camera permission timed out. Open in Safari or use a photo.',
      late => late.getTracks().forEach(track => track.stop()));
      if (token !== generation) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream = acquired;
      void optimizeCameraTrack(acquired.getVideoTracks?.()[0]);
      video.srcObject = stream;
      await boundedStartup(video.play(), startupTimeoutMs, signal,
        'Camera preview timed out. Close other camera apps and try again.');
      if (token !== generation) return;
      if (!video.videoWidth || !video.videoHeight) throw new Error('Camera has no video frames');
      [overlay.width, overlay.height] = dimensions();
      captureButton.disabled = true;
      draw();
      if (typeof requestAnimationFrame === 'function') animation = requestAnimationFrame(trackOnce);
      message('Keep one lens centered. If the edge misses, press and drag the target onto it.', true);
      void sample(token);
    } catch (error) {
      if (token === generation) { stop(); message(`Camera unavailable: ${error.message}`); }
      throw error;
    } finally {
      if (token === generation) startupAbort = null;
    }
  }
  function stop() {
    sweep.reset();
    capturePending = null;
    refinementRetryAt=0; refinementHint='';
    autoGate.reset();
    guidance.reset();
    setAutoState('searching');
    generation++;
    startupAbort?.abort();
    startupAbort = null;
    clearTimeout(timer);
    timer = null;
    request?.abort();
    request = null;
    working = null;
    clearTimeout(resultExpiry);
    resultExpiry = null;
    if (animation !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(animation);
    animation = null;
    trackingBase = null;
    lastTrackAt = 0;
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
    video.pause?.();
    video.srcObject = null;
    latest = null;
    best = null;
    target = null;
    previousUpdateAt = null;
    cadenceHz = null;
    captureButton.disabled = true;
    context.clearRect(0, 0, overlay.width, overlay.height);
  }
  async function capture(selected = best, qualified = false) {
    if (autoCapture && !qualified) throw new Error('Hold steady for automatic capture');
    if (!selected || performance.now() - selected.sampledAt > maxResultAgeMs) {
      clearResult();
      throw new Error('Wait for a fresh lens outline');
    }
    if (capturePending) throw new Error('Capture is already in progress');
    const pending = {};
    capturePending = pending;
    captureButton.disabled = true;
    const token = generation;
    const payload = {
      file: new File([selected.blob], `${side}-live.jpg`, { type: 'image/jpeg' }),
      contour: selected.contour.map(point => [...point]),
      width: selected.width, height: selected.height,
      quality: selected.quality, capturedAt: selected.capturedAt,
      latencyMs: selected.latencyMs, source: 'live-segmentation',
      markers: selected.markers,
    };
    try {
      await onCapture(payload);
      if (token === generation) stop();
      return payload;
    } catch (error) {
      if (token === generation) autoGate.reset();
      throw error;
    } finally {
      if (capturePending===pending) capturePending=null;
      if (token === generation && stream && best) captureButton.disabled = false;
    }
  }
  captureButton.addEventListener('click', () => {
    void capture().catch(error => message(error.message));
  });
  captureButton.disabled = true;
  function confirmLensChanged() {
    if (!stream || !autoCapture || autoState !== 'remove') return false;
    // Explicit user confirmation replaces only the empty-sheet requirement.
    // Discard pending/accumulated observations; new frames still pass all gates.
    boxVersion++;
    request?.abort();
    sweep.reset();
    clearResult();
    autoGate.reset();
    guidance.reset();
    setAutoState('searching');
    message('');
    return true;
  }
  return { start, stop, capture, setBoxNormalized, confirmLensChanged,
    get active() { return !!stream; } };
}
