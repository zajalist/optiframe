import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveSegmentSession } from './live-segment.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const end = Date.now() + 2000;
  while (!check() && Date.now() < end) await pause(10);
  assert.ok(check(), 'Expected capture stage before deadline');
}
function canvas() {
  const value = { width: 640, height: 480, textContent: '', handlers: {},
    addEventListener(type, handler) { this.handlers[type] = handler; },
    getBoundingClientRect() { return {left:0,top:0,width:640,height:480}; },
    toBlob(done) { done(new Blob(['original'])); },
  };
  value.getContext = () => ({ drawImage() {}, clearRect() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, stroke() {}, save() {}, restore() {}, arc() {}, fill() {},
    getImageData() { return {width:640,height:480,data:new Uint8ClampedArray(640*480*4).fill(180)}; },
  });
  return value;
}

test('an obsolete still cannot hold or release the new camera capture lock', async t => {
  const originalDocument = globalThis.document;
  globalThis.document = {createElement:canvas};
  t.after(() => {globalThis.document = originalDocument;});
  let mediaTime = 0, captured = 0;
  const bursts = [];
  const outline = Array.from({length:40}, (_,i) => [50+25*Math.cos(i*Math.PI/20),35+20*Math.sin(i*Math.PI/20)]);
  const video = {videoWidth:640,videoHeight:480, get currentTime() {return ++mediaTime;}, play:async()=>{},pause(){}};
  const session = createLiveSegmentSession({video,overlay:canvas(),status:canvas(),captureButton:canvas(),
    onCapture:async()=>{captured++;}, autoCapture:true,stillCapture:true,intervalMs:50,
    captureFrame:()=>new Promise(resolve=>bursts.push(resolve)),
    mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})},
    calibrateFrame:()=>({markers:[[80,50],[560,50],[560,386],[80,386]],contour:outline}),
    apiFetch:async()=>({ok:true,json:async()=>({width:640,height:480,
      contour:outline,presence:{detected:true},quality:{score:.8,sharpness:180}})}),
  });
  t.after(()=>session.stop());
  await session.start(); await until(()=>bursts.length===1);
  await session.start();
  assert.throws(()=>session.setBoxNormalized(null), /four finite/, 'Restart must release the obsolete capture lock');
  await until(()=>bursts.length===2);
  bursts[0]({canvas:canvas(),capturedAt:new Date().toISOString()});
  await pause(10);
  assert.doesNotThrow(()=>session.setBoxNormalized(null), 'Old completion must not release the active burst lock');
  assert.equal(captured,0);
  session.stop();
  bursts[1]({canvas:canvas(),capturedAt:new Date().toISOString()});
  await pause(10);
  assert.equal(captured,0, 'Stopped burst must never be exported');
});
