import { createLiveSegmentSession } from './live-segment.js?v=41';
import { sheetHomography, project, measure } from './calibration.js';
import { detectSheetMarkers } from './marker-detect.js?v=9';
import { photoReviewLayout } from './photo-review.js?v=23';
import {apiFetch,requireAppAccess} from './api-fetch.js?v=43';
await requireAppAccess();

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
const captures = { left: null, right: null };
const accessKey = new URLSearchParams(location.hash.slice(1)).get('access');

let side = 'left';
let phase = 'idle';
let captureGeneration = 0;
let controller;
let pendingPhoto = null;
let targetPointer = null;
let audioContext = null;
let resultView = 'photo';
let awaitingRemoval = false;
let torchState = {supported:false,enabled:false,busy:false,error:''};
function renderTorch() {
  const button = $('torch-toggle');
  button.hidden = phase !== 'live' && phase !== 'remove';
  button.disabled = !torchState.supported || torchState.busy;
  button.setAttribute('aria-pressed', String(torchState.enabled));
  button.setAttribute('aria-label', !torchState.supported ? 'Flashlight unavailable in this browser' : torchState.enabled ? 'Turn off flashlight' : 'Turn on flashlight');
  $('torch-label').textContent = !torchState.supported ? 'No flash' : torchState.busy ? 'Changing…' : torchState.enabled ? 'Flash on' : 'Flash off';
  const note = torchState.error || (!torchState.supported ? 'Flashlight unavailable in this browser' : '');
  $('torch-note').textContent = note;
  $('torch-note').hidden = button.hidden || !note;
}

// Unlock sound during a user gesture; camera startup never plays audio.
function enableSound() {
  try {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return;
    audioContext ||= new Audio();
    void audioContext.resume().catch(() => {});
  } catch { /* Sound is optional when the browser blocks it. */ }
}

function validationSound() {
  if (audioContext?.state !== 'running') return;
  try {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;
    oscillator.frequency.setValueAtTime(660, now);
    oscillator.frequency.setValueAtTime(880, now + .09);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(.07, now + .015);
    gain.gain.exponentialRampToValueAtTime(.001, now + .22);
    oscillator.connect(gain); gain.connect(audioContext.destination);
    oscillator.start(now); oscillator.stop(now + .23);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  } catch { /* A sound failure must not block capture. */ }
}

// The desktop GPU can take several seconds per SAM proposal. Capture one fresh
// full-resolution original after the preview agrees, then validate that still
// independently. A five-frame burst cannot fit the live service's GPU budget.
function captureSingleStill(video, { maxSide = 1600, signal } = {}) {
  if (signal?.aborted) throw new DOMException('Capture cancelled', 'AbortError');
  if (!video.videoWidth || !video.videoHeight || video.readyState < 2)
    throw new Error('Camera is not ready');
  const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return { canvas, sampledAt: performance.now(), capturedAt: new Date().toISOString(),
    id: Number.isFinite(video.currentTime) ? video.currentTime : performance.now() };
}

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
  aimLoupeContext.strokeStyle = '#58c9ff';
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
function fitReview() {
  if (!review.width || !review.height) return;
  const factor = Math.min(stage.clientWidth / review.width, stage.clientHeight / review.height);
  review.style.width = `${review.width * factor}px`;
  review.style.height = `${review.height * factor}px`;
}
new ResizeObserver(() => { fitCamera(); fitReview(); syncAimOverlay(); }).observe(stage);

function activeCapture() { return captures[side]; }

function setStage(view) {
  $('empty').hidden = view !== 'empty';
  frame.hidden = view !== 'camera';
  review.hidden = view !== 'review';
  // SVGElement.hidden is not reflected consistently in Safari/WebKit.
  $('result-svg').toggleAttribute('hidden', view !== 'result' || resultView !== 'outline');
  $('result-photo').hidden = view !== 'result' || resultView !== 'photo';
  $('review-switch').hidden = view !== 'result';
  $('pair-results').hidden = view !== 'pair';
  stage.classList.toggle('camera-on', view === 'camera');
  if (view === 'camera') fitCamera();
  if (view === 'review') fitReview();
}

