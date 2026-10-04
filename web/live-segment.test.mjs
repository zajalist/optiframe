import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./live-segment.js', import.meta.url), 'utf8');
test('live camera draws no prompt rectangle', () => {
  assert.doesNotMatch(source, /context\.strokeRect/);
});
const { createLiveSegmentSession } = await import('./live-segment.js');

function element() {
  const handlers = {};
  return {
    handlers, disabled: false, width: 0, height: 0, textContent: '',
    addEventListener(type, listener) { handlers[type] = listener; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 480 }; },
    setPointerCapture() {},
    getContext() {
      return { clearRect() {}, strokeRect() {}, setLineDash() {}, beginPath() {},
        save() {}, restore() {}, arc() {}, fill() {},
        moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, drawImage() {},
        getImageData() { return { data: new Uint8ClampedArray(this.width * this.height * 4) }; } };
    },
  };
}

function setup(fetcher, onCapture = async () => {}, options = {}) {
  globalThis.document = {
    createElement() {
      return { width: 0, height: 0, getContext: () => ({ drawImage() {},
        getImageData: () => ({ data: new Uint8ClampedArray(160 * 120 * 4).fill(180) }) }),
        toBlob(callback) { callback(new Blob(['frame'], { type: 'image/jpeg' })); } };
    },
  };
  const video = { videoWidth: 640, videoHeight: 480, srcObject: null,
    play: options.play || (async () => {}), pause() {} };
  const overlay = element();
  const status = element();
  const captureButton = element();
  let stopped = 0;
  const mediaDevices = options.mediaDevices || { getUserMedia: async () => ({
    getTracks: () => [{ stop() { stopped++; } }],
  }) };
  const session = createLiveSegmentSession({ video, overlay, status, captureButton,
    onCapture, apiFetch: fetcher, mediaDevices, side: 'left', intervalMs: 5,
    startupTimeoutMs: options.startupTimeoutMs ?? 12000, locateTarget: options.locateTarget,
    requestTimeoutMs: options.requestTimeoutMs ?? 8000, maxResultAgeMs: options.maxResultAgeMs ?? 2000,
    autoCapture: options.autoCapture, calibrateFrame: options.calibrateFrame,
    stillCapture: options.stillCapture ?? false, captureFrame: options.captureFrame });
  return { session, video, overlay, status, captureButton, get stopped() { return stopped; } };
}

const result = { width: 640, height: 480, contour: [[10, 10], [100, 10], [100, 100]],
  quality: { score: 0.7 }, method: 'sam2.1-hiera-small-cuda' };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const autoOutline = Array.from({length: 80}, (_, i) => [50 + 25 * Math.cos(i * Math.PI / 40), 35 + 20 * Math.sin(i * Math.PI / 40)]);
const autoOptions = {autoCapture: true, calibrateFrame: () => ({markers: [[80,50],[560,50],[560,386],[80,386]], contour: autoOutline})};

test('small preview edge jitter triggers a separately measured sharp still instead of holding forever', {timeout: 4000}, async () => {
  let captured = null, calls = 0, bursts = 0;
  const fixture = setup(async () => {
    calls++; await pause(240);
    return {ok:true,json:async()=>({...result,presence:{detected:true},quality:{score:.7,sharpness:180}})};
  }, value => {captured=value;}, {...autoOptions, stillCapture:true,
    calibrateFrame: () => ({...autoOptions.calibrateFrame(), contour:autoOutline.map(([x,y])=>[x+(calls%2)*.9,y])}),
    captureFrame: async () => { bursts++; const canvas=document.createElement('canvas'); canvas.width=640;canvas.height=480;
      return {canvas,sharpness:200,sampledAt:performance.now(),capturedAt:new Date().toISOString()}; }});
  try {
    await fixture.session.start(); await pause(1600);
    assert.ok(captured, 'small SAM edge jitter must not prevent taking a separate sharp still');
    assert.equal(bursts,1); assert.equal(captured.source,'sharp-still');
    assert.ok(calls>=3, 'final still needs its own model response');
  } finally { fixture.session.stop(); }
});

