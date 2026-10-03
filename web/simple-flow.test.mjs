import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { sheetHomography, project, measure } from './calibration.js';

const source = (await readFile(new URL('./simple.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness({ cameraError = null } = {}) {
  const nodes = new Map();
  const drawing = new Proxy({}, { get: (object, key) => object[key] ?? (() => {}) });
  function element() {
    return { hidden: false, disabled: false, textContent: '', innerHTML: '', style: {}, handlers: {}, attributes: {},
      width: 1000, height: 700, clientWidth: 360, clientHeight: 450,
      classList: { toggle() {} }, getContext: () => drawing, querySelector: () => element(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 450 }),
      setAttribute(key, value) { this.attributes[key] = value; },
      toggleAttribute(key, value) { this.attributes[key] = value; if (key === 'hidden') this.hidden = value; },
      addEventListener(key, handler) { this.handlers[key] = handler; }, append() {}, setPointerCapture() {},
    };
  }
  const $ = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  let starts = 0, sounds = 0, callbacks;
  const ellipse = Array.from({ length: 80 }, (_, i) => [500 + 250 * Math.cos(i * Math.PI / 40), 350 + 200 * Math.sin(i * Math.PI / 40)]);
  const payload = { file: { name: 'lens.jpg' }, contour: ellipse, width: 1000, height: 700 };
  const controller = { async start() { starts++; if (cameraError) throw new Error(cameraError); $('controller-capture').disabled = false; },
    stop() {}, async capture() { return callbacks.onCapture(payload); } };
  class AudioContext {
    state = 'suspended'; currentTime = 0;
    async resume() { this.state = 'running'; }
    createOscillator() { return { frequency: { setValueAtTime() {} }, connect() {}, disconnect() {}, start() { sounds++; }, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  }
  const body = { dataset: {} };
  const context = vm.createContext({
    document: { getElementById: $, createElement: element, body },
    window: { addEventListener() {}, AudioContext }, location: { hash: '', href: '' },
    URLSearchParams, sheetHomography, project, measure,
    detectSheetMarkers: () => [[0, 0], [1000, 0], [1000, 700], [0, 700]],
    createLiveSegmentSession(options) { callbacks = options; return controller; },
    createImageBitmap: async () => ({ width: 1000, height: 700, close() {} }),
    ResizeObserver: class { observe() {} }, MutationObserver: class { observe() {} },
    requestAnimationFrame: callback => callback(), fetch() {}, sessionStorage: { setItem() {} },
  });
  vm.runInContext(source, context);
  return { $, body, payload, context, get starts() { return starts; }, get sounds() { return sounds; },
    accept: value => callbacks.onCapture(value), click: id => $(id).handlers.click?.({ preventDefault() {} }) };
}

test('camera requests access on load and a failed request keeps photo import and retry available', async () => {
  const app = harness({ cameraError: 'Permission denied' });
  await tick();
  assert.equal(app.starts, 1);
  assert.equal(app.body.dataset.phase, 'idle');
  assert.equal(app.$('camera-retry').hidden, false);
  assert.equal(app.$('photo-label').hidden, false);
  assert.equal(app.sounds, 0);
  app.click('camera-retry');
  await tick();
  assert.equal(app.starts, 2);
});

test('guided capture requires both confirmations, displays both contours, and retry preserves the other lens', async () => {
  const app = harness();
  await tick();
  assert.equal(app.body.dataset.phase, 'live');
  app.click('primary');
  await tick();
  assert.equal(app.body.dataset.phase, 'result');
  assert.equal(app.sounds, 1);
  assert.equal(app.$('result-svg').hidden, false);
  assert.match(app.$('result-path').attributes.d, /^M.+ Z$/);
  assert.equal(app.$('headline').textContent, 'Left lens');
  assert.equal(app.$('instruction').textContent, '');
  assert.equal(app.$('status').textContent, '');
  assert.match(app.$('result-dimensions').innerHTML, /50\.0 mm/);
  assert.match(app.$('result-dimensions').innerHTML, /40\.0 mm/);
  app.click('primary');
  await tick();
  assert.equal(app.starts, 2);
  assert.equal(app.body.dataset.phase, 'live');
  assert.equal(app.$('headline').textContent, 'Second lens');
  app.click('primary');
  await tick();
  assert.equal(app.body.dataset.phase, 'result');
  assert.equal(app.$('pair-results').hidden, true);
  app.click('primary');
  assert.equal(app.body.dataset.phase, 'pair');
  assert.equal(app.$('pair-results').hidden, false);
  assert.match(app.$('left-path').attributes.d, /^M.+ Z$/);
  assert.match(app.$('right-path').attributes.d, /^M.+ Z$/);
  assert.match(app.$('left-dimensions').innerHTML, /50\.0 mm/);
  assert.match(app.$('right-dimensions').innerHTML, /40\.0 mm/);
  assert.equal(app.$('status').textContent, '');
  app.click('retry-left');
  await tick();
  assert.equal(app.$('headline').textContent, 'First lens');
  app.click('primary');
  await tick();
  app.click('primary');
  assert.equal(app.body.dataset.phase, 'pair');
  assert.equal(app.starts, 3);
});

test('an invalid sheet-sized contour cannot produce a measurement confirmation or validation sound', async () => {
  const app = harness();
  await tick();
  app.$('photo-label').handlers.click();
  await app.accept({ ...app.payload, contour: Array.from({ length: 80 }, (_, i) => [500 + 520 * Math.cos(i * Math.PI / 40), 350 + 390 * Math.sin(i * Math.PI / 40)]) });
  assert.equal(app.body.dataset.phase, 'aim');
  assert.equal(app.sounds, 0);
  assert.equal(app.$('primary').hidden, true);
  assert.equal(app.$('result-svg').hidden, true);
  // The displayed photo preserves its aspect and fits the stage so pointer coordinates stay exact.
  assert.equal(app.$('review-canvas').style.width, '360px');
  assert.equal(app.$('review-canvas').style.height, '252px');
});
