import { createLiveSegmentSession } from './live-segment.js?v=6';
import { sheetHomography, project, measure } from './calibration.js';
import { detectSheetMarkers } from './marker-detect.js?v=6';

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
let targetPointer = null;

const aimOverlay = document.createElement('div');
aimOverlay.id = 'aim-overlay';
aimOverlay.hidden = true;
aimOverlay.innerHTML = '<span id="aim-crosshair" aria-hidden="true"></span><span id="aim-loupe" aria-hidden="true"><canvas width="160" height="160"></canvas></span>';
stage.append(aimOverlay);
const aimCrosshair = $('aim-crosshair');
const aimLoupe = $('aim-loupe');
const aimLoupeCanvas = aimLoupe.querySelector('canvas');
const aimLoupeContext = aimLoupeCanvas.getContext('2d');

function syncAimOverlay() {
  if (phase !== 'aim' && phase !== 'markers') { aimOverlay.hidden = true; return; }
  const stageRect = stage.getBoundingClientRect();
  const imageRect = review.getBoundingClientRect();
  aimOverlay.style.left = `${imageRect.left - stageRect.left}px`;
  aimOverlay.style.top = `${imageRect.top - stageRect.top}px`;
  aimOverlay.style.width = `${imageRect.width}px`;
  aimOverlay.style.height = `${imageRect.height}px`;
  aimOverlay.hidden = false;
  aimCrosshair.hidden = !targetPointer;
  aimLoupe.hidden = !targetPointer;
}

function drawAimTarget(target) {
  if (!target) { aimCrosshair.hidden = true; aimLoupe.hidden = true; return; }
  syncAimOverlay();
  const rect = review.getBoundingClientRect();
  const px = target.x * rect.width / review.width;
  const py = target.y * rect.height / review.height;
  aimCrosshair.style.left = `${px}px`;
  aimCrosshair.style.top = `${py}px`;
  const loupeSize = 112;
  const loupeLeft = Math.max(4, Math.min(rect.width - loupeSize - 4, px - loupeSize / 2));
  const loupeTop = py >= loupeSize + 48 ? py - loupeSize - 42 : py + 42;
  aimLoupe.style.left = `${loupeLeft}px`;
  aimLoupe.style.top = `${Math.max(4, Math.min(rect.height - loupeSize - 4, loupeTop))}px`;
  aimCrosshair.hidden = false;
  aimLoupe.hidden = false;
  const source = phase === 'aim' ? pendingPhoto?.bitmap : activeCapture()?.bitmap;
  if (!source) return;
  const sample = Math.max(12, 112 * review.width / Math.max(1, rect.width) / 4);
  const sourceLeft = Math.max(0, target.x - sample / 2);
  const sourceTop = Math.max(0, target.y - sample / 2);
  const sourceWidth = Math.min(source.width - sourceLeft, sample);
  const sourceHeight = Math.min(source.height - sourceTop, sample);
  const destLeft = (sourceLeft - target.x + sample / 2) * 160 / sample;
  const destTop = (sourceTop - target.y + sample / 2) * 160 / sample;
  aimLoupeContext.fillStyle = '#fff';
  aimLoupeContext.fillRect(0, 0, 160, 160);
  aimLoupeContext.imageSmoothingEnabled = true;
  aimLoupeContext.drawImage(source, sourceLeft, sourceTop, sourceWidth, sourceHeight,
    destLeft, destTop, sourceWidth * 160 / sample, sourceHeight * 160 / sample);
  aimLoupeContext.strokeStyle = '#c8fa72';
  aimLoupeContext.lineWidth = 2;
  aimLoupeContext.beginPath();
  aimLoupeContext.moveTo(80, 51); aimLoupeContext.lineTo(80, 73);
  aimLoupeContext.moveTo(80, 87); aimLoupeContext.lineTo(80, 109);
  aimLoupeContext.moveTo(51, 80); aimLoupeContext.lineTo(73, 80);
  aimLoupeContext.moveTo(87, 80); aimLoupeContext.lineTo(109, 80);
  aimLoupeContext.stroke();
  aimLoupeContext.beginPath(); aimLoupeContext.arc(80, 80, 5, 0, Math.PI * 2); aimLoupeContext.stroke();
}

function fitCamera() {
  if (!video.videoWidth || !video.videoHeight) return;
  frame.style.width = `${Math.min(stage.clientWidth, stage.clientHeight * video.videoWidth / video.videoHeight)}px`;
}
new ResizeObserver(fitCamera).observe(stage);

function activeCapture() { return captures[side]; }