test('a good preview never substitutes for a blurry or missing lens in the final still', {timeout:5000}, async () => {
  for (const invalid of [{presence:{detected:false},contour:[]}, {quality:{score:.7,sharpness:5}}]) {
    let captured=null, still=false;
    const fixture=setup(async()=>({ok:true,json:async()=>({...result,presence:{detected:true},quality:{score:.7,sharpness:180},...(still?invalid:{})})}),
      value=>{captured=value;},{...autoOptions,stillCapture:true,captureFrame:async()=>{
        still=true;const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
        return {canvas,sampledAt:performance.now(),capturedAt:new Date().toISOString()};
      }});
    try {await fixture.session.start();await pause(750);assert.equal(still,true);assert.equal(captured,null);assert.equal(fixture.session.active,true);}
    finally {fixture.session.stop();}
  }
});

test('final still is independently segmented and its exact JPEG and coordinates reach review', {timeout:3000}, async () => {
  let captured, sentStill, still=false;
  const finalContour=result.contour.map(([x,y])=>[x*2,y*2]);
  const fixture=setup(async(_path,options)=>{
    if(still)sentStill=options.body.get('image');
    return {ok:true,json:async()=>({...result,width:still?1280:640,height:still?960:480,
      contour:still?finalContour:result.contour,presence:{detected:true},quality:{score:.7,sharpness:180}})};
  },value=>{captured=value;},{...autoOptions,stillCapture:true,captureFrame:async()=>{
    still=true;const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=960;
    canvas.toBlob=callback=>callback(new Blob(['original-sharp-photo'],{type:'image/jpeg'}));
    return {canvas,sampledAt:performance.now(),capturedAt:'2026-10-03T12:00:00Z'};
  }});
  try {await fixture.session.start();await pause(650);assert.ok(captured);assert.equal(await captured.file.text(),await sentStill.text());
    assert.equal(captured.width,1280);assert.deepEqual(captured.contour,finalContour);assert.equal(captured.capturedAt,'2026-10-03T12:00:00Z');}
  finally {fixture.session.stop();}
});

test('burst frames are independently measured and fused in sheet millimetres', {timeout:4000}, async () => {
  let captured, still=false, measured=0;
  const fixture=setup(async(path,options)=>{
    const data={...result,presence:{detected:true},quality:{score:.7,sharpness:180}};
    if(path==='/api/segment-burst') {
      measured+=options.body.getAll('images').length;
      return {ok:true,json:async()=>({frames:Array.from({length:5},()=>data)})};
    }
    return {ok:true,json:async()=>data};
  },value=>{captured=value;},{...autoOptions,stillCapture:true,captureFrame:async()=>{
    still=true;
    const frames=Array.from({length:5},(_,id)=>{
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
      return {canvas,id,sampledAt:performance.now()+id,capturedAt:new Date().toISOString()};
    });
    return {...frames[0],frames};
  }});
  try {await fixture.session.start();await pause(850);
    assert.equal(measured,5);assert.equal(captured.source,'multi-frame');
    assert.equal(captured.refinement.acceptedFrames,5);assert.equal(captured.refinement.rawContours.length,5);
    assert.ok(captured.contour.length>=128);
  } finally {fixture.session.stop();}
});

test('disagreeing burst contours cannot export a plausible averaged result', {timeout:4000}, async () => {
  let captured=null, still=false, measured=0, calibrationIndex=0;
  const fixture=setup(async(path)=>{
    const data={...result,presence:{detected:true},quality:{score:.7,sharpness:180}};
    if(path==='/api/segment-burst') {measured+=5;return {ok:true,json:async()=>({frames:Array.from({length:5},()=>data)})};}
    return {ok:true,json:async()=>data};
  },value=>{captured=value;},{...autoOptions,stillCapture:true,
    calibrateFrame:()=>{const dx=still?++calibrationIndex*2:0;return {...autoOptions.calibrateFrame(),contour:autoOutline.map(([x,y])=>[x+dx,y])};},
    captureFrame:async()=>{
      still=true; const frames=Array.from({length:5},(_,id)=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
        return {canvas,id,sampledAt:performance.now()+id,capturedAt:new Date().toISOString()};});
      return {...frames[0],frames};
    }});
  try {await fixture.session.start();await pause(700);assert.ok(measured>=5);assert.equal(captured,null);assert.equal(fixture.session.active,true);}
  finally {fixture.session.stop();}
});

