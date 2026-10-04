import test from 'node:test';
import assert from 'node:assert/strict';
import { opticalAnchors, landmarkToView, facePose, frameRenderLayer } from './face-tryon-geometry.js';

test('approximate face depth only occludes temples, never cuts rims or bridge',()=>{
  for(const name of ['front','left-retainer','right-retainer','left-lens','right-lens','left-snap-pin-0'])assert.equal(frameRenderLayer({name}),1);
  assert.equal(frameRenderLayer({name:'left-temple'}),0);assert.equal(frameRenderLayer({name:'right-temple'}),0);
});

test('front-facing CAD references preserve different pupil distances and optical heights', () => {
  const anchors = opticalAnchors({ opticalCentres: [[-32, 3, 2.15], [29, -2, 2.15]] });
  assert.deepEqual(anchors.left, [32, 3, 2.15]);
  assert.deepEqual(anchors.right, [-29, -2, 2.15]);
  assert.deepEqual(anchors.centre, [1.5, .5, 2.15]);
  assert.equal(anchors.distance, Math.hypot(61, 5));
  assert.throws(() => opticalAnchors({ opticalCentres: [[NaN, 0, 0], [30, 0, 0]] }));
});

test('portrait centre-crop maps face landmarks to the same pixels as the camera video', () => {
  assert.deepEqual(landmarkToView({ x: .5, y: .5, z: 0 }, 640, 480, 390, 844), [0, 0, -0]);
  const p = landmarkToView({ x: .6, y: .4, z: -.02 }, 640, 480, 390, 844);
  assert.ok(Math.abs(p[0] - 112.5333333333) < 1e-8);
  assert.ok(Math.abs(p[1] - 84.4) < 1e-8);
  assert.ok(p[2] > 0);
});

test('pose is anchored by both eyes; absent, tiny or invalid faces cannot leave a frame visible', () => {
  const anchors = opticalAnchors({}, 32, 30), landmarks = Array.from({ length: 478 }, () => ({ x: .5, y: .5, z: 0 }));
  landmarks[468] = { x: .4, y: .5, z: 0 };
  landmarks[473] = { x: .6, y: .5, z: 0 };
  landmarks[10] = { x: .5, y: .25, z: 0 };
  landmarks[168] = { x: .5, y: .45, z: 0 };
  const pose = facePose(landmarks, anchors, [640, 480, 640, 480]);
  assert.ok(Math.abs(pose.scale - 128 / 62) < 1e-10);
  assert.deepEqual(pose.centre, [0, 0, -0]);
  assert.ok(pose.targetBasis[2][2] > .99);
  assert.equal(facePose([], anchors, [640, 480, 640, 480]), null);
  landmarks[473] = landmarks[468];
  assert.equal(facePose(landmarks, anchors, [640, 480, 640, 480]), null);
});
