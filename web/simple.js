import { createLiveSegmentSession } from './live-segment.js';
import { sheetHomography, project, measure } from './calibration.js';
import { detectSheetMarkers } from './marker-detect.js';

const $ = id => document.getElementById(id);
const stage = $('stage');
const frame = $('camera-frame');
const video = $('camera');
const review = $('review-canvas');
const reviewContext = review.getContext('2d', { willReadFrequently: true });
const status = $('status');
const primary = $('primary');
const secondary = $('secondary');
const photoLabel = $('photo-label');
const controllerButton = $('controller-capture');
const sides = { left: $('side-left'), right: $('side-right') };
const captures = { left: null, right: null };
const accessKey = new URLSearchParams(location.hash.slice(1)).get('access');
const apiFetch = (url, options = {}) => fetch(url, {
  ...options,
  headers: { ...options.headers, ...(accessKey ? { 'X-OptiFrame-Key': accessKey } : {}) },
});

let side = 'left';
let phase = 'idle';
let captureGeneration = 0;
let controller;
let pendingPhoto = null;

function fitCamera() {
  if (!video.videoWidth || !video.videoHeight) return;
  frame.style.width = `${Math.min(stage.clientWidth, stage.clientHeight * video.videoWidth / video.videoHeight)}px`;
}

function activeCapture() { return captures[side]; }

function setStage(view) {
  $('empty').hidden = view !== 'empty';
  frame.hidden = view !== 'camera';
  review.hidden = view !== 'review';
  $('result-svg').hidden = view !== 'result';
  stage.classList.toggle('camera-on', view === 'camera');
  if (view === 'camera') fitCamera();
}

function setPhase(next, message) {
  phase = next;
  document.body.dataset.phase = next;
  const capture = activeCapture();
  const hasResult = Boolean(capture?.measurement);
  const labels = { idle: '01 / CAPTURE', starting: '01 / CAPTURE', live: '01 / LIVE', aim: '01 / TARGET', processing: '01 / TARGET', markers: '02 / SCALE', result: '03 / RESULT' };
  $('step-label').textContent = labels[next];
  sides.left.setAttribute('aria-pressed', String(side === 'left'));
  sides.right.setAttribute('aria-pressed', String(side === 'right'));
  $('headline').textContent = hasResult && next === 'result'
    ? `${capture.measurement.width.toFixed(1)} × ${capture.measurement.height.toFixed(1)} mm`
    : next === 'markers' ? 'Tap the four dots'
    : next === 'aim' || next === 'processing' ? 'Tap the lens'
    : `Scan ${side} lens`;
  $('instruction').textContent = next === 'aim' ? 'Tap the middle of the lens to find its edge.'
    : next === 'processing' ? 'Finding the edge around the point you tapped.'
    : next === 'markers'
    ? `Tap white dot ${capture.markers.length + 1} of 4 on the sheet.`
    : next === 'result' ? 'Perspective-corrected outline. Compare it with the real lens.'
    : next === 'live' ? 'Keep the lens inside the blue box. Drag the box to refine it.'
    : 'Put one lens on the sheet, title upright. Keep four dots visible.';
  if (next === 'idle' || next === 'starting') setStage('empty');
  if (next === 'live') setStage('camera');
  if (next === 'markers' || next === 'aim' || next === 'processing') setStage('review');
  if (next === 'result') setStage('result');
  primary.hidden = next === 'markers' || next === 'aim';
  primary.disabled = next === 'starting' || next === 'processing' || (next === 'live' && controllerButton.disabled);
  primary.textContent = next === 'idle' ? 'Start camera'
    : next === 'starting' ? 'Opening camera…'
    : next === 'live' ? controllerButton.disabled ? 'Finding the lens edge…' : 'Capture outline'
    : next === 'processing' ? 'Finding the lens edge…'
    : next === 'result' ? side === 'left' && !captures.right?.measurement ? 'Scan right lens' : 'Scan another lens'
    : '';
  photoLabel.hidden = next === 'markers' || next === 'result' || next === 'starting' || next === 'processing' || next === 'aim';
  secondary.hidden = next === 'idle' || next === 'starting' || next === 'processing';
  secondary.textContent = next === 'live' ? 'Stop camera' : next === 'result' ? 'Correct dots' : 'Retake';
  $('studio-link').hidden = next !== 'result' || !captures.left?.measurement || !captures.right?.measurement;
  if (message) status.textContent = message;
}

function stopCamera() {
  captureGeneration++;
  controller?.stop();
}

async function startCamera() {
  stopCamera();
  const generation = captureGeneration;
  setPhase('starting', 'Allow camera access when your phone asks.');
  try {
    await controller.start();
    if (generation !== captureGeneration) return;
    setPhase('live', 'Center the lens. Its outline will appear in green.');
    fitCamera();
  } catch (error) {
    if (generation !== captureGeneration) return;
    setPhase('idle', `Camera unavailable: ${error.message}`);
  }
}