function setPhase(next, message) {
  phase = next;
  document.body.dataset.phase = next;
  const capture = activeCapture();
  const hasResult = Boolean(capture?.measurement);
  $('step-label').textContent = next === 'pair' ? '2 of 2' : `${side === 'left' ? 1 : 2} of 2`;
  $('headline').textContent = next === 'pair' ? 'Your two lenses' : hasResult && next === 'result'
    ? `${side === 'left' ? 'Left' : 'Right'} lens`
    : next === 'markers' ? 'Set the scale'
    : next === 'aim' || next === 'processing' ? 'Locate the lens'
    : next === 'remove' ? 'Remove left lens'
    : side === 'left' ? 'Left lens' : 'Right lens';
  $('instruction').textContent = next === 'aim' ? 'Touch, drag to center the lens, then lift.'
    : next === 'processing' ? ''
    : next === 'markers'
    ? `Touch and drag to white dot ${capture.markers.length + 1} of 4. Lift to set.`
    : next === 'remove' ? 'Keep all four dots in view.'
    : next === 'live' && side === 'right' ? 'Place the right lens after the sheet is empty.'
    : '';
  if (next === 'idle' || next === 'starting') setStage('empty');
  if (next === 'live' || next === 'remove') setStage('camera');
  if (next === 'markers' || next === 'aim' || next === 'processing') setStage('review');
  if (next === 'result') setStage('result');
  if (next === 'pair') setStage('pair');
  if (next !== 'aim' && next !== 'markers') targetPointer = null;
  $('remove-overlay').hidden = next !== 'remove';
  requestAnimationFrame(syncAimOverlay);
  const cameraPhase = ['idle', 'starting', 'live', 'remove'].includes(next);
  primary.hidden = !['result', 'pair'].includes(next);
  primary.disabled = false;
  primary.textContent = next === 'pair' ? 'Fit frame' : 'Confirm';
  primary.setAttribute('aria-label', next === 'pair' ? 'Confirm both lenses and fit frame' : 'Confirm lens');
  photoLabel.hidden = !cameraPhase;
  $('camera-retry').hidden = next !== 'idle';
  $('empty').textContent = next === 'idle' ? 'Camera unavailable. Retry or use a photo.' : 'Opening camera…';
  secondary.hidden = !['markers', 'aim', 'result'].includes(next);
  secondary.textContent = 'Retry';
  status.textContent = message || '';
  renderTorch();
}

function stopCamera() {
  captureGeneration++;
  controller?.stop();
}

async function startCamera(requireRemoval = false) {
  setPhase('starting');
  stopCamera();
  awaitingRemoval = requireRemoval;
  resultView = 'photo';
  $('result-photo').width = 1; // Release the previous image before another capture.
  $('result-photo').height = 1;
  const generation = captureGeneration;
  try {
    await controller.start({ requireRemoval });
    if (generation !== captureGeneration) return;
    setPhase(awaitingRemoval ? 'remove' : 'live');
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
  reviewContext.strokeStyle = '#58c9ff';
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

function drawResult(capture, pathId = 'result-path') {
  const points = capture.rectifiedContour;
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX, spanY = Math.max(...ys) - minY;
  const scale = Math.min(240 / spanX, 145 / spanY);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Could not draw this outline. Retake the lens photo.');
  const offsetX = 20 + (240 - spanX * scale) / 2;
  const offsetY = 15 + (150 - spanY * scale) / 2;
  const path = $(pathId);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#e5eaf2');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('d', points.map(([x, y], index) =>
    `${index ? 'L' : 'M'}${(offsetX + (x - minX) * scale).toFixed(2)},${(offsetY + (y - minY) * scale).toFixed(2)}`).join(' ') + ' Z');
  const right = offsetX + spanX * scale, bottom = offsetY + spanY * scale;
  const horizontalY = bottom + 19, verticalX = right + 20;
  const centerX = (offsetX + right) / 2, centerY = (offsetY + bottom) / 2;
  const widthLabel = `${capture.measurement.width.toFixed(1)} mm`;
  const heightLabel = `${capture.measurement.height.toFixed(1)} mm`;
  $(pathId.replace('-path', '-dimensions')).innerHTML =
    `<path class="dimension-line" d="M${offsetX},${bottom + 4}V${horizontalY + 4} M${right},${bottom + 4}V${horizontalY + 4} M${offsetX},${horizontalY}H${right} M${offsetX + 4},${horizontalY - 3}L${offsetX},${horizontalY}L${offsetX + 4},${horizontalY + 3} M${right - 4},${horizontalY - 3}L${right},${horizontalY}L${right - 4},${horizontalY + 3} M${right + 4},${offsetY}H${verticalX + 4} M${right + 4},${bottom}H${verticalX + 4} M${verticalX},${offsetY}V${bottom} M${verticalX - 3},${offsetY + 4}L${verticalX},${offsetY}L${verticalX + 3},${offsetY + 4} M${verticalX - 3},${bottom - 4}L${verticalX},${bottom}L${verticalX + 3},${bottom - 4}"/>` +
    `<text class="dimension-label" x="${centerX}" y="${horizontalY + 15}" text-anchor="middle">${widthLabel}</text>` +
    `<text class="dimension-label" transform="translate(${verticalX + 14} ${centerY}) rotate(-90)" text-anchor="middle">${heightLabel}</text>`;
}

