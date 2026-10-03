import { createAutoCaptureGate } from './auto-capture.js?v=18';
import { createCaptureGuidance, frameBrightness, optimizeCameraTrack } from './capture-guidance.js?v=18';
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
  let capturePending = false;
  let boxVersion = 0;
  let animation = null;
  let trackingBase = null;
  let lastTrackAt = 0;
  let legacyApi = false;
  let startupAbort = null;
  let manualTarget = false;
  let lastLocateAt = -Infinity;
  let frameId = 0;
  const autoGate = createAutoCaptureGate();
  const guidance = createCaptureGuidance();
  let autoState = 'searching';
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
    const factor = Math.min(1, MAX_SIDE / Math.max(width, height));
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
    context.beginPath();
    latest.contour.forEach(([x, y], index) => {
      const px = (x + (latest.offset?.[0] || 0)) * overlay.width / latest.width;
      const py = (y + (latest.offset?.[1] || 0)) * overlay.height / latest.height;
      if (index) context.lineTo(px, py);
      else context.moveTo(px, py);
    });
    context.closePath();
    context.strokeStyle = '#58c9ff';
    context.lineWidth = 3;
    context.stroke();
  }
  function setBoxNormalized(value) {
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
    if (!stream) return;
    autoGate.invalidate();
    target = pointer(event);
    overlay.setPointerCapture?.(event.pointerId);
    draw();
  });
  overlay.addEventListener('pointermove', event => {
    if (!stream || !target) return;
    target = pointer(event);
    draw();
  });
  overlay.addEventListener('pointerup', event => {
    if (!stream || !target) return;
    const [tapX, tapY] = pointer(event);
    target = null;
    const halfWidth = 0.2;
    const halfHeight = 0.18;
    const x = clamp(tapX, halfWidth, 1 - halfWidth);
    const y = clamp(tapY, halfHeight, 1 - halfHeight);
    setBoxNormalized([x - halfWidth, y - halfHeight, x + halfWidth, y + halfHeight]);
  });
  overlay.addEventListener('pointercancel', () => { target = null; draw(); });

  function grayFrame(source) {
    if (!trackingContext) return null;
    const width = 160;
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
  function trackOnce() {
    if (!stream) return;
    animation = requestAnimationFrame(trackOnce);
    if (!trackingBase || !latest || !video.videoWidth) return;
    if (performance.now() - lastTrackAt < 90) return;
    lastTrackAt = performance.now();
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
      for (let dy = -8; dy <= 8; dy += 2) {
        for (let dx = -8; dx <= 8; dx += 2) {
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
  async function canvasBlob(canvas) {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86));
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
      const blob = await canvasBlob(frame);
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
        clearResult(true);
        const decision = autoGate.update({ presence: data.presence, quality: data.quality, brightness, calibration, sampledAt: startedAt,
          now: performance.now(), id: sampledId, dragging: Boolean(target) });
        autoState = decision.state;
        const advice = guidance.update({ calibration, width, height, quality: data.quality, presence: data.presence,
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
      latest = { ...data, offset: [0, 0] };
      try { trackingBase = grayFrame(frame); } catch { trackingBase = null; }
      if (autoCapture || !best || updatedAt - best.sampledAt > maxResultAgeMs / 2 || data.quality.score >= best.quality.score) {
        best = { blob, contour: data.contour.map(point => [...point]),
          width, height, quality: data.quality, capturedAt, latencyMs, sampledAt: startedAt,
          markers: calibration?.markers?.map(point => [...point]) };
        captureButton.disabled = false;
      }
      clearTimeout(resultExpiry);
      resultExpiry = setTimeout(() => {
        if (token !== generation) return;
        clearResult();
        message('Connection interrupted. Retrying…');
      }, Math.max(0, maxResultAgeMs - (updatedAt - startedAt)));
      draw();
      if (autoCapture) {
        const advice = guidance.update({ calibration, width, height, quality: data.quality, presence: data.presence,
          brightness, latencyMs, now: updatedAt, state: autoState });
        const decision = autoGate.update({ ...data, quality: advice.ready ? data.quality : null, calibration, sampledAt: startedAt,
          now: updatedAt, id: sampledId, dragging: Boolean(target) });
        autoState = decision.state;
        message(decision.state === 'remove' ? 'Remove the first lens' : advice.message);
        if (decision.capture) await capture(best, true);
      } else message('Lens found. Hold steady and capture.', true);
    } catch (error) {
      if (token === generation && error.name !== 'AbortError') {
        clearResult();
        message(`No lens edge yet. ${error.message}`);
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

  async function start({ requireRemoval = false } = {}) {
    stop();
    autoGate.reset({ requireRemoval });
    autoState = requireRemoval ? 'remove' : 'searching';
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
        audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
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
    autoGate.reset();
    guidance.reset();
    autoState = 'searching';
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
    capturePending = true;
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
      capturePending = false;
      if (stream && best) captureButton.disabled = false;
    }
  }
  captureButton.addEventListener('click', () => {
    void capture().catch(error => message(error.message));
  });
  captureButton.disabled = true;
  return { start, stop, capture, setBoxNormalized,
    get active() { return !!stream; } };
}
