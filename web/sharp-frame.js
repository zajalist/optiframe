function cropBox(box = [0, 0, 1, 1]) {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite))
    throw new TypeError('Invalid focus area');
  const [left, top, right, bottom] = box.map(value => Math.max(0, Math.min(1, value)));
  if (right <= left || bottom <= top) throw new TypeError('Invalid focus area');
  return [left, top, right, bottom];
}

// Score edge contrast after a small spatial average so single-pixel sensor noise
// does not win as readily. This is only a ranking; it is not a quality threshold.
export function focusScore(image, box) {
  const { width, height, data } = image;
  if (!width || !height || data.length < width * height * 4) return 0;
  const [left, top, right, bottom] = cropBox(box);
  const x0 = Math.max(2, Math.floor(left * width)), x1 = Math.min(width - 2, Math.ceil(right * width));
  const y0 = Math.max(2, Math.floor(top * height)), y1 = Math.min(height - 2, Math.ceil(bottom * height));
  const grey = new Float32Array(width * height), smooth = new Float32Array(width * height);
  for (let i = 0; i < grey.length; i++)
    grey[i] = (77 * data[i * 4] + 150 * data[i * 4 + 1] + 29 * data[i * 4 + 2]) / 256;
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    smooth[i] = (grey[i - width - 1] + 2 * grey[i - width] + grey[i - width + 1] +
      2 * grey[i - 1] + 4 * grey[i] + 2 * grey[i + 1] +
      grey[i + width - 1] + 2 * grey[i + width] + grey[i + width + 1]) / 16;
  }
  let sum = 0, count = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * width + x;
    const dx = smooth[i + 1] - smooth[i - 1], dy = smooth[i + width] - smooth[i - width];
    sum += dx * dx + dy * dy; count++;
  }
  return count ? sum / count : 0;
}

function checkAbort(signal) {
  if (signal?.aborted) throw new DOMException('Capture cancelled', 'AbortError');
}

function wait(ms, signal) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new DOMException('Capture cancelled', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Retain a burst of fresh originals ranked by focus, without sharpening pixels.
 * box is normalized [left, top, right, bottom]. A frozen stream is never accepted.
 */
export async function captureSharpFrame(video, { maxSide = 1920, box, signal, frameCount = 5 } = {}) {
  checkAbort(signal);
  const [left, top, right, bottom] = cropBox(box);
  if (!(maxSide > 0) || !Number.isFinite(maxSide)) throw new TypeError('Invalid capture size');
  if (!Number.isInteger(frameCount) || frameCount < 3 || frameCount > 5)
    throw new TypeError('Capture requires three to five frames');
  const sourceWidth = video.videoWidth, sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight || (Number.isFinite(video.readyState) && video.readyState < 2))
    throw new Error('Camera is not ready');
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const scoreCanvas = document.createElement('canvas');
  const cropWidth = (right - left) * sourceWidth, cropHeight = (bottom - top) * sourceHeight;
  const focusScale = Math.min(1, 240 / Math.max(cropWidth, cropHeight));
  scoreCanvas.width = Math.max(1, Math.round(cropWidth * focusScale));
  scoreCanvas.height = Math.max(1, Math.round(cropHeight * focusScale));
  const scoreContext = scoreCanvas.getContext('2d', { willReadFrequently: true });
  const frames = [];
  let lastTime = null;
  const started = performance.now();
  while (frames.length < frameCount && performance.now() - started < 900) {
    checkAbort(signal);
    const frameTime = video.currentTime;
    // currentTime is present on real video elements; simple test adapters may omit it.
    if (frames.length === 0 || !Number.isFinite(frameTime) || frameTime > lastTime) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      const sampledAt = performance.now(), capturedAt = new Date().toISOString();
      scoreContext.drawImage(canvas, left * canvas.width, top * canvas.height,
        (right - left) * canvas.width, (bottom - top) * canvas.height,
        0, 0, scoreCanvas.width, scoreCanvas.height);
      const sharpness = focusScore(scoreContext.getImageData(0, 0, scoreCanvas.width, scoreCanvas.height));
      frames.push({ canvas, sharpness, sampledAt, capturedAt, id: Number.isFinite(frameTime) ? frameTime : sampledAt });
      lastTime = frameTime;
    }
    if (frames.length < frameCount) await wait(75, signal);
  }
  checkAbort(signal);
  if (frames.length < frameCount) throw new Error('Camera stopped updating. Try again.');
  frames.sort((a, b) => b.sharpness - a.sharpness);
  return { ...frames[0], frames };
}