function drawPhotoResult(capture) {
  const layout = photoReviewLayout(capture.contour, capture.width, capture.height);
  const canvas = $('result-photo');
  canvas.width = layout.width; canvas.height = layout.height;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.globalAlpha = .65;
  context.drawImage(capture.bitmap, ...layout.crop, 0, 0, layout.width, layout.height);
  context.globalAlpha = 1;
  context.beginPath();
  layout.contour.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
  context.closePath();
  context.strokeStyle = '#e5eaf2';
  context.lineWidth = Math.max(1.5, layout.width / 240);
  context.lineJoin = 'round'; context.lineCap = 'round';
  context.stroke();
}

function selectResultView(view) {
  resultView = view;
  $('review-photo').setAttribute('aria-pressed', String(view === 'photo'));
  $('review-outline').setAttribute('aria-pressed', String(view === 'outline'));
  if (phase === 'result') setStage('result');
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
    drawPhotoResult(capture);
    selectResultView('photo');
    setPhase('result');
    validationSound();
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
    setPhase('markers', `${error.message}. Drag to white dots 1, 2, 3, 4.`);
  }
}

async function acceptCapture({ file, contour, width, height, markers, refinement }) {
  const generation = captureGeneration;
  const capturedSide = side;
  const bitmap = await createImageBitmap(file);
  if (generation !== captureGeneration || capturedSide !== side) { bitmap.close(); return; }
  const scaleX = bitmap.width / width, scaleY = bitmap.height / height;
  const capture = {
    file, bitmap, width: bitmap.width, height: bitmap.height, refinement,
    contour: contour.map(([x, y]) => [x * scaleX, y * scaleY]),
    markers: markers?.map(([x, y]) => [x * scaleX, y * scaleY]) || [], homography: null, measurement: null, rectifiedContour: null,
  };
  captures[side]?.bitmap?.close();
  captures[side] = capture;
  stopCamera();
  review.width = capture.width;
  review.height = capture.height;
  reviewContext.drawImage(bitmap, 0, 0, capture.width, capture.height);
  try { if (capture.markers.length !== 4) capture.markers = detectSheetMarkers(reviewContext.getImageData(0, 0, capture.width, capture.height)) || []; }
  catch { capture.markers = []; }
  if (capture.markers.length === 4) { completeMarkers(capture, true); return; }
  renderReview(capture);
  setPhase('markers', 'Drag to white dots 1, 2, 3, 4.');
}

