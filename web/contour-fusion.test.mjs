import test from 'node:test';
import assert from 'node:assert/strict';
import {fuseContours} from './contour-fusion.js';

const tau = Math.PI * 2;
function lens({noise = 0, phase = 0, dx = 0, dy = 0, count = 360, asymmetric = false} = {}) {
  return Array.from({length: count}, (_, i) => {
    const a = i * tau / count;
    const radius = 1 / Math.sqrt((Math.cos(a) / 25) ** 2 + (Math.sin(a) / 18) ** 2) +
      (asymmetric ? 2 * Math.cos(3 * a) + 0.8 * Math.sin(2 * a) : 0) + noise * Math.sin(71 * a + phase);
    return [50 + dx + radius * Math.cos(a), 35 + dy + radius * Math.sin(a)];
  });
}
const frames = options => options.map((option, id) => ({id, contour: lens(option)}));
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function boundaryDistance(point, contour) {
  return Math.min(...contour.map((a, i) => {
    const b = contour[(i + 1) % contour.length], dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    return distance(point, [a[0] + t * dx, a[1] + t * dy]);
  }));
}
const error = (contour, truth) => contour.reduce((sum, p) => sum + boundaryDistance(p, truth), 0) / contour.length;

test('combines independent jagged observations with bounded error and smoothing', () => {
  const input = frames([0, 1, 2, 3, 4].map(i => ({noise: 0.2, phase: i * tau / 5})));
  const truth = lens(), result = fuseContours(input);
  assert.ok(error(result.contour, truth) < error(input[0].contour, truth) * 0.3);
  assert.ok(Math.max(...result.contour.map(p => boundaryDistance(p, truth))) < 0.12);
  assert.equal(result.diagnostics.acceptedFrames, 5);
  assert.ok(result.diagnostics.maxSmoothingMm <= 0.12);
  assert.ok(Math.abs(result.diagnostics.widthChangeMm) <= 0.2);
  assert.ok(Math.abs(result.diagnostics.heightChangeMm) <= 0.2);
});

test('preserves an asymmetric lens instead of fitting an ellipse', () => {
  const input = frames([0, 1, 2, 3, 4].map(i => ({noise: 0.18, phase: i * tau / 5, asymmetric: true})));
  const result = fuseContours(input), truth = lens({asymmetric: true});
  assert.ok(error(result.contour, truth) < 0.06);
  assert.ok(error(result.contour, lens()) > 0.8);
});

test('rejects an outlier without moving the other contours into alignment', () => {
  const result = fuseContours(frames([{}, {noise: 0.05}, {noise: 0.05, phase: 2}, {dx: 5}]));
  assert.equal(result.diagnostics.acceptedFrames, 3);
  assert.deepEqual(result.diagnostics.rejectedIds, [3]);
  assert.ok(error(result.contour, lens()) < 0.04);
});

test('rejects translated observations and equally supported conflicting lenses', () => {
  for (const options of [[{dx: -2}, {}, {dx: 2}], [{}, {}, {}, {dx: 3}, {dx: 3}, {dx: 3}]]) {
    assert.throws(() => fuseContours(frames(options)), {code: 'CONTOUR_FUSION_UNSTABLE'});
  }
});

test('orientation and vertex density do not change the measured sheet position', () => {
  const samples = frames([{count: 180}, {count: 720}, {count: 360}]);
  samples[1].contour.reverse();
  samples[2].contour.push(samples[2].contour[0]);
  const result = fuseContours(samples);
  assert.ok(error(result.contour, lens()) < 0.02);
  assert.ok(Math.abs(result.diagnostics.origin[0] - 50) < 0.001);
  assert.ok(Math.abs(result.diagnostics.origin[1] - 35) < 0.001);
});

test('invalid or duplicate observations do not count as independent frames', () => {
  for (const samples of [null, [], [{contour: [[NaN, 0]]}],
    [{id: 'same', contour: lens()}, {id: 'same', contour: lens()}, {id: 'same', contour: lens()}]]) {
    assert.throws(() => fuseContours(samples), {code: 'CONTOUR_FUSION_UNSTABLE'});
  }
  const samples = [...frames([{}, {}, {}]), {id: 'invalid', contour: [[Infinity, 1]]}];
  assert.equal(fuseContours(samples).diagnostics.rejectedFrames, 1);
});

test('bounded denoising retains sharp asymmetric corners and dimensions', () => {
  const shape = [[25, 21], [30, 17], [60, 15], [73, 20], [76, 35], [69, 48], [44, 53], [28, 43]];
  const result = fuseContours([0, 1, 2].map(id => ({id, contour: shape})));
  // Resampling and bounded smoothing cannot materially round off a real corner.
  assert.ok(Math.max(...shape.map(p => boundaryDistance(p, result.contour))) < 0.3);
  assert.ok(result.diagnostics.maxSmoothingMm <= 0.12);
  for (const axis of [0, 1]) {
    const span = points => Math.max(...points.map(p => p[axis])) - Math.min(...points.map(p => p[axis]));
    assert.ok(Math.abs(span(shape) - span(result.contour)) < 0.25);
  }
});

test('a persistent narrow shadow spike is rejected instead of silently rounded away', () => {
  const shape = lens();
  shape[90][1] += 1.2;
  assert.throws(() => fuseContours([0, 1, 2].map(id => ({id, contour: shape}))),
    /persistent spike/);
  const inward = lens();
  inward[90][1] -= 1.2;
  assert.throws(() => fuseContours([0, 1, 2].map(id => ({id, contour: inward}))),
    /persistent spike/);
});

test('resampling cannot hide a narrow feature located between angular rays', () => {
  for (const spike of [-1.2, 1.2]) {
    const shape = Array.from({length: 720}, (_, i) => {
      const angle = i * tau / 720, radius = 20 + (i === 1 ? spike : 0);
      return [50 + radius * Math.cos(angle), 35 + radius * Math.sin(angle)];
    });
    assert.throws(() => fuseContours([0, 1, 2].map(id => ({id, contour: shape}))),
      {code: 'CONTOUR_FUSION_UNSTABLE'});
  }
});

test('one frame with an unresolved inter-ray spike is discarded without losing good frames', () => {
  const samples = frames([{}, {}, {}]), bad = lens({count: 720});
  bad[1][0] += 1.2;
  samples.push({id: 'spike', contour: bad});
  const result = fuseContours(samples);
  assert.equal(result.diagnostics.acceptedFrames, 3);
  assert.deepEqual(result.diagnostics.rejectedIds, ['spike']);
  assert.ok(result.diagnostics.maxResamplingMm <= 0.12);
});