function renderReview(capture) {
  if (!capture?.bitmap) return;
  review.width = capture.width;
  review.height = capture.height;
  reviewContext.drawImage(capture.bitmap, 0, 0, capture.width, capture.height);
  reviewContext.beginPath();
  capture.contour.forEach(([x, y], index) => index ? reviewContext.lineTo(x, y) : reviewContext.moveTo(x, y));
  reviewContext.closePath();
  reviewContext.strokeStyle = '#bcf26b';
  reviewContext.lineWidth = Math.max(3, capture.width / 350);
  reviewContext.stroke();
  capture.markers.forEach(([x, y], index) => {
    reviewContext.beginPath();
    reviewContext.arc(x, y, Math.max(6, capture.width / 160), 0, Math.PI * 2);
    reviewContext.fillStyle = '#65d8f1';
    reviewContext.fill();
    reviewContext.fillStyle = '#102b2b';
    reviewContext.font = `bold ${Math.max(15, capture.width / 58)}px sans-serif`;
    reviewContext.fillText(String(index + 1), x + 10, y - 8);
  });
}

function drawResult(capture) {
  const points = capture.contour.map(point => project(point, capture.homography));
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX, spanY = Math.max(...ys) - minY;
  const scale = Math.min(270 / spanX, 170 / spanY);
  const offsetX = (320 - spanX * scale) / 2;
  const offsetY = (220 - spanY * scale) / 2;
  $('result-path').setAttribute('d', points.map(([x, y], index) =>
    `${index ? 'L' : 'M'}${(offsetX + (x - minX) * scale).toFixed(2)},${(offsetY + (y - minY) * scale).toFixed(2)}`).join(' ') + ' Z');
}

function completeMarkers(capture, automatic = false) {
  try {
    capture.homography = sheetHomography(capture.markers);
    capture.measurement = measure(capture.contour.map(point => project(point, capture.homography)), 1);
    if (!capture.measurement || !Number.isFinite(capture.measurement.width) || !Number.isFinite(capture.measurement.height))
      throw new Error('Could not measure this outline');
    drawResult(capture);
    setPhase('result', automatic
      ? 'Sheet dots found automatically. Check the outline against the real lens.'
      : 'Sheet scale set. Check the outline against the real lens.');
  } catch (error) {
    capture.markers = [];
    capture.homography = null;
    capture.measurement = null;
    renderReview(capture);
    setPhase('markers', `${error.message}. Tap the white dots 1 → 2 → 3 → 4.`);
  }
}

async function acceptCapture({ file, contour, width, height }) {
  const bitmap = await createImageBitmap(file);
  const scaleX = bitmap.width / width, scaleY = bitmap.height / height;
  const capture = {
    file, bitmap, width: bitmap.width, height: bitmap.height,
    contour: contour.map(([x, y]) => [x * scaleX, y * scaleY]),
    markers: [], homography: null, measurement: null,
  };
  captures[side]?.bitmap?.close();
  captures[side] = capture;
  stopCamera();
  review.width = capture.width;
  review.height = capture.height;
  reviewContext.drawImage(bitmap, 0, 0, capture.width, capture.height);
  try { capture.markers = detectSheetMarkers(reviewContext.getImageData(0, 0, capture.width, capture.height)) || []; }
  catch { capture.markers = []; }
  if (capture.markers.length === 4) { completeMarkers(capture, true); return; }
  renderReview(capture);
  setPhase('markers', 'Tap the four white dots on the sheet in order 1 → 2 → 3 → 4.');
}

async function selectPhoto(file) {
  if (!file) return;
  stopCamera();
  try {
    const bitmap = await createImageBitmap(file);
    const factor = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * factor);
    canvas.height = Math.round(bitmap.height * factor);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (!blob) throw new Error('Could not read that photo');
    pendingPhoto?.bitmap?.close();
    pendingPhoto = { file: new File([blob], 'lens.jpg', { type: 'image/jpeg' }),
      bitmap: await createImageBitmap(blob), width: canvas.width, height: canvas.height };
    review.width = canvas.width;
    review.height = canvas.height;
    reviewContext.drawImage(pendingPhoto.bitmap, 0, 0);
    setPhase('aim', 'Tap the middle of the lens in your photo.');
  } catch (error) { setPhase('idle', `Could not open that photo: ${error.message}`); }
}

