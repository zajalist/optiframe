import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness() {
  const fields = new Map();
  const designInput = {listeners: new Map(), addEventListener(name, listener) {this.listeners.set(name, listener);}};
  const field = selector => {
    if (!fields.has(selector)) fields.set(selector, {value: selector.includes('width') ? '50' : '30', checked: true});
    return fields.get(selector);
  };
  const context = {document:{querySelectorAll:selector=>selector==='.design-inputs input'?[designInput]:[]},location:{hash:''},URLSearchParams,FormData};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL('./calibration.js',import.meta.url),'utf8').replace(/^export .*;$/m,''),context);
  const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'');
  vm.runInContext(app.split('const [leftPanel, rightPanel]')[0]+';globalThis.Panel=LensPanel',context);
  const panel=Object.create(context.Panel.prototype);
  Object.assign(panel,{el:{querySelector:field},photoVersion:1,points:[[0,0],[50,0],[50,30],[0,30]],homography:[1,0,0,0,1,0,0,0],mmPerPixel:null,opticalCentre:[25,15],bitmap:null,size:{},topStatus:{textContent:''},photoLoading:false});
  context.panel=panel;
  vm.runInContext('const leftPanel=panel,rightPanel=panel;const designStatus={};globalThis.status=designStatus;'+app.slice(app.indexOf('function invalidateFrameResult()'),app.indexOf("document.getElementById('preview-frame')"))+';globalThis.payload=framePayload;globalThis.makeFrame=makeFrame;globalThis.invalidateFrameResult=invalidateFrameResult;',context);
  return {panel,field,context,designInput};
}

test('geometry/calibration changes revoke confirmed evidence even when dimensions still pass',()=>{
  const {panel,field}=harness();
  panel.updateMeasurement();
  for (const change of [()=>panel.points[0][0]+=0.1,()=>panel.points=panel.points.map(p=>[...p]).reverse(),()=>panel.homography=[1,0,0,0,1,0.01,0,0],()=>panel.mmPerPixel=0.1,()=>panel.opticalCentre=[24,15],()=>panel.topMark=[25,0],()=>panel.photoVersion++]) {
    field('.evidence-confirmed').checked=true;
    change();panel.updateMeasurement();
    assert.equal(field('.evidence-confirmed').checked,false);
  }
});

test('unchanged repaint preserves confirmation; benchmark field editing can revoke it',()=>{
  const {panel,field}=harness();panel.updateMeasurement();
  field('.evidence-confirmed').checked=true;panel.updateMeasurement();
  assert.equal(field('.evidence-confirmed').checked,true);
  panel.invalidateEvidence();assert.equal(field('.evidence-confirmed').checked,false);
  assert.equal(panel.caliperCheck.pass,false);assert.equal(panel.repeatCheck.pass,false);
});

test('two rotated photos align at the marked optical centre and top for edge repeatability',()=>{
  const {panel}=harness();
  panel.points=[[5,20],[9,12],[22,8],[42,9],[49,17],[50,30],[44,41],[30,45],[16,43],[7,37],[4,31],[4,25]];
  panel.opticalCentre=[27,27];
  panel.topMark=[27,7];
  panel.loadedPhotoVersion=1;
  panel.updateMeasurement();
  panel.repeatOutline=panel.millimetreOutline();
  panel.repeatPhotoVersion=1;
  panel.points=panel.points.map(([x,y])=>[54-y,x]);
  panel.opticalCentre=[27,27];
  panel.topMark=[47,27];
  panel.loadedPhotoVersion=2;
  panel.updateMeasurement();
  assert.equal(panel.edgeRepeatCheck.pass,true);
  assert.ok(panel.edgeRepeatCheck.error<0.002);
});

test('a top mark too close to the optical centre gives guidance without crashing',()=>{
  const {panel}=harness();
  panel.topMark=[27,15];
  assert.doesNotThrow(()=>panel.updateMeasurement());
  assert.match(panel.topStatus.textContent,/at least 5 mm/);
  assert.equal(panel.edgeRepeatCheck.pass,false);
});

test('checked STL needs a top mark even when other evidence passes',async()=>{
  const {panel,context}=harness();
  Object.assign(panel,{topMark:null,caliperCheck:{pass:true},repeatCheck:{pass:true},edgeRepeatCheck:{pass:true}});
  await context.makeFrame(false,false);
  assert.match(context.status.textContent,/marked optical centre and top/);
});

test('loading a photo blocks preview, checked export and experimental export',async()=>{
  const {panel,context}=harness();panel.photoLoading=true;
  assert.throws(()=>context.payload(),/finish loading/);
  for(const args of [[true,false],[false,false],[false,true]]) {
    await context.makeFrame(...args);
    assert.match(context.status.textContent,/finish loading/);
  }
});

