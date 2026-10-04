import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSheetMarkers } from './marker-detect.js';

function image(width = 700, height = 560) {
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  return { width, height, data };
}
function drawMarker(img, x, y, side = 18, angle = 0) {
  const cs = Math.cos(angle), sn = Math.sin(angle);
  for (let py = Math.floor(y - side); py <= Math.ceil(y + side); py++)
    for (let px = Math.floor(x - side); px <= Math.ceil(x + side); px++) {
      if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
      const dx = px - x, dy = py - y;
      const u = cs * dx + sn * dy, v = -sn * dx + cs * dy;
      if (Math.abs(u) > side / 2 || Math.abs(v) > side / 2 || Math.hypot(u, v) < side * 0.15) continue;
      const i = (py * img.width + px) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 17;
    }
}
function near(actual, expected, tolerance = 4) {
  assert.ok(Math.hypot(actual[0] - expected[0], actual[1] - expected[1]) <= tolerance, `${actual} near ${expected}`);
}

test('detects the four printed markers in numbered order', () => {
  const img = image();
  const points = [[120, 120], [520, 120], [520, 400], [120, 400]];
  for (const [x, y] of points) drawMarker(img, x, y);
  const result = detectSheetMarkers(img);
  assert.ok(result);
  result.forEach((p, i) => near(p, points[i]));
});

test('accepts modest perspective and rotated marker squares', () => {
  const img = image();
  const points = [[135, 105], [525, 130], [495, 395], [115, 385]];
  for (const [x, y] of points) drawMarker(img, x, y, 19, 0.19);
  const result = detectSheetMarkers(img);
  assert.ok(result);
  result.forEach((p, i) => near(p, points[i], 6));
});

test('uses original pixels for the white dot in a downsampled phone photo', () => {
  const img = image(1800, 1350);
  const points = [[360, 340], [1260, 350], [1260, 980], [360, 970]];
  for (const [x, y] of points) drawMarker(img, x, y, 54);
  const result = detectSheetMarkers(img);
  assert.ok(result);
  result.forEach((p, i) => near(p, points[i], 6));
});

test('finds markers connected to printed grid lines with dim white centres', () => {
  const img = image();
  const points = [[120, 120], [520, 120], [520, 400], [120, 400]];
  for (const [x, y] of points) drawMarker(img, x, y);
  for (let x = 120; x <= 520; x++) for (const y of [120, 400]) {
    const i = (y * img.width + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 55;
  }
  for (let y = 120; y <= 400; y++) for (const x of [120, 520]) {
    const i = (y * img.width + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 55;
  }
  for (const [x, y] of points) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const i = ((y + dy) * img.width + x + dx) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 145;
  }
  const result = detectSheetMarkers(img);
  assert.ok(result);
  result.forEach((p, i) => near(p, points[i]));
});

test('finds markers whose centres are dim under phone exposure while rejecting solid squares', () => {
  const img = image(700, 560);
  const points = [[120, 120], [520, 120], [520, 400], [120, 400]];
  for (const [x, y] of points) {
    drawMarker(img, x, y);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const i = ((y + dy) * img.width + x + dx) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 101;
    }
  }
  const result = detectSheetMarkers(img);
  assert.ok(result);
  result.forEach((point, index) => near(point, points[index]));
});

test('rejects incomplete sheet and solid dark distractors', () => {
  const img = image();
  [[120, 120], [520, 120], [520, 400]].forEach(([x, y]) => drawMarker(img, x, y));
  // A solid square has no white centre.
  for (let y = 390; y < 410; y++) for (let x = 110; x < 130; x++) {
    const i = (y * img.width + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
  }
  assert.equal(detectSheetMarkers(img), null);
});

test('rejects four white-centred squares in a wrong layout', () => {
  const img = image();
  [[100, 90], [500, 90], [450, 180], [100, 450]].forEach(([x, y]) => drawMarker(img, x, y));
  assert.equal(detectSheetMarkers(img), null);
});