test('automatic mode stays live without an outline for absent or legacy presence', async () => {
  for (const presence of [undefined, {detected:false}]) {
    let captured = 0;
    const fixture = setup(async () => ({ok:true,json:async()=>({...result,presence,contour:presence?[]:result.contour})}),
      async()=>{captured++;}, autoOptions);
    await fixture.session.start(); await pause(20);
    assert.equal(captured,0); assert.equal(fixture.captureButton.disabled,true);
    assert.equal(fixture.status.textContent,''); assert.equal(fixture.session.active,true);
    await assert.rejects(fixture.session.capture(),/automatic capture/);
    fixture.session.stop();
  }
});

test('automatic capture uses the qualifying current frame and waits for actual stability', async () => {
  let calls = 0, captured = null, last;
  const fixture = setup(async () => {
    calls++;
    last = {...result, presence:{detected:true}, contour:result.contour.map(([x,y])=>[x + calls/100,y]), quality:{score:calls===1?.95:.7,sharpness:180}};
    return {ok:true,json:async()=>last};
  }, async value => {captured = value;}, autoOptions);
  await fixture.session.start(); await pause(700);
  assert.equal(captured,null);
  await pause(600);
  assert.ok(captured); assert.deepEqual(captured.contour,last.contour);
  assert.equal(captured.quality.score,.7); assert.equal(fixture.session.active,false);
  assert.deepEqual(captured.markers,autoOptions.calibrateFrame().markers);
});

test('automatic capture survives serial phone latency and overlay expiry between replies', {timeout: 7000}, async () => {
  let captured = null;
  const fixture = setup(async () => {
    await pause(1050);
    return {ok:true,json:async()=>({...result,presence:{detected:true},quality:{score:.7,sharpness:180}})};
  }, async value => {captured=value;}, autoOptions);
  try {
    await fixture.session.start();
    await pause(4800);
    assert.ok(captured, 'a clear stationary lens never reached the capture callback');
    assert.equal(fixture.session.active,false);
    assert.ok(captured.latencyMs>=1000);
  } finally { fixture.session.stop(); }
});

test('captures the same JPEG and contour as the best completed segmentation', async () => {
  let sent = 0;
  let captured;
  const fixture = setup(async (path, options) => {
    assert.equal(path, '/api/live-segment');
    assert.equal(options.method, 'POST');
    sent++;
    return { ok: true, json: async () => result };
  }, async value => { captured = value; });
  await fixture.session.start();
  await pause(2);
  assert.ok(sent >= 1);
  assert.equal(fixture.captureButton.disabled, false);
  const payload = await fixture.session.capture();
  assert.equal(payload, captured);
  assert.equal(payload.file.type, 'image/jpeg');
  assert.deepEqual(payload.contour, result.contour);
  assert.equal(payload.width, 640);
  assert.equal(payload.source, 'live-segmentation');
  assert.ok(payload.capturedAt);
  assert.ok(payload.latencyMs >= 0);
  assert.equal(fixture.stopped, 1);
  assert.equal(fixture.video.srcObject, null);
});

test('sends one request at a time and invalidates stale prompts', async () => {
  let resolveFirst;
  let calls = 0;
  let box;
  const fixture = setup(async (_path, options) => {
    calls++;
    box = JSON.parse(options.body.get('box'));
    if (calls === 1) return new Promise(resolve => { resolveFirst = resolve; });
    return { ok: true, json: async () => result };
  });
  await fixture.session.start();
  await pause(20);
  assert.equal(calls, 1);
  assert.deepEqual(box, [192, 153, 448, 327]);
  fixture.session.setBoxNormalized([0.1, 0.1, 0.9, 0.9]);
  resolveFirst({ ok: true, json: async () => result });
  await pause(15);
  assert.ok(calls >= 2);
  assert.equal(fixture.captureButton.disabled, false);
  fixture.session.stop();
  assert.equal(fixture.stopped, 1);
});