async function selectPhoto(file) {
  if (!file) return;
  stopCamera();
  const generation = captureGeneration;
  try {
    const bitmap = await createImageBitmap(file);
    if (generation !== captureGeneration) { bitmap.close(); return; }
    const factor = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * factor);
    canvas.height = Math.round(bitmap.height * factor);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    if (generation !== captureGeneration) return;
    if (!blob) throw new Error('Could not read that photo');
    const photoBitmap = await createImageBitmap(blob);
    if (generation !== captureGeneration) { photoBitmap.close(); return; }
    pendingPhoto?.bitmap?.close();
    pendingPhoto = { file: new File([blob], 'lens.jpg', { type: 'image/jpeg' }),
      bitmap: photoBitmap, width: canvas.width, height: canvas.height };
    review.width = canvas.width;
    review.height = canvas.height;
    reviewContext.drawImage(pendingPhoto.bitmap, 0, 0);
    try { pendingPhoto.markers = detectSheetMarkers(reviewContext.getImageData(0, 0, canvas.width, canvas.height)); }
    catch { pendingPhoto.markers = null; }
    if (pendingPhoto.markers?.length === 4) {
      const center = pendingPhoto.markers.reduce((sum, point) => [sum[0] + point[0] / 4, sum[1] + point[1] / 4], [0, 0]);
      await segmentPhotoAt(...center);
    } else setPhase('aim', 'Press on the lens, drag to its center, then lift.');
  } catch (error) { if (generation === captureGeneration) setPhase('idle', `Could not open that photo: ${error.message}`); }
}

async function segmentPhotoAt(x, y) {
  const photo = pendingPhoto;
  if (!photo) return;
  const generation = captureGeneration;
  setPhase('processing', 'Measuring…');
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
    const response = await apiFetch('/api/live-segment', { method: 'POST', body });
    const data = await response.json();
    if (generation !== captureGeneration) return;
    if (!response.ok) throw new Error(data.detail || 'Could not segment this photo');
    if (data.width !== photo.width || data.height !== photo.height)
      throw new Error('Photo size changed. Try again');
    if (data.presence?.detected !== true || data.edgeRefinement?.accepted !== true ||
        !Array.isArray(data.contour) || data.contour.length < 12 ||
        !data.contour.every(point => Array.isArray(point) && point.length === 2 && point.every((value, axis) =>
          Number.isFinite(value) && value >= 0 && value <= (axis ? photo.height : photo.width))))
      throw new Error('Edge unclear. Adjust the light');
    if (photo.markers?.length === 4) {
      const xs = data.contour.map(point => point[0]);
      const ys = data.contour.map(point => point[1]);
      const contourWidth = Math.max(...xs) - Math.min(...xs);
      const contourHeight = Math.max(...ys) - Math.min(...ys);
      if (contourWidth > markerWidth * 0.9 || contourHeight > markerHeight * 0.9)
        throw new Error('That edge is the sheet, not the lens');
    }
    await acceptCapture({ file: photo.file, contour: data.contour, width: data.width, height: data.height,
      markers: photo.markers, refinement: {method: 'single-frame-image-edge', inputFrames: 1, acceptedFrames: 1,
        rawReferenceContour: data.rawContour, edgeRefinement: data.edgeRefinement} });
    if (pendingPhoto === photo) { photo.bitmap.close(); pendingPhoto = null; }
  } catch (error) {
    if (generation === captureGeneration) setPhase('aim', error.message);
  }
}