async function segmentPhotoAt(x, y) {
  const photo = pendingPhoto;
  if (!photo) return;
  const generation = captureGeneration;
  setPhase('processing', 'Finding the lens edge around your tap…');
  try {
    const box = [
      Math.max(0, Math.round(x - photo.width * 0.25)),
      Math.max(0, Math.round(y - photo.height * 0.27)),
      Math.min(photo.width, Math.round(x + photo.width * 0.25)),
      Math.min(photo.height, Math.round(y + photo.height * 0.27)),
    ];
    const body = new FormData();
    body.append('image', photo.file, 'lens.jpg');
    body.append('box', JSON.stringify(box));
    const response = await apiFetch('/api/segment', { method: 'POST', body });
    const data = await response.json();
    if (generation !== captureGeneration) return;
    if (!response.ok) throw new Error(data.detail || 'Could not segment this photo');
    const candidate = data.candidates?.find(item => item.contour?.length >= 12);
    if (!candidate) throw new Error('No edge found. Tap closer to the lens or use softer light');
    await acceptCapture({ file: photo.file, contour: candidate.contour, width: data.width, height: data.height });
    photo.bitmap.close();
    pendingPhoto = null;
  } catch (error) {
    if (generation === captureGeneration) setPhase('aim', `${error.message}. Tap the lens again.`);
  }
}

controller = createLiveSegmentSession({
  video, overlay: $('camera-overlay'), status, captureButton: controllerButton,
  apiFetch, side: 'lens', onCapture: acceptCapture,
});

new MutationObserver(() => {
  if (phase !== 'live') return;
  primary.disabled = controllerButton.disabled;
  primary.textContent = controllerButton.disabled ? 'Finding the lens edge…' : 'Capture outline';
}).observe(controllerButton, { attributes: true, attributeFilter: ['disabled'] });

primary.addEventListener('click', () => {
  if (phase === 'idle') void startCamera();
  else if (phase === 'live') void controller.capture().catch(error => { status.textContent = error.message; });
  else if (phase === 'result') {
    const next = side === 'left' && !captures.right?.measurement ? 'right' : side;
    if (next === side) { captures[side]?.bitmap?.close(); captures[side] = null; }
    side = next;
    setPhase('idle', 'Ready to scan the next lens.');
  }
});

secondary.addEventListener('click', () => {
  if (phase === 'live') { stopCamera(); setPhase('idle', 'Camera stopped.'); }
  else if (phase === 'markers' || phase === 'aim') {
    captures[side]?.bitmap?.close(); captures[side] = null;
    pendingPhoto?.bitmap?.close(); pendingPhoto = null;
    setPhase('idle', 'Ready to retake this lens.');
  }
  else if (phase === 'result') {
    const capture = activeCapture();
    capture.markers = []; capture.homography = null; capture.measurement = null;
    renderReview(capture);
    setPhase('markers', 'Tap the white dots 1 → 2 → 3 → 4.');
  }
});

review.addEventListener('pointerdown', event => {
  if (phase !== 'markers' && phase !== 'aim') return;
  const rect = review.getBoundingClientRect();
  if (phase === 'aim') {
    const x = (event.clientX - rect.left) * pendingPhoto.width / rect.width;
    const y = (event.clientY - rect.top) * pendingPhoto.height / rect.height;
    void segmentPhotoAt(x, y);
    return;
  }
  const capture = activeCapture();
  if (!capture) return;
  capture.markers.push([
    Math.max(0, Math.min(capture.width, (event.clientX - rect.left) * capture.width / rect.width)),
    Math.max(0, Math.min(capture.height, (event.clientY - rect.top) * capture.height / rect.height)),
  ]);
  renderReview(capture);
  if (capture.markers.length === 4) completeMarkers(capture);
  else setPhase('markers', `Dot ${capture.markers.length} set. Tap dot ${capture.markers.length + 1}.`);
});

$('photo-input').addEventListener('change', event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  void selectPhoto(file);
});

const asDataURL = file => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Could not prepare the captured photo'));
  reader.readAsDataURL(file);
});

$('studio-link').addEventListener('click', async event => {
  event.preventDefault();
  try {
    const saved = await Promise.all(['left', 'right'].map(async lens => {
      const capture = captures[lens];
      if (!capture?.measurement) throw new Error(`Scan the ${lens} lens first`);
      return { side: lens, image: await asDataURL(capture.file),
        width: capture.width, height: capture.height,
        contour: capture.contour, markers: capture.markers };
    }));
    sessionStorage.setItem('optiframe-captures', JSON.stringify(saved));
    location.href = `/studio.html${location.hash}`;
  } catch (error) { status.textContent = `${error.message}. Try again.`; }
});

Object.entries(sides).forEach(([name, button]) => button.addEventListener('click', () => {
  if (name === side) return;
  stopCamera();
  pendingPhoto?.bitmap?.close(); pendingPhoto = null;
  side = name;
  const capture = activeCapture();
  if (capture?.measurement) { drawResult(capture); setPhase('result', 'Measured outline. Compare it with the real lens.'); }
  else if (capture) { renderReview(capture); setPhase('markers', 'Tap the white dots 1 → 2 → 3 → 4.'); }
  else setPhase('idle', 'Ready to open the camera.');
}));

window.addEventListener('resize', fitCamera);
window.addEventListener('pagehide', stopCamera);
setPhase('idle', 'Ready to open the camera.');
