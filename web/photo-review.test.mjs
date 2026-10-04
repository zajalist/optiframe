import test from 'node:test';
import assert from 'node:assert/strict';
import {photoReviewLayout} from './photo-review.js';
import {sheetHomography, project, unproject} from './calibration.js';

test('photo crop and overlay share the exact same pixel transform', () => {
  const points = [[101, 171], [231, 112], [415, 145], [456, 322], [220, 378]];
  const result = photoReviewLayout(points, 700, 500, {maxSide: 217});
  const [left, top, width, height] = result.crop;
  result.contour.forEach(([x, y], i) => {
    assert.ok(Math.abs(x / result.width * width + left - points[i][0]) < 1e-9);
    assert.ok(Math.abs(y / result.height * height + top - points[i][1]) < 1e-9);
  });
  assert.ok(result.contour.every(([x, y]) => x > 0 && y > 0 && x < result.width && y < result.height));
});

test('projectively corrected loop reprojects onto the original photo before cropping', () => {
  const h = sheetHomography([[70, 80], [640, 110], [575, 470], [105, 410]]);
  const pixels = [[210, 200], [430, 215], [445, 325], [225, 315]];
  const rectified = pixels.map(point => project(point, h));
  const referencePixels = rectified.map(point => unproject(point, h));
  const result = photoReviewLayout(referencePixels, 700, 500);
  const [left, top, width, height] = result.crop;
  result.contour.forEach(([x, y], i) => {
    assert.ok(Math.abs(x / result.width * width + left - pixels[i][0]) < 1e-8);
    assert.ok(Math.abs(y / result.height * height + top - pixels[i][1]) < 1e-8);
  });
});

test('padding clips to actual photo bounds and never stretches from a previous capture', () => {
  const first = photoReviewLayout([[0, 0], [100, 0], [100, 90], [0, 90]], 100, 90);
  assert.deepEqual(first.crop, [0, 0, 100, 90]);
  const second = photoReviewLayout([[200, 100], [250, 100], [250, 125], [200, 125]], 800, 600);
  assert.deepEqual(second.crop, [194, 97, 62, 31]);
  assert.notDeepEqual(first.contour, second.contour);
  assert.throws(() => photoReviewLayout([[0, 0], [10, 5], [NaN, 3]], 100, 100));
});