function setStage(view) {
  $('empty').hidden = view !== 'empty';
  frame.hidden = view !== 'camera';
  review.hidden = view !== 'review';
  // SVGElement.hidden is not reflected consistently in Safari/WebKit.
  $('result-svg').toggleAttribute('hidden', view !== 'result');
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
    : next === 'markers' ? 'Mark the four dots'
    : next === 'aim' || next === 'processing' ? 'Locate the lens'
    : `Scan ${side} lens`;
  $('instruction').textContent = next === 'aim' ? 'Touch, drag to center the lens, then lift.'
    : next === 'processing' ? 'Finding the edge around the selected point.'
    : next === 'markers'
    ? `Touch and drag to white dot ${capture.markers.length + 1} of 4. Lift to set.`
    : next === 'result' ? 'Perspective-corrected outline. Compare it with the real lens.'
    : next === 'live' ? 'The edge appears in green. Press and drag the target if it misses.'
    : 'Put one lens on the sheet, title upright. Keep four dots visible.';
  if (next === 'idle' || next === 'starting') setStage('empty');
  if (next === 'live') setStage('camera');
  if (next === 'markers' || next === 'aim' || next === 'processing') setStage('review');
  if (next === 'result') setStage('result');
  if (next !== 'aim' && next !== 'markers') targetPointer = null;
  requestAnimationFrame(syncAimOverlay);
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
  const points = capture.rectifiedContour;
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX, spanY = Math.max(...ys) - minY;
  const scale = Math.min(270 / spanX, 170 / spanY);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Could not draw this outline. Retake the lens photo.');
  const offsetX = (320 - spanX * scale) / 2;
  const offsetY = (220 - spanY * scale) / 2;
  const path = $('result-path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#255c3d');
  path.setAttribute('stroke-width', '3');
  path.setAttribute('d', points.map(([x, y], index) =>
    `${index ? 'L' : 'M'}${(offsetX + (x - minX) * scale).toFixed(2)},${(offsetY + (y - minY) * scale).toFixed(2)}`).join(' ') + ' Z');
}

function validateLensContour(points, result) {
  const invalid = reason => { const error = new Error(reason); error.code = 'INVALID_LENS_CONTOUR'; throw error; };
  if (points.length < 12 || !points.every(point => point.length === 2 && point.every(Number.isFinite)))
    invalid('The lens edge was incomplete');
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  const bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  if (bounds[0] < -3 || bounds[1] < -3 || bounds[2] > 103 || bounds[3] > 73)
    invalid('The outline extends outside the four sheet dots');
  if (!result || !Object.values(result).every(Number.isFinite) ||
      result.width < 20 || result.height < 15 || result.width > 92 || result.height > 65 ||
      result.area < result.width * result.height * 0.3 ||
      result.area > result.width * result.height * 0.985)
    invalid('The detected edge does not look like one lens');
}

function completeMarkers(capture, automatic = false) {
  try {
    capture.homography = sheetHomography(capture.markers);
    capture.rectifiedContour = capture.contour.map(point => project(point, capture.homography));
    capture.measurement = measure(capture.rectifiedContour, 1);
    validateLensContour(capture.rectifiedContour, capture.measurement);
    drawResult(capture);
    setPhase('result', automatic
      ? 'Sheet dots found automatically. Check the outline against the real lens.'
      : 'Sheet scale set. Check the outline against the real lens.');
  } catch (error) {
    if (error.code === 'INVALID_LENS_CONTOUR') {
      pendingPhoto?.bitmap?.close();
      pendingPhoto = { file: capture.file, bitmap: capture.bitmap, width: capture.width, height: capture.height };
      captures[side] = null;
      review.width = capture.width;
      review.height = capture.height;
      reviewContext.drawImage(capture.bitmap, 0, 0);
      setPhase('aim', `${error.message}. Drag the target onto the lens and lift to retry.`);
      return;
    }
    capture.markers = [];
    capture.homography = null;
    capture.measurement = null;
    capture.rectifiedContour = null;
    renderReview(capture);
    setPhase('markers', `${error.message}. Drag to the white dots in order 1 → 2 → 3 → 4.`);
  }
}

async function acceptCapture({ file, contour, width, height }) {
  const bitmap = await createImageBitmap(file);
  const scaleX = bitmap.width / width, scaleY = bitmap.height / height;
  const capture = {
    file, bitmap, width: bitmap.width, height: bitmap.height,
    contour: contour.map(([x, y]) => [x * scaleX, y * scaleY]),
    markers: [], homography: null, measurement: null, rectifiedContour: null,
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
  setPhase('markers', 'Touch and drag to each white dot in order 1 → 2 → 3 → 4.');
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
    try { pendingPhoto.markers = detectSheetMarkers(reviewContext.getImageData(0, 0, canvas.width, canvas.height)); }
    catch { pendingPhoto.markers = null; }
    setPhase('aim', 'Touch and drag to the middle of the lens. Lift to find its edge.');
  } catch (error) { setPhase('idle', `Could not open that photo: ${error.message}`); }
}

