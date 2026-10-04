import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { sheetHomography, project, measure } from './calibration.js';
import { photoReviewLayout } from './photo-review.js';
import { createApiFetch } from './api-fetch.js';

// Camera/review interaction fixtures start after approved access; entry ordering
// and rejection are exercised in app-access-order.test.mjs with the real gate.
const source = (await readFile(new URL('./simple.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace(/^await requireAppAccess\(\);\r?$/m,'');
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness({ cameraError = null, storageError = null, deferReads = false, search = '' } = {}) {
  const nodes = new Map();
  const imageDraws = [];
  const encodings = [];
  const drawing = new Proxy({drawImage(...args) { imageDraws.push(args); }}, { get: (object, key) => object[key] ?? (() => {}) });
  function element() {
    return { hidden: false, disabled: false, textContent: '', innerHTML: '', style: {}, handlers: {}, attributes: {},
      width: 1000, height: 700, clientWidth: 360, clientHeight: 450,
      classList: { toggle() {} }, getContext: () => drawing, querySelector: () => element(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 450 }),
      setAttribute(key, value) { this.attributes[key] = value; },
      toggleAttribute(key, value) { this.attributes[key] = value; if (key === 'hidden') this.hidden = value; },
      addEventListener(key, handler) { this.handlers[key] = handler; }, append() {}, setPointerCapture() {},
      toBlob(callback, type, quality) { encodings.push({width: this.width, height: this.height, type, quality}); callback(new Blob(['photo'], {type})); },
    };
  }
  const $ = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  let starts = 0, sounds = 0, replacements = 0, stops = 0, callbacks;
  const torchRequests = [], windowListeners = new Map();
  const startOptions = [];
  const ellipse = Array.from({ length: 80 }, (_, i) => [500 + 250 * Math.cos(i * Math.PI / 40), 350 + 200 * Math.sin(i * Math.PI / 40)]);
  const payload = { file: { name: 'lens.jpg' }, contour: ellipse, width: 1000, height: 700 };
  const controller = { async start(options) { starts++; startOptions.push(options); if (cameraError) throw new Error(cameraError); callbacks.onRemovalChange?.(Boolean(options.requireRemoval)); $('controller-capture').disabled = false; },
    stop() { stops++; callbacks.onRemovalChange?.(false); },
    async setTorch(enabled) { torchRequests.push(enabled); },
    confirmLensChanged() { replacements++; callbacks.onRemovalChange(false); return true; },
    async capture() { return callbacks.onCapture(payload); } };
  class AudioContext {
    state = 'suspended'; currentTime = 0;
    async resume() { this.state = 'running'; }
    createOscillator() { return { frequency: { setValueAtTime() {} }, connect() {}, disconnect() {}, start() { sounds++; }, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  }
  const body = { dataset: {} };
  const storage = new Map(), pendingReads = [];
  const location = {hash:'#access=test-key',href:'',search};
  class FileReader {
    readAsDataURL() {
      const done = () => { this.result = 'data:image/jpeg;base64,test'; this.onload(); };
      if (deferReads) pendingReads.push(done); else queueMicrotask(done);
    }
  }
  const context = vm.createContext({
    document: { getElementById: $, createElement: element, body },
    window: { addEventListener(name,callback) { windowListeners.set(name,callback); }, AudioContext }, location, FileReader,
    URLSearchParams, Blob, File, FormData, DOMException, performance,
    sheetHomography, project, measure, photoReviewLayout,
    detectSheetMarkers: () => [[0, 0], [1000, 0], [1000, 700], [0, 700]],
    createLiveSegmentSession(options) { callbacks = options; return controller; },
    createImageBitmap: async () => ({ width: 1000, height: 700, close() {} }),
    ResizeObserver: class { observe() {} }, MutationObserver: class { observe() {} },
    requestAnimationFrame: callback => callback(), fetch() {}, sessionStorage: { setItem(key,value) { if(storageError) throw new Error(storageError); storage.set(key,value); } },
  });
  context.apiFetch=createApiFetch({fetcher:(...args)=>context.fetch(...args),
    location:{...location,href:'https://optiframe.test/index.html',origin:'https://optiframe.test'}});
  vm.runInContext(source, context);
  return { $, body, payload, context, storage, location, pendingReads, startOptions, imageDraws, encodings, torchRequests, windowListeners, get stops() {return stops;}, get replacements() { return replacements; }, get controllerOptions() { return callbacks; }, get starts() { return starts; }, get sounds() { return sounds; },
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

test('guided sweep is explicitly selected by the test link', () => {
  assert.equal(harness().controllerOptions.viewSweep, false);
  assert.equal(harness({search:'?capture=sweep&v=24'}).controllerOptions.viewSweep, true);
});

test('slow GPU scanner accepts a delayed proposal and refines one fresh still', () => {
  const app=harness();
  const options=app.controllerOptions;
  assert.ok(options.requestTimeoutMs>11000);
  assert.ok(options.maxResultAgeMs>11000);
  const still=options.captureFrame({videoWidth:1920,videoHeight:1080,readyState:4,currentTime:12.5});
  assert.equal(still.canvas.width,1600);
  assert.equal(still.canvas.height,900);
  assert.equal(still.frames,undefined,'the slow single-GPU path must avoid a timed-out burst');
});

test('flashlight control is shown in every live camera session and reflects supported, busy, and unavailable states',async()=>{
  const app=harness();await tick();
  assert.equal(app.$('torch-toggle').hidden,false);assert.equal(app.$('torch-toggle').disabled,true);
  assert.equal(app.$('torch-label').textContent,'No flash');
  app.click('torch-toggle');assert.deepEqual(app.torchRequests,[]);
  app.controllerOptions.onTorchChange({supported:true,enabled:true,busy:false,error:''});
  assert.equal(app.$('torch-label').textContent,'Flash on');
  assert.equal(app.$('torch-toggle').attributes['aria-pressed'],'true');
  assert.equal(app.$('torch-note').hidden,true);
  app.click('torch-toggle');assert.deepEqual(app.torchRequests,[false]);
  app.controllerOptions.onTorchChange({supported:true,enabled:true,busy:true,error:''});
  assert.equal(app.$('torch-toggle').disabled,true);
  app.click('torch-toggle');assert.deepEqual(app.torchRequests,[false]);
  await app.accept(app.payload);assert.equal(app.$('torch-toggle').hidden,true);
});

test('backgrounding an enabled or changing flashlight stops the camera in normal mode',async()=>{
  for(const state of [{enabled:true,busy:false},{enabled:false,busy:true}]){
    const app=harness();await tick();app.controllerOptions.onTorchChange({supported:true,error:'',...state});
    const before=app.stops;app.context.document.hidden=true;app.windowListeners.get('visibilitychange')();
    assert.equal(app.stops,before+1);assert.equal(app.body.dataset.phase,'idle');assert.equal(app.$('torch-toggle').hidden,true);
  }
});

test('second lens proceeds automatically after an empty sheet without an extra placement button', async () => {
  const app=harness(); await tick();
  await app.accept(app.payload); app.click('primary'); await tick();
  assert.equal(app.body.dataset.phase,'remove');
  assert.equal(app.$('headline').textContent,'Remove left lens');
  assert.equal(app.$('remove-overlay').hidden,false);
  assert.equal(app.$('photo-label').hidden,false,'photo import remains available for the right lens');
  assert.equal(app.startOptions[1].requireRemoval,true);
  // Live segmentation handles the empty-sheet transition without UI intervention.
  app.controllerOptions.onRemovalChange?.(false);
  assert.equal(app.body.dataset.phase,'live');
  assert.equal(app.$('headline').textContent,'Right lens');
  assert.equal(app.$('remove-overlay').hidden,true);
  assert.equal(app.replacements,0); assert.equal(app.starts,2);
  await app.accept(app.payload); app.click('primary');
  assert.equal(app.body.dataset.phase,'pair');
});

test('stalled empty-sheet detection has an explicit fallback without bypassing right-lens checks', async () => {
  const app=harness(); await tick();
  await app.accept(app.payload); app.click('primary'); await tick();
  assert.equal(app.body.dataset.phase,'remove');
  app.click('remove-confirm');
  assert.equal(app.replacements,1);
  assert.equal(app.body.dataset.phase,'live');
  assert.equal(app.$('headline').textContent,'Right lens');
  assert.equal(app.$('remove-overlay').hidden,true);
  app.click('remove-confirm');
  assert.equal(app.replacements,1,'the fallback only runs during removal');
  const markup=await readFile(new URL('./index.html',import.meta.url),'utf8');
  assert.match(markup,/id="remove-confirm"/);
  assert.doesNotMatch(markup,/lens-placed|Second lens placed/);
});

async function confirmPair(app) {
  await tick();
  await app.accept(app.payload); app.click('primary'); await tick();
  app.controllerOptions.onRemovalChange?.(false);
  await app.accept(app.payload); app.click('primary');
}

test('confirmed pair transfers actual photos, pixel contours and calibration to studio with access key', async () => {
  const app = harness();
  await confirmPair(app);
  app.click('primary'); await tick();
  assert.equal(app.location.href, '/studio.html#access=test-key');
  const saved = JSON.parse(app.storage.get('optiframe-captures'));
  assert.deepEqual(saved.map(item=>item.side), ['left','right']);
  assert.deepEqual(saved[0].contour, app.payload.contour);
  assert.deepEqual(saved[1].markers, [[0,0],[1000,0],[1000,700],[0,700]]);
  assert.equal(saved[0].opticalCentre, undefined);
  assert.equal(saved[0].topMark, undefined);
});

test('rectified burst evidence survives confirmation and transfer alongside the refined contour', async()=>{
 const app=harness();
 const evidence={method:'rectified-radial-median',acceptedFrames:4,maxSmoothingMm:.1,
  rawContours:[{id:1,contour:[[20,20],[40,20],[40,40]]}]};
 app.payload.refinement=evidence;
 await confirmPair(app);app.click('primary');await tick();
 const saved=JSON.parse(app.storage.get('optiframe-captures'));
 assert.deepEqual(saved[0].refinement,evidence);
 assert.deepEqual(saved[0].contour,app.payload.contour);
});

test('retry during transfer cancels stale navigation, and storage errors leave the pair retryable', async () => {
  const app = harness({deferReads:true});
  await confirmPair(app);
  app.click('primary'); app.click('retry-left');
  app.pendingReads.forEach(done=>done()); await tick();
  assert.equal(app.location.href,'');
  assert.equal(app.storage.size,0);
  assert.equal(app.body.dataset.phase,'live');
  const blocked = harness({storageError:'Storage is full'});
  await confirmPair(blocked);
  blocked.click('primary'); await tick();
  assert.equal(blocked.location.href,'');
  assert.equal(blocked.$('primary').disabled,false);
  assert.match(blocked.$('status').textContent,/Storage is full/);
});

test('a captured image finishing decoding after retake cannot replace the new camera session', async () => {
  const app = harness();
  await tick();
  let finish, closed = 0;
  app.context.createImageBitmap = () => new Promise(resolve => { finish = resolve; });
  const old = app.accept(app.payload);
  app.click('retry-left');
  await tick();
  finish({width:1000,height:700,close(){closed++;}});
  await old;
  assert.equal(closed,1);
  assert.equal(app.body.dataset.phase,'live');
  assert.equal(app.$('result-svg').hidden,true);
});

test('guided capture requires both confirmations, displays both contours, and retry preserves the other lens', async () => {
  const app = harness();
  await tick();
  assert.equal(app.body.dataset.phase, 'live');
  assert.equal(app.$('headline').textContent, 'Left lens');
  assert.equal(app.$('primary').hidden, true);
  assert.equal(app.$('photo-label').hidden, false);
  app.click('photo-label'); // Unlock optional sound with a real user gesture.
  await app.accept(app.payload);
  await tick();
  assert.equal(app.body.dataset.phase, 'result');
  assert.equal(app.sounds, 1);
  assert.equal(app.$('result-photo').hidden, false);
  assert.equal(app.$('result-svg').hidden, true);
  assert.equal(app.$('review-switch').hidden, false);
  app.click('review-outline');
  assert.equal(app.$('result-svg').hidden, false);
  assert.equal(app.$('result-photo').hidden, true);
  assert.match(app.$('result-path').attributes.d, /^M.+ Z$/);
  assert.equal(app.$('headline').textContent, 'Left lens');
  assert.equal(app.$('instruction').textContent, '');
  assert.equal(app.$('status').textContent, '');
  assert.match(app.$('result-dimensions').innerHTML, /50\.0 mm/);
  assert.match(app.$('result-dimensions').innerHTML, /40\.0 mm/);
  app.click('primary');
  await tick();
  assert.equal(app.starts, 2);
  assert.equal(app.body.dataset.phase, 'remove');
  assert.equal(app.$('headline').textContent, 'Remove left lens');
  assert.equal(app.startOptions[1].requireRemoval, true);
  assert.equal(app.$('primary').hidden, true);
  app.controllerOptions.onRemovalChange?.(false);
  assert.equal(app.body.dataset.phase, 'live');
  assert.equal(app.$('headline').textContent, 'Right lens');
  await app.accept(app.payload);
  await tick();
  assert.equal(app.body.dataset.phase, 'result');
  assert.equal(app.$('pair-results').hidden, true);
  assert.equal(app.$('result-photo').hidden, false);
  assert.equal(app.$('result-svg').hidden, true);
  assert.equal(app.$('review-photo').attributes['aria-pressed'], 'true');
  app.click('primary');
  assert.equal(app.body.dataset.phase, 'pair');
  assert.equal(app.$('pair-results').hidden, false);
  assert.equal(app.$('review-switch').hidden, true);
  assert.match(app.$('left-path').attributes.d, /^M.+ Z$/);
  assert.match(app.$('right-path').attributes.d, /^M.+ Z$/);
  assert.match(app.$('left-dimensions').innerHTML, /50\.0 mm/);
  assert.match(app.$('right-dimensions').innerHTML, /40\.0 mm/);
  assert.equal(app.$('status').textContent, '');
  app.click('retry-left');
  await tick();
  assert.equal(app.$('headline').textContent, 'Left lens');
  await app.accept(app.payload);
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

test('retaking clears the photo preview and draws the new capture instead of stale pixels', async () => {
  const app = harness();
  await tick();
  const first = {width: 1000, height: 700, close() {}}, second = {width: 1000, height: 700, close() {}};
  app.context.createImageBitmap = async () => first;
  await app.accept(app.payload);
  assert.equal(app.imageDraws.filter(args => args.length === 9).at(-1)[0], first);
  app.click('review-outline');
  app.click('secondary');
  await tick();
  assert.equal(app.$('result-photo').width, 1);
  assert.equal(app.$('result-photo').hidden, true);
  app.context.createImageBitmap = async () => second;
  await app.accept(app.payload);
  assert.equal(app.imageDraws.filter(args => args.length === 9).at(-1)[0], second);
  assert.equal(app.$('result-photo').hidden, false);
  assert.equal(app.$('result-svg').hidden, true);
});

test('photo import uses the refined endpoint and preserves original-image edge evidence', async () => {
  const app = harness(); await tick();
  const requests = [], raw = app.payload.contour.map(([x, y]) => [x + 1, y]);
  const diagnostics = {accepted: true, method: 'local-image-edge-dp', supportedSectors: 12};
  app.context.fetch = async (url, options) => {
    requests.push({url, options});
    return {ok: true, async json() { return {width: 1000, height: 700, contour: app.payload.contour,
      presence: {detected: true}, rawContour: raw, edgeRefinement: diagnostics}; }};
  };
  await app.context.selectPhoto(new File(['input'], 'original.jpg', {type: 'image/jpeg'}));
  assert.equal(requests[0].url, '/api/live-segment');
  assert.equal(requests[0].options.headers.get('X-OptiFrame-Key'), 'test-key');
  assert.equal(app.encodings[0].quality, .95);
  assert.equal(app.body.dataset.phase, 'result');
  assert.equal(app.$('result-photo').hidden, false);
  app.click('primary'); await tick();
  await app.accept(app.payload); app.click('primary'); app.click('primary'); await tick();
  const saved = JSON.parse(app.storage.get('optiframe-captures'))[0];
  assert.deepEqual(saved.contour, app.payload.contour);
  assert.deepEqual(saved.refinement.rawReferenceContour, raw);
  assert.deepEqual(saved.refinement.edgeRefinement, diagnostics);
  assert.equal(saved.refinement.acceptedFrames, 1);
});

test('photo import rejects absent, unrefined, malformed and mismatched results without raw fallback', async () => {
  for (const problem of [
    {presence: {detected: false}}, {edgeRefinement: {accepted: false}},
    {contour: [[NaN, 3]]}, {width: 999},
  ]) {
    const app = harness(); await tick();
    app.context.fetch = async () => ({ok: true, async json() { return {width: 1000, height: 700,
      contour: app.payload.contour, rawContour: app.payload.contour,
      candidates: [{method: 'sam2.1-hiera-small-cuda', contour: app.payload.contour}],
      presence: {detected: true}, edgeRefinement: {accepted: true}, ...problem}; }});
    await app.context.selectPhoto(new File(['input'], 'original.jpg', {type: 'image/jpeg'}));
    assert.equal(app.body.dataset.phase, 'aim');
    assert.equal(app.$('primary').hidden, true);
    assert.equal(app.$('result-photo').hidden, true);
  }
});

test('photo import retains up to 1600 pixels and submits the same encoded image it displays', async () => {
  const app = harness(); await tick();
  let decodes = 0, posted;
  app.context.createImageBitmap = async () => (++decodes === 1
    ? {width: 2400, height: 1680, close() {}}
    : {width: 1600, height: 1120, close() {}});
  app.context.fetch = async (url, options) => {
    posted = options.body.get('image');
    return {ok: true, async json() { return {width: 1600, height: 1120,
      contour: app.payload.contour, rawContour: app.payload.contour,
      presence: {detected: true}, edgeRefinement: {accepted: true}}; }};
  };
  await app.context.selectPhoto(new File(['original'], 'large.jpg', {type: 'image/jpeg'}));
  assert.deepEqual(app.encodings[0], {width: 1600, height: 1120, type: 'image/jpeg', quality: .95});
  assert.equal(await posted.text(), 'photo');
  assert.equal(app.body.dataset.phase, 'result');
});
