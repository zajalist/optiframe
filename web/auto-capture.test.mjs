import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoCaptureGate } from './auto-capture.js';

const outline = Array.from({length: 80}, (_, i) => [50 + 25 * Math.cos(i * Math.PI / 40), 35 + 20 * Math.sin(i * Math.PI / 40)]);
const markers = [[0, 0], [1000, 0], [1000, 700], [0, 700]];
const sample = (t, extra = {}) => ({ presence: {detected: true}, brightness:180, quality: {score: .7, sharpness: 180},
  calibration: {markers, contour: outline}, sampledAt: t, now: t + 100, id: t, ...extra });
const span = (gate, start = 0, extra = {}) => [0, 300, 600, 900, 1200].map(t => gate.update(sample(start + t, extra)));

test('only a full stable span captures once; reset starts a new span', () => {
  const gate = createAutoCaptureGate();
  assert.deepEqual(span(gate).map(s => s.capture), [false, false, false, false, true]);
  assert.equal(gate.update(sample(1500)).capture, false);
  gate.reset();
  assert.equal(span(gate, 2000).at(-1).capture, true);
});

test('a stationary lens can capture at a realistic mobile inference cadence', () => {
  for (const latency of [650, 1050]) {
    const gate = createAutoCaptureGate();
    const decisions = Array.from({length: 6}, (_, i) => {
      const time = i * (latency + 80);
      return gate.update(sample(time, {now: time + latency}));
    });
    assert.ok(decisions.some(d => d.capture), `stable lens never captured with ${latency} ms requests`);
  }
});

test('absence, missing presence, blur, low quality, missing scale and dragging never capture', () => {
  for (const extra of [{presence: {detected: false}}, {presence: undefined},
    {quality: {score: .8, sharpness: 10}}, {quality: {score: .2, sharpness: 100}},
    {calibration: null}, {dragging: true}]) {
    assert.ok(span(createAutoCaptureGate(), 0, extra).every(s => !s.capture));
  }
});

test('duplicate observations, old frames and long gaps cannot count as stability', () => {
  const gate = createAutoCaptureGate();
  for (let t = 0; t <= 1800; t += 300) assert.equal(gate.update(sample(t, {id: 1})).capture, false);
  gate.reset();
  assert.ok(span(gate, 0, {now: 4000}).every(s => !s.capture));
  gate.reset();
  for (let t = 0; t <= 4000; t += 1000) assert.equal(gate.update(sample(t)).capture, false);
});

test('shape change with identical bounding box restarts stability', () => {
  const gate = createAutoCaptureGate();
  [0, 300, 600, 900].forEach(t => gate.update(sample(t)));
  const changed = outline.map((p, i) => i > 8 && i < 18 ? [p[0] - 3, p[1]] : p);
  assert.equal(gate.update(sample(1200, {calibration: {markers, contour: changed}})).capture, false);
  assert.equal(gate.update(sample(1500)).capture, false);
});

test('sheet movement and invalid lens dimensions reset the span', () => {
  const gate = createAutoCaptureGate();
  [0, 300, 600, 900].forEach(t => gate.update(sample(t)));
  assert.equal(gate.update(sample(1200, {calibration: {markers: markers.map(p => [p[0] + 25, p[1]]), contour: outline}})).capture, false);
  assert.ok(span(createAutoCaptureGate(), 0, {calibration: {markers, contour: outline.map(p => [p[0] * 2, p[1]])}}).every(s => !s.capture));
});

test('empty observation or network error resets accumulated stability', () => {
  const gate = createAutoCaptureGate();
  [0, 300, 600, 900].forEach(t => gate.update(sample(t)));
  gate.update(sample(1000, {presence: {detected: false}}));
  assert.equal(gate.update(sample(1200)).capture, false);
  gate.invalidate();
  assert.equal(gate.update(sample(2400)).capture, false);
});

test('second side requires sustained loss with visible sheet before new stable span', () => {
  const gate = createAutoCaptureGate();
  gate.reset({requireRemoval: true});
  assert.ok(span(gate).every(s => s.state === 'remove'));
  gate.update(sample(1300, {presence: {detected: false}, calibration: null}));
  assert.equal(gate.update(sample(1600)).state, 'remove');
  gate.update(sample(1800, {presence: {detected: false}}));
  assert.equal(gate.update(sample(2300, {presence: {detected: false}})).state, 'searching');
  assert.equal(span(gate, 2500).at(-1).capture, true);
});
test('blur or darkness is not evidence that the first lens was removed', () => {
  for (const extra of [{quality:{score:0,sharpness:5}}, {brightness:20}, {brightness:undefined}]) {
    const gate=createAutoCaptureGate(); gate.reset({requireRemoval:true});
    const result=span(gate,0,{presence:{detected:false},...extra});
    assert.ok(result.every(value=>value.state==='remove'));
    assert.equal(gate.update(sample(1600)).state,'remove');
  }
});