async function segmentPhotoAt(x, y) {
  const photo = pendingPhoto;
  if (!photo) return;
  const generation = captureGeneration;
  setPhase('processing', 'Finding the lens edge around the selected point…');
  try {
    const markerWidth = photo.markers?.length === 4
      ? Math.hypot(photo.markers[1][0] - photo.markers[0][0], photo.markers[1][1] - photo.markers[0][1]) : null;
    const markerHeight = photo.markers?.length === 4
      ? Math.hypot(photo.markers[3][0] - photo.markers[0][0], photo.markers[3][1] - photo.markers[0][1]) : null;
    const halfWidth = markerWidth ? markerWidth * 0.34 : photo.width * 0.15;
    const halfHeight = markerHeight ? markerHeight * 0.37 : photo.height * 0.08;
    const box = [
      Math.max(0, Math.round(x - halfWidth)),
      Math.max(0, Math.round(y - halfHeight)),
      Math.min(photo.width, Math.round(x + halfWidth)),
      Math.min(photo.height, Math.round(y + halfHeight)),
    ];
    const body = new FormData();
    body.append('image', photo.file, 'lens.jpg');
    body.append('box', JSON.stringify(box));
    const response = await apiFetch('/api/segment', { method: 'POST', body });
    const data = await response.json();
    if (generation !== captureGeneration) return;
    if (!response.ok) throw new Error(data.detail || 'Could not segment this photo');
    const candidate = data.candidates?.find(item => item.method === 'sam2.1-hiera-small-cuda' && item.contour?.length >= 12);
    if (!candidate) throw new Error('No lens edge found. Drag the target onto the lens or use softer light');
    if (photo.markers?.length === 4) {
      const xs = candidate.contour.map(point => point[0]);
      const ys = candidate.contour.map(point => point[1]);
      const contourWidth = Math.max(...xs) - Math.min(...xs);
      const contourHeight = Math.max(...ys) - Math.min(...ys);
      if (contourWidth > markerWidth * 0.9 || contourHeight > markerHeight * 0.9)
        throw new Error('That edge is the sheet, not the lens');
    }
    await acceptCapture({ file: photo.file, contour: candidate.contour, width: data.width, height: data.height });
    if (pendingPhoto === photo) { photo.bitmap.close(); pendingPhoto = null; }
  } catch (error) {
    if (generation === captureGeneration) setPhase('aim', `${error.message}. Drag onto the lens and lift to retry.`);
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
    setPhase('markers', 'Touch and drag to the white dots 1 → 2 → 3 → 4.');
  }
});

function reviewPoint(event) {
  const rect = review.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(review.width, (event.clientX - rect.left) * review.width / rect.width)),
    y: Math.max(0, Math.min(review.height, (event.clientY - rect.top) * review.height / rect.height)),
  };
}

review.addEventListener('pointerdown', event => {
  if (phase !== 'markers' && phase !== 'aim') return;
  event.preventDefault();
  review.setPointerCapture(event.pointerId);
  targetPointer = { id: event.pointerId, point: reviewPoint(event) };
  drawAimTarget(targetPointer.point);
});

review.addEventListener('pointermove', event => {
  if (!targetPointer || targetPointer.id !== event.pointerId) return;
  event.preventDefault();
  targetPointer.point = reviewPoint(event);
  drawAimTarget(targetPointer.point);
});

review.addEventListener('pointerup', event => {
  if (!targetPointer || targetPointer.id !== event.pointerId) return;
  event.preventDefault();
  const point = reviewPoint(event);
  targetPointer = null;
  drawAimTarget(null);
  if (phase === 'aim') { void segmentPhotoAt(point.x, point.y); return; }
  if (phase !== 'markers') return;
  const capture = activeCapture();
  if (!capture) return;
  capture.markers.push([point.x, point.y]);
  renderReview(capture);
  if (capture.markers.length === 4) completeMarkers(capture);
  else setPhase('markers', `Dot ${capture.markers.length} set. Drag to dot ${capture.markers.length + 1}, then lift.`);
});

review.addEventListener('pointercancel', () => { targetPointer = null; drawAimTarget(null); });

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
  else if (capture) { renderReview(capture); setPhase('markers', 'Touch and drag to the white dots 1 → 2 → 3 → 4.'); }
  else setPhase('idle', 'Ready to open the camera.');
}));

window.addEventListener('resize', () => { fitCamera(); syncAimOverlay(); });
window.addEventListener('pagehide', stopCamera);
setPhase('idle', 'Ready to open the camera.');