test('a tap recentres the live prompt on the lens', async () => {
  const boxes = [];
  const fixture = setup(async (_path, options) => {
    boxes.push(JSON.parse(options.body.get('box')));
    return { ok: true, json: async () => result };
  });
  await fixture.session.start();
  fixture.overlay.handlers.pointerdown({ clientX: 320, clientY: 240, pointerId: 1 });
  fixture.overlay.handlers.pointerup({ clientX: 480, clientY: 240, pointerId: 1 });
  await pause(20);
  assert.ok(boxes.some(([left, , right]) => (left + right) / 2 > 400));
  fixture.session.stop();
});

test('sheet detection locates an off-centre lens without a tap', async () => {
  const boxes = [];
  const fixture = setup(async (_path, options) => {
    boxes.push(JSON.parse(options.body.get('box')));
    return { ok: true, json: async () => result };
  }, async () => {}, { locateTarget: () => [0.25, 0.15, 0.65, 0.45] });
  await fixture.session.start();
  await pause(15);
  assert.deepEqual(boxes[0], [160, 72, 416, 216]);
  fixture.session.setBoxNormalized([0.1, 0.2, 0.4, 0.5]);
  await pause(15);
  assert.deepEqual(boxes.at(-1), [64, 96, 256, 240]);
  fixture.session.stop();
});

test('dragging the precision target uses its release position', async () => {
  const boxes = [];
  const fixture = setup(async (_path, options) => {
    boxes.push(JSON.parse(options.body.get('box')));
    return { ok: true, json: async () => result };
  });
  await fixture.session.start();
  fixture.overlay.handlers.pointerdown({ clientX: 160, clientY: 320, pointerType: 'touch', pointerId: 1 });
  fixture.overlay.handlers.pointermove({ clientX: 480, clientY: 240, pointerType: 'touch', pointerId: 1 });
  fixture.overlay.handlers.pointerup({ clientX: 480, clientY: 240, pointerType: 'touch', pointerId: 1 });
  await pause(20);
  assert.ok(boxes.some(([left, top, right, bottom]) =>
    (left + right) / 2 > 400 && (top + bottom) / 2 < 220));
  fixture.session.stop();
});

test('falls back once on 404 and selects the legacy SAM contour', async () => {
  const routes = [];
  const fixture = setup(async path => {
    routes.push(path);
    if (path === '/api/live-segment') return { status: 404, ok: false };
    return { ok: true, json: async () => ({ width: 640, height: 480,
      clippedFraction: 0.01,
      candidates: [
        { method: 'aligned-image-difference', contour: [[1, 1], [2, 1], [2, 2]] },
        { method: 'sam2.1-hiera-small-cuda', contour: result.contour },
      ] }) };
  });
  await fixture.session.start();
  await pause(25);
  assert.equal(routes.filter(route => route === '/api/live-segment').length, 1);
  assert.ok(routes.filter(route => route === '/api/segment').length >= 2);
  const payload = await fixture.session.capture();
  assert.deepEqual(payload.contour, result.contour);
  assert.ok(payload.quality.score >= 0 && payload.quality.score <= 1);
});

test('falls back when the deployed service returns 405 for the new live route', async () => {
  const routes = [];
  const fixture = setup(async path => {
    routes.push(path);
    if (path === '/api/live-segment') return { status: 405, ok: false };
    return { ok: true, json: async () => ({ width: 640, height: 480,
      candidates: [{ method: 'sam2.1-hiera-small-cuda', contour: result.contour }] }) };
  });
  await fixture.session.start();
  await pause(25);
  assert.deepEqual(routes.slice(0, 2), ['/api/live-segment', '/api/segment']);
  assert.equal(fixture.captureButton.disabled, false);
  fixture.session.stop();
});

test('permission timeout lets the user retry and stops a late camera stream', async () => {
  let resolvePermission;
  let calls = 0;
  let lateStops = 0;
  const fixture = setup(async () => ({ ok: true, json: async () => result }),
    async () => {}, { startupTimeoutMs: 8, mediaDevices: {
      getUserMedia() {
        calls++;
        if (calls === 1) return new Promise(resolve => { resolvePermission = resolve; });
        return Promise.resolve({ getTracks: () => [{ stop() {} }] });
      },
    } });
  await assert.rejects(fixture.session.start(), /permission timed out/i);
  assert.match(fixture.status.textContent, /permission timed out/i);
  assert.equal(fixture.session.active, false);
  resolvePermission({ getTracks: () => [{ stop() { lateStops++; } }] });
  await pause(1);
  assert.equal(lateStops, 1);
  await fixture.session.start();
  assert.equal(fixture.session.active, true);
  fixture.session.stop();
});

