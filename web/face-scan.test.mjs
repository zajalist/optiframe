import test from 'node:test';
import assert from 'node:assert/strict';
import { openFaceScan, faceScanDeadline } from './face-scan.js';
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return {promise,resolve}; };
function environment() {
  let stopped=0,modelClosed=0,focus=0; const frames=[];
  class Element extends EventTarget {
    constructor(){super();this.dataset={};this.style={setProperty(){}};this.hidden=false;this.disabled=false;this.value='';this.textContent='';this.isConnected=true;}
    setAttribute(){} appendChild(){} showModal(){this.open=true} close(){this.open=false} remove(){this.removed=true}
  }
  const elements=new Map();
  const find=selector=>{if(!elements.has(selector))elements.set(selector,new Element());return elements.get(selector)};
  const video=find('video');Object.assign(video,{play:async()=>{},pause(){},videoWidth:1280,videoHeight:720,currentTime:1,readyState:4});
  const trackingLines=[];
  Object.assign(find('canvas'),{clientWidth:390,clientHeight:844,getContext:()=>({setTransform(){},clearRect(){},beginPath(){},moveTo(x,y){trackingLines.push(['move',x,y])},lineTo(x,y){trackingLines.push(['line',x,y])},stroke(){}})});
  const dialog=new Element();dialog.querySelector=find;
  const doc=new Element();doc.activeElement={isConnected:true,focus(){focus++}};doc.querySelector=()=>null;doc.createElement=tag=>tag==='dialog'?dialog:new Element();doc.body=new Element();doc.head=new Element();
  const win=new Element();win.innerHeight=844;
  const globals={document:doc,window:win,navigator:{},cancelAnimationFrame(){},requestAnimationFrame(fn){frames.push(fn);return frames.length}};
  const original=Object.fromEntries(Object.keys(globals).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  Object.entries(globals).forEach(([key,value])=>Object.defineProperty(globalThis,key,{configurable:true,value}));
  const stream={getTracks:()=>[{stop(){stopped++}}]};
  const model={close(){modelClosed++},detectForVideo:()=>({faceLandmarks:[]})};
  const vision={FilesetResolver:{forVisionTasks:async()=>({})},FaceLandmarker:{createFromOptions:async()=>model}};
  const runtime={getUserMedia:async()=>stream,loadVision:async()=>vision,createEstimator:()=>({reset(){},update:()=>({state:'ready',progress:1,result:{left:31.2,right:32.4}})})};
  return {dialog,doc,find,video,stream,model,vision,runtime,frames,trackingLines,get stopped(){return stopped},get modelClosed(){return modelClosed},get focus(){return focus},restore(){for(const key of Object.keys(globals)){if(original[key])Object.defineProperty(globalThis,key,original[key]);else delete globalThis[key]}}};
}
test('closing before camera permission resolves releases late tracks and never emits measurements',async()=>{
  const env=environment(),permission=deferred();let confirmed=0;
  try{const close=openFaceScan({onConfirm(){confirmed++}},{...env.runtime,getUserMedia:()=>permission.promise});assert.equal(typeof close,'function');close();close();permission.resolve(env.stream);await flush();assert.equal(env.stopped,1);assert.equal(env.dialog.removed,true);assert.equal(confirmed,0);assert.equal(env.focus,1)}finally{env.restore()}
});
test('camera denial offers retry and manual entry without a confirm action',async()=>{
  const env=environment();try{const close=openFaceScan({}, {...env.runtime,getUserMedia:async()=>{throw new DOMException('denied','NotAllowedError')}});await flush();assert.equal(env.dialog.dataset.phase,'error');assert.match(env.find('.face-scan-status').textContent,/denied/);assert.equal(env.find('.face-scan-retry').hidden,false);assert.equal(env.find('.face-scan-confirm').hidden,true);close()}finally{env.restore()}
});
test('manual entry releases the camera and invokes only the explicit manual callback',async()=>{
  const env=environment();let manual=0,confirmed=0;try{openFaceScan({onManual(){manual++},onConfirm(){confirmed++}},env.runtime);await flush();env.find('.face-scan-manual').dispatchEvent(new Event('click'));assert.equal(manual,1);assert.equal(confirmed,0);assert.equal(env.stopped,1);assert.equal(env.dialog.removed,true)}finally{env.restore()}
});
test('stable capture stops camera, stays unconfirmed, and emits explicitly edited values once',async()=>{
  const env=environment(),results=[];try{openFaceScan({onConfirm:result=>results.push(result)},env.runtime);await flush();env.frames.shift()(1000);assert.equal(env.dialog.dataset.phase,'review');assert.equal(env.stopped,1);assert.equal(env.modelClosed,1);assert.equal(results.length,0);env.find('#face-scan-left').value='30.5';env.find('#face-scan-left').dispatchEvent(new Event('input'));env.find('.face-scan-confirm').dispatchEvent(new Event('click'));env.find('.face-scan-confirm').dispatchEvent(new Event('click'));assert.deepEqual(results,[{left:30.5,right:32.4,source:'browser-iris-estimate'}]);assert.equal(env.dialog.removed,true)}finally{env.restore()}
});
test('invalid edited values cannot be confirmed and retry cannot reuse captured estimates',async()=>{
  const env=environment(),results=[];try{const close=openFaceScan({onConfirm:result=>results.push(result)},env.runtime);await flush();env.frames.shift()(1000);env.find('#face-scan-right').value='';env.find('#face-scan-right').dispatchEvent(new Event('input'));env.find('.face-scan-confirm').dispatchEvent(new Event('click'));assert.equal(results.length,0);assert.equal(env.find('.face-scan-confirm').disabled,true);env.find('.face-scan-retry').dispatchEvent(new Event('click'));assert.equal(env.find('.face-scan-confirm').hidden,true);close();await flush()}finally{env.restore()}
});
test('GPU rejection falls back to CPU and closing releases a late model',async()=>{
  const env=environment(),pending=deferred(),delegates=[];
  env.vision.FaceLandmarker.createFromOptions=async(files,options)=>{delegates.push(options.baseOptions.delegate);if(delegates.length===1)throw new Error('gpu unavailable');return pending.promise};
  try{const close=openFaceScan({},env.runtime);await flush();assert.deepEqual(delegates,['GPU','CPU']);close();pending.resolve(env.model);await flush();assert.equal(env.modelClosed,1);assert.equal(env.stopped,1)}finally{env.restore()}
});
test('backgrounding while model downloads releases camera and prevents later model creation',async()=>{
  const env=environment(),pending=deferred();let models=0;env.vision.FaceLandmarker.createFromOptions=async()=>{models++;return env.model};
  try{openFaceScan({}, {...env.runtime,loadVision:()=>pending.promise});await flush();env.doc.hidden=true;env.doc.dispatchEvent(new Event('visibilitychange'));pending.resolve(env.vision);await flush();assert.equal(env.stopped,1);assert.equal(models,0);assert.equal(env.dialog.removed,true)}finally{env.restore()}
});
test('deadline times out and disposes resources that arrive later',async()=>{
  const pending=deferred(),controller=new AbortController();let disposed=0;
  await assert.rejects(faceScanDeadline(pending.promise,2,controller.signal,'timed out',()=>disposed++),/timed out/);
  pending.resolve({});await flush();assert.equal(disposed,1);
});
test('a throwing late disposer does not create an unhandled rejection after cancellation',async()=>{
  const pending=deferred(),controller=new AbortController();let disposals=0;
  const result=faceScanDeadline(pending.promise,100,controller.signal,'timed out',()=>{disposals++;throw new Error('device already lost')});
  controller.abort();await assert.rejects(result,{name:'AbortError'});pending.resolve({});await flush();assert.equal(disposals,1);
});
test('live cues use two six-pixel ticks only during valid collection, without a face oval',async()=>{
  const env=environment();let state='collecting',close;
  env.model.detectForVideo=()=>({faceLandmarks:[Array.from({length:478},(_,i)=>({x:i===473?.6:.4,y:.4,z:0}))]});
  try{
    close=openFaceScan({}, {...env.runtime,createEstimator:()=>({reset(){},update:()=>({state,message:'Hold still',progress:.4})})});await flush();
    env.frames.shift()(1000);assert.equal(env.dialog.dataset.phase,'live');assert.doesNotMatch(env.dialog.innerHTML,/face-scan-guide/);
    assert.deepEqual(env.trackingLines.map(line=>line[0]),['move','line','move','line']);
    assert.equal(env.trackingLines[1][1]-env.trackingLines[0][1],6);assert.equal(env.trackingLines[3][1]-env.trackingLines[2][1],6);
    state='guidance';env.video.currentTime=2;env.frames.shift()(1100);assert.equal(env.trackingLines.length,4);
  }finally{close?.();env.restore()}
});

test('review explicitly describes unknown physical accuracy instead of a false error bound',async()=>{
 const env=environment();let close;
 try{close=openFaceScan({},env.runtime);await flush();env.frames.shift()(1000);assert.match(env.dialog.innerHTML,/Physical accuracy is unknown/);assert.doesNotMatch(env.dialog.innerHTML,/±/);}finally{close?.();env.restore();}
});
test('one failed device disposer cannot strand the other tracks or dialog',async()=>{
 const env=environment();let secondStopped=0;
 env.stream.getTracks=()=>[{stop(){throw new Error('lost track');}},{stop(){secondStopped++;}}];
 env.model.close=()=>{throw new Error('lost model');};
 try{const close=openFaceScan({},env.runtime);await flush();close();assert.equal(secondStopped,1);assert.equal(env.dialog.removed,true);}finally{env.restore();}
});
