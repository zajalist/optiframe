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
  Object.assign(panel,{el:{querySelector:field},photoVersion:1,points:[[0,0],[50,0],[50,30],[0,30]],homography:[1,0,0,0,1,0,0,0],mmPerPixel:null,opticalCentre:[25,15],topMark:[25,0],bitmap:null,size:{},topStatus:{textContent:''},photoLoading:false});
  context.panel=panel;
  vm.runInContext('const leftPanel=panel,rightPanel=panel;const designStatus={};globalThis.status=designStatus;'+app.slice(app.indexOf('function invalidateFrameResult()'),app.indexOf("document.getElementById('preview-frame')"))+';globalThis.payload=framePayload;globalThis.makeFrame=makeFrame;globalThis.invalidateFrameResult=invalidateFrameResult;',context);
  return {panel,field,context,designInput};
}

test('geometry/calibration changes revoke confirmed evidence even when dimensions still pass',()=>{
  const {panel,field}=harness();
  panel.updateMeasurement();
  for (const change of [()=>panel.points[0][0]+=0.1,()=>panel.points=panel.points.map(p=>[...p]).reverse(),()=>panel.homography=[1,0,0,0,1,0.01,0,0],()=>panel.mmPerPixel=0.1,()=>panel.opticalCentre=[24,15],()=>panel.topMark=[26,0],()=>panel.photoVersion++]) {
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

test('studio edits the captured photo canvas, not the hidden live camera overlay', () => {
  const {context} = harness();
  context.Panel.prototype.bind = () => {};
  const captured = {getContext: () => ({})}, live = {getContext: () => ({})};
  const panel = new context.Panel({dataset:{side:'left'}, querySelector: selector => selector === '.canvas-wrap canvas' ? captured : selector === 'canvas' ? live : {}});
  assert.equal(panel.canvas, captured);
});

test('experimental export and preview require an explicit physical top mark', async () => {
  const {panel, context} = harness();
  panel.millimetreOutline = () => Array.from({length: 12}, (_, i) => [i, i]);
  panel.topMark = null;
  for (const args of [[true, false], [false, true]]) {
    await context.makeFrame(...args);
    assert.match(context.status.textContent, /physical top of both lenses/);
  }
});

test('capture handoff preserves both independently sized contours through studio resizing and requires provider marks', async () => {
  const {context: shared} = harness();
  const app = fs.readFileSync(new URL('./app.js', import.meta.url), 'utf8');
  const transfer = ['left', 'right'].map((side, index) => ({side, image:'data:image/jpeg;base64,test', width:1000, height:700,
    contour:Array.from({length:80}, (_, i) => [500+(index ? 180 : 250)*Math.cos(i*Math.PI/40),350+(index ? 160 : 200)*Math.sin(i*Math.PI/40)]),
    markers:[[0,0],[1000,0],[1000,700],[0,700]]}));
  const makePanel = () => ({canvas:{width:500,height:350},markerStatus:{}, opticalCentre:null,topMark:null,
    loadPhoto:async()=>true,render(){},setMode(mode){this.mode=mode;},millimetreOutline:shared.Panel.prototype.millimetreOutline});
  const left = makePanel(), right = makePanel();
  let removed = false;
  const context = vm.createContext({leftPanel:left,rightPanel:right, sheetHomography:shared.sheetHomography,
    sessionStorage:{getItem:()=>JSON.stringify(transfer),removeItem(){removed=true;}},
    fetch:async()=>({blob:async()=>new Blob(['photo'])}),
    document:{body:{classList:{add(){}}},getElementById:()=>({}),querySelector:()=>({})}});
  vm.runInContext(app.slice(app.indexOf('async function importSimpleCaptures()'),app.indexOf('const capturesReady =')),context);
  await vm.runInContext('importSimpleCaptures()',context);
  assert.equal(removed,true);
  for(const panel of [left,right]) {
    assert.equal(panel.mode,'optical');
    assert.equal(panel.millimetreOutline(),null);
    panel.opticalCentre=[250,175]; panel.topMark=[250,75];
  }
  const leftSize=shared.measure(left.millimetreOutline(),1),rightSize=shared.measure(right.millimetreOutline(),1);
  assert.ok(Math.abs(leftSize.width-50)<.001 && Math.abs(leftSize.height-40)<.001);
  assert.ok(Math.abs(rightSize.width-36)<.001 && Math.abs(rightSize.height-32)<.001);
});