test('stopping during pending permission cancels startup and releases a late stream', async () => {
  let resolvePermission;
  let lateStops = 0;
  const fixture = setup(async () => ({ ok: true, json: async () => result }),
    async () => {}, { mediaDevices: { getUserMedia: () => new Promise(resolve => {
      resolvePermission = resolve;
    }) } });
  const starting = fixture.session.start();
  fixture.session.stop();
  await assert.rejects(starting, { name: 'AbortError' });
  resolvePermission({ getTracks: () => [{ stop() { lateStops++; } }] });
  await pause(1);
  assert.equal(lateStops, 1);
  assert.equal(fixture.session.active, false);
});

test('preview timeout closes the acquired camera stream', async () => {
  const fixture = setup(async () => ({ ok: true, json: async () => result }),
    async () => {}, { startupTimeoutMs: 8, play: () => new Promise(() => {}) });
  await assert.rejects(fixture.session.start(), /preview timed out/i);
  assert.equal(fixture.stopped, 1);
  assert.equal(fixture.video.srcObject, null);
  assert.equal(fixture.session.active, false);
});

test('a hung segmentation request times out and the loop recovers', async () => {
  let calls = 0;
  const fixture = setup(async () => {
    if (++calls === 1) return new Promise(() => {});
    return { ok: true, json: async () => result };
  }, async () => {}, { requestTimeoutMs: 8 });
  await fixture.session.start();
  await pause(35);
  assert.ok(calls >= 2);
  assert.equal(fixture.captureButton.disabled, false);
  fixture.session.stop();
});

test('restarting during an ignored abort still starts a new sampling loop', async () => {
  let calls = 0;
  const fixture = setup(async () => {
    if (++calls === 1) return new Promise(() => {});
    return { ok: true, json: async () => result };
  });
  await fixture.session.start();
  await pause(1);
  await fixture.session.start();
  await pause(20);
  assert.ok(calls >= 2);
  assert.equal(fixture.captureButton.disabled, false);
  fixture.session.stop();
});

test('lost connection expires the old outline and prevents stale capture', async () => {
  let calls = 0;
  const fixture = setup(async () => {
    if (++calls > 1) return new Promise(() => {});
    return { ok: true, json: async () => result };
  }, async () => {}, { maxResultAgeMs: 15 });
  await fixture.session.start();
  await pause(4);
  assert.equal(fixture.captureButton.disabled, false);
  await pause(25);
  assert.equal(fixture.captureButton.disabled, true);
  await assert.rejects(fixture.session.capture(), /fresh lens outline/);
  fixture.session.stop();
});

test('a malformed response revokes the previous valid capture', async () => {
  let calls = 0;
  const fixture = setup(async () => ({ ok: true, json: async () => ++calls === 1 ? result :
    { ...result, contour: [[NaN, 10], [100, 10], [100, 100]] } }));
  await fixture.session.start();
  await pause(20);
  assert.equal(fixture.captureButton.disabled, true);
  await assert.rejects(fixture.session.capture(), /fresh lens outline/);
  fixture.session.stop();
});

test('a delayed response is not fresh merely because it has just arrived', async () => {
  const fixture = setup(async () => {
    await pause(15);
    return { ok: true, json: async () => result };
  }, async () => {}, { maxResultAgeMs: 8 });
  await fixture.session.start();
  await pause(22);
  assert.equal(fixture.captureButton.disabled, true);
  await assert.rejects(fixture.session.capture(), /fresh lens outline/);
  fixture.session.stop();
});

test('a completed old capture callback cannot stop a restarted camera', async () => {
  let finishCapture;
  const fixture = setup(async () => ({ ok: true, json: async () => result }),
    () => new Promise(resolve => { finishCapture = resolve; }));
  await fixture.session.start();
  await pause(2);
  const capturing = fixture.session.capture();
  await fixture.session.start();
  finishCapture();
  await capturing;
  assert.equal(fixture.session.active, true);
  await pause(10);
  assert.equal(fixture.captureButton.disabled, false);
  fixture.session.stop();
});