test('older frame responses cannot replace a newer result', async () => {
  const {panel, context} = harness();
  panel.millimetreOutline = () => Array.from({length: 12}, (_, index) => [index, index]);
  context.number = () => 2.5;
  const deferred = () => { let resolve; return {promise: new Promise(r => resolve = r), resolve}; };
  const first = deferred(), second = deferred();
  let calls = 0;
  context.fetch = () => ++calls === 1 ? first.promise : second.promise;
  const old = context.makeFrame(true);
  const latest = context.makeFrame(true);
  const failure = detail => ({ok: false, headers: {get: () => 'application/json'}, json: async () => ({detail})});
  second.resolve(failure('newer request result'));
  await latest;
  first.resolve(failure('stale request result'));
  await old;
  assert.equal(context.status.textContent, 'newer request result');
});

test('panel changes during one pending request discard its result without another request', async () => {
  const {panel, context} = harness();
  panel.millimetreOutline = () => Array.from({length: 12}, (_, index) => [index, index]);
  context.number = () => 2.5;
  let resolve;
  context.fetch = () => new Promise(r => resolve = r);
  const pending = context.makeFrame(true);
  panel.photoVersion++;
  resolve({ok: false, headers: {get: () => 'application/json'}, json: async () => ({detail: 'outdated server result'})});
  await pending;
  assert.match(context.status.textContent, /Design inputs changed/);
  assert.doesNotMatch(context.status.textContent, /outdated server result/);
});

test('marking a lens top invalidates an in-flight preview',async()=>{
  const {panel,context}=harness();
  panel.millimetreOutline=()=>Array.from({length:12},(_,index)=>[index,index]);
  context.number=()=>2.5;
  let resolve;
  context.fetch=()=>new Promise(r=>resolve=r);
  const pending=context.makeFrame(true);
  panel.topMark=[25,0];
  panel.updateMeasurement();
  resolve({ok:false,headers:{get:()=> 'application/json'},json:async()=>({detail:'obsolete result'})});
  await pending;
  assert.match(context.status.textContent,/Design inputs changed/);
  assert.doesNotMatch(context.status.textContent,/obsolete result/);
});

test('editing a shown preview marks it stale', () => {
  const {context} = harness();
  const badges = [];
  const viewer = {dataset: {}, classList: {contains: () => true}, setAttribute(name, value) {this[name] = value;}, appendChild: badge => badges.push(badge)};
  context.document.getElementById = () => viewer;
  context.document.createElement = () => ({style: {}});
  context.invalidateFrameResult();
  assert.equal(viewer.dataset.stale, 'true');
  assert.match(viewer['aria-label'], /Stale 3D preview/);
  assert.equal(badges.length, 1);
  assert.match(context.status.textContent, /Design inputs changed/);
});

test('an input edit during ZIP generation prevents the old download', async () => {
  const {panel, context, designInput} = harness();
  panel.millimetreOutline = () => Array.from({length: 12}, (_, index) => [index, index]);
  context.number = () => 2.5;
  let resolve, clicks = 0;
  context.fetch = () => new Promise(r => resolve = r);
  context.URL = {createObjectURL: () => 'blob:old', revokeObjectURL() {}};
  context.document.createElement = () => ({click() {clicks++;}});
  const pending = context.makeFrame(false, true);
  designInput.listeners.get('input')();
  resolve({ok: true, blob: async () => new Blob(['outdated ZIP'])});
  await pending;
  assert.equal(clicks, 0);
  assert.match(context.status.textContent, /Design inputs changed/);
});

test('pending archive owns loading state; a later photo or archive wins the race',async()=>{
  for (const laterArchive of [false,true]) {
    const {panel,context}=harness();
    const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
    const first=deferred(),second=deferred();let requests=0;
    context.fetch=url=>url==='/api/import' ? (++requests===1?first.promise:second.promise) : Promise.resolve({blob:async()=>new Blob([url])});
    context.createImageBitmap=async()=>({width:80,height:60,close(){}});
    Object.assign(panel,{side:'left',select:{replaceChildren(){}},placeholder:{},scaleStatus:{},markerStatus:{},centreStatus:{},topStatus:{},status:{},canvas:{},render(){}});
    const old=panel.loadArchive(new Blob(['A']));
    assert.equal(panel.photoLoading,true);assert.throws(()=>context.payload(),/finish loading/);
    const response=name=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>({side:'left',image:name,frameCount:1})});
    if(laterArchive) {
      const newer=panel.loadArchive(new Blob(['B']));second.resolve(response('B'));await newer;
    } else assert.equal(await panel.loadPhoto(new Blob(['B'])),true);
    const winningPhoto=panel.photo,winningVersion=panel.photoVersion;
    first.resolve(response('A'));await old;
    assert.equal(panel.photo,winningPhoto);assert.equal(panel.photoVersion,winningVersion);assert.equal(panel.photoLoading,false);
  }
});

test('archive labelled for the other lens is rejected before loading image',async()=>{
 const {panel,context}=harness();panel.side='left';panel.status={};
 context.fetch=async()=>({ok:true,headers:{get:()=> 'application/json'},json:async()=>({side:'right',image:'wrong'})});
 await panel.loadArchive(new Blob(['wrong']));
 assert.match(panel.status.textContent,/labelled right/);assert.equal(panel.photoLoading,false);assert.equal(panel.photo,undefined);
});
