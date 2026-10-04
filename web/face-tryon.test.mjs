import test from 'node:test';
import assert from 'node:assert/strict';
import { openFaceTryOn } from './face-tryon.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const assembly = { opticalCentres: [[-32, 0, 2.15], [30, 0, 2.15]], meshes: [{}] };

function environment(getUserMedia) {
  let pauses = 0, focus = 0;
  class Element extends EventTarget {
    constructor() { super(); this.dataset = {}; this.textContent = ''; this.isConnected = true; }
    setAttribute() {}
    appendChild() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
    remove() { this.removed = true; }
  }
  const video = new Element();
  video.pause = () => { pauses++; };
  video.play = () => new Promise(() => {});
  const status = new Element(), button = new Element(), stage = new Element(), dialog = new Element();
  dialog.querySelector = selector => ({ video, button, '.face-tryon-stage': stage, '.face-tryon-status': status })[selector];
  const doc = new Element();
  doc.activeElement = { isConnected: true, focus() { focus++; } };
  doc.querySelector = () => null;
  doc.createElement = tag => tag === 'dialog' ? dialog : new Element();
  doc.body = new Element(); doc.head = new Element();
  const values = { document: doc, window: new Element(), navigator: { mediaDevices: { getUserMedia } }, cancelAnimationFrame: () => {} };
  const original = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
  return { dialog, video, status, doc, get pauses() { return pauses; }, get focus() { return focus; }, restore() {
    for (const key of Object.keys(values)) { if (original[key]) Object.defineProperty(globalThis, key, original[key]); else delete globalThis[key]; }
  } };
}

test('closing before camera permission resolves stops every late camera track', async () => {
  const permission = deferred(); let stopped = 0;
  const env = environment(() => permission.promise);
  try {
    const close = await openFaceTryOn({ assembly });
    close(); close();
    permission.resolve({ getTracks: () => [{ stop() { stopped++; } }] });
    await flush();
    assert.equal(stopped, 1);
    assert.equal(env.dialog.removed, true);
    assert.equal(env.focus, 1);
    assert.equal(env.video.srcObject, null);
  } finally { env.restore(); }
});

test('hiding the page releases a camera even while video playback is still starting', async () => {
  let stopped = 0;
  const env = environment(async () => ({ getTracks: () => [{ stop() { stopped++; } }] }));
  try {
    await openFaceTryOn({ assembly });
    await flush();
    env.doc.hidden = true;
    env.doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(stopped, 1);
    assert.equal(env.video.srcObject, null);
    assert.equal(env.dialog.removed, true);
  } finally { env.restore(); }
});

test('permission rejection explains recovery without starting a model or trapping the dialog', async () => {
  const env = environment(async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); });
  let close;
  try {
    close = await openFaceTryOn({ assembly });
    await flush();
    assert.match(env.status.textContent, /Allow camera access in browser settings/);
    assert.equal(env.dialog.open, true);
    close();
    assert.equal(env.dialog.removed, true);
  } finally { close?.(); env.restore(); }
});
