import test from 'node:test';
import assert from 'node:assert/strict';
import { captureSharpFrame, focusScore } from './sharp-frame.js';

function image(blur = 0) {
  const width = 64, height = 64, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let value = 0;
    for (let dx = -blur; dx <= blur; dx++) value += ((Math.floor((x + dx + 64) / 8) % 2) ? 220 : 35);
    value /= 2 * blur + 1;
    data.set([value, value, value, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}

test('focus score ranks clear edges above motion blur and a blank scene', () => {
  assert.ok(focusScore(image()) > focusScore(image(3)));
  assert.ok(focusScore(image(3)) > focusScore(image(7)));
  assert.equal(focusScore({ width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).fill(150) }), 0);
});

function fakeCamera(t, advancing = false) {
  let frame = 0;
  const original = globalThis.document;
  globalThis.document = { createElement() {
    const canvas = { width: 0, height: 0, frame: null };
    canvas.getContext = () => ({
      drawImage(source) { canvas.frame = source.frame ?? frame; },
      getImageData() { return image(canvas.frame === 1 ? 0 : 3); },
    });
    return canvas;
  } };
  t.after(() => { globalThis.document = original; });
  return {
    video: { videoWidth: 2560, videoHeight: 1920, readyState: 4,
      get currentTime() { return frame / 30; }, get frame() { return advancing ? frame++ : frame; } },
  };
}

test('burst selects the sharp original frame with dimensions and capture metadata', async t => {
  const camera = fakeCamera(t, true);
  const result = await captureSharpFrame(camera.video);
  assert.equal(result.canvas.frame, 1);
  assert.equal(result.canvas.width, 1920);
  assert.equal(result.canvas.height, 1440);
  assert.ok(Number.isFinite(result.sampledAt));
  assert.ok(Number.isFinite(Date.parse(result.capturedAt)));
  assert.equal(result.sharpness, focusScore(image()));
});

test('aborting a burst does not return a partial capture', async t => {
  const camera = fakeCamera(t), controller = new AbortController();
  const result = captureSharpFrame(camera.video, { signal: controller.signal });
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
});

test('a frozen camera is rejected instead of counting the same frame three times', async t => {
  const camera = fakeCamera(t);
  await assert.rejects(captureSharpFrame(camera.video), /stopped updating/);
});

test('invalid crop and unavailable camera fail before capture', async () => {
  await assert.rejects(captureSharpFrame({videoWidth: 0, videoHeight: 0}), /not ready/);
  await assert.rejects(captureSharpFrame({}, {box: [1, 0, 0, 1]}), /Invalid focus area/);
});
