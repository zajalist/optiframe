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
  const status = new Element(), button = new Element(), retry = new Element(), stage = new Element(), dialog = new Element();
  dialog.querySelector = selector => ({ video, button, '.face-tryon-retry':retry, '.face-tryon-stage': stage, '.face-tryon-status': status })[selector];
  const doc = new Element();
  doc.activeElement = { isConnected: true, focus() { focus++; } };
  doc.querySelector = () => null;
  doc.createElement = tag => tag === 'dialog' ? dialog : new Element();
  doc.body = new Element(); doc.head = new Element();
  const values = { document: doc, window: new Element(), navigator: { mediaDevices: { getUserMedia } }, cancelAnimationFrame: () => {} };
  const original = Object.fromEntries(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
  return { dialog, video, status, retry, doc, get pauses() { return pauses; }, get focus() { return focus; }, restore() {
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

const settleUntil = async predicate => {
  for(let i=0;i<100&&!predicate();i++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(Boolean(predicate()),true,'expected bounded state transition');
};
test('hung dependency loader releases camera and offers retry without applying late results',async()=>{
  let stops=0,models=0;const loader=deferred();
  const env=environment(async()=>({getTracks:()=>[{stop(){stops++}}]}));env.video.play=async()=>{};let close;
  try{
    close=await openFaceTryOn({assembly},{loadDependencies:()=>loader.promise,timeouts:{dependencies:3}});
    await settleUntil(()=>env.retry.hidden===false);
    assert.match(env.status.textContent,/download timed out/);assert.equal(stops,1);assert.equal(env.video.srcObject,null);
    loader.resolve([{}, {FilesetResolver:{forVisionTasks:async()=>{models++;return{}}}}]);await flush();assert.equal(models,0);
  }finally{close?.();env.restore()}
});
test('hung GPU then CPU initialization both time out and dispose late models',async()=>{
  let stops=0,closes=0;const gpu=deferred(),cpu=deferred(),delegates=[];
  const env=environment(async()=>({getTracks:()=>[{stop(){stops++}}]}));env.video.play=async()=>{};let close;
  const vision={FilesetResolver:{forVisionTasks:async()=>({})},FaceLandmarker:{createFromOptions:(files,options)=>{delegates.push(options.baseOptions.delegate);return options.baseOptions.delegate==='GPU'?gpu.promise:cpu.promise}}};
  try{
    close=await openFaceTryOn({assembly},{loadDependencies:async()=>[{},vision],timeouts:{model:3}});
    await settleUntil(()=>env.retry.hidden===false);assert.deepEqual(delegates,['GPU','CPU']);assert.match(env.status.textContent,/startup timed out/);assert.equal(stops,1);
    gpu.resolve({close(){closes++}});cpu.resolve({close(){closes++}});await flush();assert.equal(closes,2);
  }finally{close?.();env.restore()}
});
test('retry ignores double clicks, stops previous stream, and old loader cannot replace new session',async()=>{
  let opened=0,stops=0;const first=deferred(),second=deferred();
  const env=environment(async()=>{opened++;return{getTracks:()=>[{stop(){stops++}}]}});env.video.play=async()=>{};let close,loads=0;
  try{
    close=await openFaceTryOn({assembly},{loadDependencies:()=>++loads===1?first.promise:second.promise,timeouts:{dependencies:20}});
    await settleUntil(()=>env.retry.hidden===false);assert.equal(stops,1);
    env.retry.dispatchEvent(new Event('click'));env.retry.dispatchEvent(new Event('click'));await flush();assert.equal(opened,2);assert.equal(loads,2);
    first.resolve([{}, {FilesetResolver:{forVisionTasks(){throw new Error('stale loader used')}}}]);await flush();assert.equal(stops,1);assert.notEqual(env.video.srcObject,null);
    close();assert.equal(stops,2);second.resolve([{},{}]);await flush();assert.equal(env.dialog.removed,true);
  }finally{close?.();env.restore()}
});
test('permission timeout disposes a late camera while retry keeps its own stream',async()=>{
  const pending=deferred();let calls=0,oldStops=0,newStops=0;const env=environment(()=>++calls===1?pending.promise:Promise.resolve({getTracks:()=>[{stop(){newStops++}}]}));let close;
  try{
    close=await openFaceTryOn({assembly},{timeouts:{camera:3}});await settleUntil(()=>env.retry.hidden===false);assert.match(env.status.textContent,/permission timed out/);
    env.retry.dispatchEvent(new Event('click'));await flush();const current=env.video.srcObject;
    pending.resolve({getTracks:()=>[{stop(){oldStops++}}]});await flush();assert.equal(oldStops,1);assert.equal(newStops,0);assert.equal(env.video.srcObject,current);
    close();assert.equal(newStops,1);
  }finally{close?.();env.restore()}
});
test('closing during model startup disposes late model without CPU fallback',async()=>{
  const pending=deferred();let calls=0,closes=0,stops=0;
  const env=environment(async()=>({getTracks:()=>[{stop(){stops++}}]}));env.video.play=async()=>{};let close;
  const vision={FilesetResolver:{forVisionTasks:async()=>({})},FaceLandmarker:{createFromOptions(){calls++;return pending.promise}}};
  try{
    close=await openFaceTryOn({assembly},{loadDependencies:async()=>[{},vision]});await flush();assert.equal(calls,1);close();pending.resolve({close(){closes++}});await flush();assert.equal(closes,1);assert.equal(stops,1);assert.equal(calls,1);
  }finally{close?.();env.restore()}
});
test('throwing track and video cleanup cannot block the remaining tracks or Retry',async()=>{
  let stopped=0;const env=environment(async()=>({getTracks:()=>[{stop(){throw new Error('device lost')}},{stop(){stopped++}}]}));
  env.video.play=async()=>{throw new Error('playback failed')};env.video.pause=()=>{throw new Error('video lost')};let close;
  try{
    close=await openFaceTryOn({assembly});await flush();assert.equal(stopped,1);assert.equal(env.video.srcObject,null);assert.equal(env.retry.hidden,false);close();assert.equal(env.dialog.removed,true);
  }finally{close?.();env.restore()}
});
test('renderer creation failure and throwing model cleanup still leave Retry usable',async()=>{
  let stops=0,closes=0;const env=environment(async()=>({getTracks:()=>[{stop(){stops++}}]}));env.video.play=async()=>{};let close;
  const vision={FilesetResolver:{forVisionTasks:async()=>({})},FaceLandmarker:{createFromOptions:async()=>({close(){closes++;throw new Error('model lost')}})}};
  const THREE={WebGLRenderer:class {constructor(){throw new Error('No WebGL context')}}};
  try{
    close=await openFaceTryOn({assembly},{loadDependencies:async()=>[THREE,vision]});await flush();assert.equal(closes,1);assert.equal(stops,1);assert.equal(env.retry.hidden,false);close();assert.equal(env.dialog.removed,true);
  }finally{close?.();env.restore()}
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
