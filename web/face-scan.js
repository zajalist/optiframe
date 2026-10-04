import { createFaceEstimator } from './face-estimate.js?v=39';

const VISION_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
let activeClose;

// Bounded async acquisition, with disposal if permission/model resolves after cancellation.
export function faceScanDeadline(promise, ms, signal, message, disposeLate = () => {}) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const clear = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const fail = error => { if (finished) return; finished = true; clear(); reject(error); };
    const abort = () => fail(new DOMException('Scan closed', 'AbortError'));
    const timer = setTimeout(() => fail(new Error(message)), ms);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    Promise.resolve(promise).then(value => {
      if (finished) { disposeLate(value); return; }
      finished = true; clear(); resolve(value);
    }, fail);
  });
}

// runtime is an injectable boundary for camera/model lifecycle tests; production uses local browser APIs.
export function openFaceScan({ onConfirm, onManual }, runtime = {}) {
  activeClose?.();
  const previousFocus = document.activeElement;
  const estimator = (runtime.createEstimator || createFaceEstimator)();
  if (!document.querySelector('link[data-face-scan]')) {
    const css = document.createElement('link'); css.rel = 'stylesheet';
    css.href = '/face-scan.css?v=39'; css.dataset.faceScan = ''; document.head.appendChild(css);
  }
  const dialog = document.createElement('dialog');
  dialog.className = 'face-scan'; dialog.setAttribute('aria-labelledby', 'face-scan-title');
  dialog.innerHTML = `<header class="face-scan-header"><h2 id="face-scan-title">Scan face</h2><button type="button" class="face-scan-close" aria-label="Close face scan">×</button></header>
    <div class="face-scan-live"><video autoplay muted playsinline aria-label="Front camera"></video><canvas aria-hidden="true"></canvas><div class="face-scan-guide" aria-hidden="true"></div></div>
    <section class="face-scan-review" hidden aria-label="Review pupil distances">
      <svg class="face-scan-diagram" viewBox="0 0 320 120" aria-hidden="true"><path d="M160 20v68m-92-28h184"/><circle data-eye="left" cx="85" cy="60" r="12"/><circle data-eye="right" cx="235" cy="60" r="12"/></svg>
      <h3>Review estimates</h3><div class="face-scan-fields"><label>Wearer left<div><input id="face-scan-left" type="number" min="20" max="40" step="0.1" inputmode="decimal" required><span>mm</span></div></label><label>Wearer right<div><input id="face-scan-right" type="number" min="20" max="40" step="0.1" inputmode="decimal" required><span>mm</span></div></label></div>
      <p class="face-scan-total"></p><p class="face-scan-estimate-note">Camera estimate · assumes typical iris size; verify before printing.</p>
    </section>
    <footer class="face-scan-footer"><p class="face-scan-status" role="status">Opening camera…</p><progress max="1" value="0" aria-label="Stable scan progress" hidden></progress><div class="face-scan-actions"><button type="button" class="face-scan-retry" hidden>Retry</button><button type="button" class="face-scan-confirm" hidden>Confirm estimates</button><button type="button" class="face-scan-manual">Enter manually</button></div><p class="face-scan-private">Camera stays on this device</p></footer>`;
  document.body.appendChild(dialog); dialog.showModal();
  const find = selector => dialog.querySelector(selector);
  const video = find('video'), canvas = find('canvas'), context = canvas.getContext('2d');
  const status = find('.face-scan-status'), review = find('.face-scan-review');
  const retry = find('.face-scan-retry'), confirm = find('.face-scan-confirm'), manual = find('.face-scan-manual');
  const leftInput = find('#face-scan-left'), rightInput = find('#face-scan-right'), progress = find('progress');
  let closed = false, phase = 'loading', generation = 0, controller, stream, model, animation = 0;
  const say = text => { if (!closed) status.textContent = text; };
  function release() {
    generation++; controller?.abort(); controller = null;
    cancelAnimationFrame(animation); animation = 0;
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    video.pause(); video.srcObject = null;
    model?.close(); model = null;
  }
  function close() {
    if (closed) return;
    closed = true; release();
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', close);
    window.visualViewport?.removeEventListener('resize', size);
    dialog.close(); dialog.remove();
    if (activeClose === close) activeClose = null;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
  function visibility() { if (document.hidden) close(); }
  function size() { dialog.style.setProperty('--face-scan-height', `${window.visualViewport?.height || window.innerHeight}px`); }
  activeClose = close; size();
  window.visualViewport?.addEventListener('resize', size);
  document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', close);
  find('.face-scan-close').addEventListener('click', close);
  manual.addEventListener('click', () => { if (closed) return; close(); onManual?.(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  const values = () => ({ left: Number(leftInput.value), right: Number(rightInput.value) });
  function updateReview() {
    const { left, right } = values();
    const valid = [left, right].every(number => Number.isFinite(number) && number >= 20 && number <= 40);
    confirm.disabled = !valid;
    find('.face-scan-total').textContent = valid ? `Total ${(left + right).toFixed(1)} mm` : 'Use 20–40 mm for each side';
    if (valid) {
      find('[data-eye="left"]').setAttribute('cx', String(160 - left * 2.5));
      find('[data-eye="right"]').setAttribute('cx', String(160 + right * 2.5));
    }
  }
  leftInput.addEventListener('input', updateReview); rightInput.addEventListener('input', updateReview);
  confirm.addEventListener('click', () => {
    if (phase !== 'review' || confirm.disabled || closed) return;
    updateReview(); if (confirm.disabled) return;
    const result = { ...values(), source: 'browser-iris-estimate' };
    close(); onConfirm?.(result);
  });
  function captured(result) {
    release(); phase = 'review'; dialog.dataset.phase = phase;
    leftInput.value = result.left.toFixed(1); rightInput.value = result.right.toFixed(1);
    review.hidden = false; retry.hidden = false; confirm.hidden = false; manual.hidden = true; progress.hidden = true;
    say(''); updateReview();
  }
  function draw(landmarks) {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    canvas.width = width; canvas.height = height;
    if (!context || !landmarks?.[473] || !landmarks?.[468] || !video.videoWidth || !video.videoHeight) return;
    const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
    const offsetX = (width - video.videoWidth * scale) / 2, offsetY = (height - video.videoHeight * scale) / 2;
    context.strokeStyle = '#fff'; context.lineWidth = 1.5;
    [468, 473].forEach(index => {
      const p = landmarks[index];
      context.beginPath(); context.arc(p.x * video.videoWidth * scale + offsetX, p.y * video.videoHeight * scale + offsetY, 10, 0, Math.PI * 2); context.stroke();
    });
  }
  async function start() {
    release(); estimator.reset();
    phase = 'loading'; dialog.dataset.phase = phase; review.hidden = true; retry.hidden = true; confirm.hidden = true; manual.hidden = false; progress.hidden = true;
    say('Opening camera…'); controller = new AbortController(); const signal = controller.signal, request = generation;
    const current = () => !closed && request === generation && !signal.aborted;
    const bounded = (promise, ms, message, dispose) => faceScanDeadline(promise, ms, signal, message, dispose);
    try {
      const camera = runtime.getUserMedia || (constraints => navigator.mediaDevices.getUserMedia(constraints));
      if (!runtime.getUserMedia && !navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable. Enter measurements manually.');
      const opened = await bounded(camera({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } } }), 20000, 'Camera permission timed out. Try again.', value => value.getTracks().forEach(track => track.stop()));
      if (!current()) { opened.getTracks().forEach(track => track.stop()); return; }
      stream = opened; video.srcObject = stream;
      await bounded(video.play(), 8000, 'Camera preview unavailable. Try again.');
      if (!current()) return;
      say('Loading face tracking…');
      const vision = await bounded((runtime.loadVision || (() => import(`${VISION_ROOT}/vision_bundle.mjs`)))(), 15000, 'Face tracking download timed out.');
      if (!current()) return;
      const files = await bounded(vision.FilesetResolver.forVisionTasks(`${VISION_ROOT}/wasm`), 10000, 'Face tracking could not start.');
      if (!current()) return;
      say('Starting face tracking…');
      const options = { baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 1, minFaceDetectionConfidence: .65, minFacePresenceConfidence: .65, minTrackingConfidence: .65 };
      let loaded;
      try { loaded = await bounded(vision.FaceLandmarker.createFromOptions(files, options), 20000, 'GPU tracking timed out.', value => value.close()); }
      catch (error) {
        if (!current()) return;
        say('Starting compatible tracking…');
        loaded = await bounded(vision.FaceLandmarker.createFromOptions(files, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } }), 20000, 'Face tracking unavailable. Try again.', value => value.close());
      }
      if (!current()) { loaded.close(); return; }
      model = loaded; phase = 'live'; dialog.dataset.phase = phase; say('Look straight at the camera');
      let lastFrame = -1, lastDetection = -Infinity;
      const loop = now => {
        if (!current() || !model) return;
        if (video.readyState >= 2 && video.currentTime !== lastFrame && now - lastDetection >= 90) {
          lastFrame = video.currentTime; lastDetection = now;
          try {
            const landmarks = model.detectForVideo(video, now).faceLandmarks?.[0];
            draw(landmarks);
            const result = estimator.update(landmarks, { width: video.videoWidth, height: video.videoHeight, now, frameId: video.currentTime });
            say(result.message); progress.hidden = result.state !== 'collecting'; progress.value = result.progress || 0;
            if (result.state === 'ready' && result.result) { captured(result.result); return; }
          } catch { fail('Tracking paused. Try again.'); return; }
        }
        if (Number.isFinite(lastDetection) && now - lastDetection > 500) { estimator.reset(); progress.hidden = true; say('Waiting for the camera…'); }
        animation = requestAnimationFrame(loop);
      };
      animation = requestAnimationFrame(loop);
    } catch (error) {
      if (!current()) return;
      fail(error.name === 'NotAllowedError' ? 'Camera access denied. Allow access or enter manually.' : error.name === 'NotFoundError' ? 'No front camera found.' : error.message || 'Face scan unavailable. Try again.');
    }
  }
  function fail(message) { release(); phase = 'error'; dialog.dataset.phase = phase; progress.hidden = true; retry.hidden = false; manual.hidden = false; say(message); }
  retry.addEventListener('click', () => void start());
  void start();
  return close;
}