controller = createLiveSegmentSession({
  video, overlay: $('camera-overlay'), status, captureButton: controllerButton,
  apiFetch, side: 'lens', removalLabel: 'left', onCapture: acceptCapture, minimalStatus: true,
  autoCapture: true, captureFrame: captureSingleStill,
  requestTimeoutMs: 30000, maxResultAgeMs: 30000,
  onRemovalChange(waiting) {
    if (side !== 'right' || !captures.left?.confirmed) return;
    awaitingRemoval = waiting;
    if (phase === 'remove' && !waiting) setPhase('live', 'Place the right lens on the sheet.');
    else if (phase === 'live' && waiting) setPhase('remove');
  },
  onTorchChange(state) { torchState = state; renderTorch(); },
  viewSweep: new URLSearchParams(location.search || '').get('capture') === 'sweep',
  calibrateFrame(imageData, contour) {
    const markers = detectSheetMarkers(imageData);
    if (markers?.length !== 4) return null;
    const homography = sheetHomography(markers);
    return { markers, contour: contour.map(point => project(point, homography)) };
  },
  locateTarget(imageData) {
    const markers = detectSheetMarkers(imageData);
    if (markers?.length !== 4) return null;
    const [x, y] = markers.reduce((sum, point) => [sum[0] + point[0] / 4, sum[1] + point[1] / 4], [0, 0]);
    const halfWidth = Math.hypot(markers[1][0] - markers[0][0], markers[1][1] - markers[0][1]) * .34;
    const halfHeight = Math.hypot(markers[3][0] - markers[0][0], markers[3][1] - markers[0][1]) * .37;
    return [Math.max(0, (x - halfWidth) / imageData.width), Math.max(0, (y - halfHeight) / imageData.height),
      Math.min(1, (x + halfWidth) / imageData.width), Math.min(1, (y + halfHeight) / imageData.height)];
  },
});

function showPair() {
  for (const lens of ['left', 'right']) {
    const capture = captures[lens];
    if (!capture?.confirmed || !capture.measurement) return;
    drawResult(capture, `${lens}-path`);
  }
  setPhase('pair');
}

function retryLens(lens = side) {
  stopCamera();
  captures[lens]?.bitmap?.close(); captures[lens] = null;
  pendingPhoto?.bitmap?.close(); pendingPhoto = null;
  side = lens;
  void startCamera();
}

primary.addEventListener('click', () => {
  enableSound();
  if (phase === 'result') {
    activeCapture().confirmed = true;
    if (captures.left?.confirmed && captures.right?.confirmed) showPair();
    else { side = captures.left?.confirmed ? 'right' : 'left'; void startCamera(true); }
  } else if (phase === 'pair') {
    void openStudio();
  }
});
secondary.addEventListener('click', () => retryLens());
$('retry-left').addEventListener('click', () => retryLens('left'));
$('retry-right').addEventListener('click', () => retryLens('right'));
$('camera-retry').addEventListener('click', () => { enableSound(); void startCamera(); });
$('remove-confirm').addEventListener('click', () => {
  if (phase !== 'remove' || side !== 'right' || !awaitingRemoval) return;
  if (!controller.confirmLensChanged()) {
    status.textContent = 'Keep the empty sheet in view, then try again.';
  }
});
$('torch-toggle').addEventListener('click', () => {
  if ((phase === 'live' || phase === 'remove') && torchState.supported && !torchState.busy) void controller.setTorch(!torchState.enabled);
});
$('review-photo').addEventListener('click', () => selectResultView('photo'));
$('review-outline').addEventListener('click', () => selectResultView('outline'));
photoLabel.addEventListener('click', enableSound);
photoLabel.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); enableSound(); $('photo-input').click(); }
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
  enableSound();
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

async function openStudio() {
  const generation = captureGeneration;
  primary.disabled = true;
  try {
    const saved = await Promise.all(['left', 'right'].map(async lens => {
      const capture = captures[lens];
      if (!capture?.measurement || !capture.confirmed) throw new Error(`Confirm the ${lens} lens first`);
      return { side: lens, image: await asDataURL(capture.file),
        width: capture.width, height: capture.height,
        contour: capture.contour, markers: capture.markers, refinement: capture.refinement };
    }));
    if (generation !== captureGeneration || phase !== 'pair') return;
    sessionStorage.setItem('optiframe-captures', JSON.stringify(saved));
    location.href = `/studio.html${location.hash}`;
  } catch (error) {
    if (generation !== captureGeneration || phase !== 'pair') return;
    status.textContent = `${error.message}. Try again.`; primary.disabled = false;
  }
}

window.addEventListener('resize', () => { fitCamera(); fitReview(); syncAimOverlay(); });
window.addEventListener('pagehide', stopCamera);
window.addEventListener('visibilitychange', () => {
  if (document.hidden && (torchState.enabled || torchState.busy)) {
    stopCamera(); setPhase('idle');
  }
});
void startCamera();
