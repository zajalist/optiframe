import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function harness() {
  const fields = new Map();
  const field = selector => {
    if (!fields.has(selector)) fields.set(selector, {value: selector.includes('width') ? '50' : '30', checked: true});
    return fields.get(selector);
  };
  const context = {document:{querySelectorAll:()=>[]},location:{hash:''},URLSearchParams,FormData};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL('./calibration.js',import.meta.url),'utf8').replace(/^export .*;$/m,''),context);
  const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8').replace(/^import .*;$/m,'');
  vm.runInContext(app.split('const [leftPanel, rightPanel]')[0]+';globalThis.Panel=LensPanel',context);
  const panel=Object.create(context.Panel.prototype);
  Object.assign(panel,{el:{querySelector:field},photoVersion:1,points:[[0,0],[50,0],[50,30],[0,30]],homography:[1,0,0,0,1,0,0,0],mmPerPixel:null,opticalCentre:[25,15],bitmap:null,size:{},photoLoading:false});
  context.panel=panel;
  vm.runInContext('const leftPanel=panel,rightPanel=panel;const designStatus={};globalThis.status=designStatus;'+app.slice(app.indexOf('function framePayload()'),app.indexOf("document.getElementById('preview-frame')"))+';globalThis.payload=framePayload;globalThis.makeFrame=makeFrame;',context);
  return {panel,field,context};
}

test('geometry/calibration changes revoke confirmed evidence even when dimensions still pass',()=>{
  const {panel,field}=harness();
  panel.updateMeasurement();
  for (const change of [()=>panel.points[0][0]+=0.1,()=>panel.points=panel.points.map(p=>[...p]).reverse(),()=>panel.homography=[1,0,0,0,1,0.01,0,0],()=>panel.mmPerPixel=0.1,()=>panel.opticalCentre=[24,15],()=>panel.photoVersion++]) {
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

test('loading a photo blocks preview, checked export and experimental export',async()=>{
  const {panel,context}=harness();panel.photoLoading=true;
  assert.throws(()=>context.payload(),/finish loading/);
  for(const args of [[true,false],[false,false],[false,true]]) {
    await context.makeFrame(...args);
    assert.match(context.status.textContent,/finish loading/);
  }
});

test('pending archive owns loading state; a later photo or archive wins the race',async()=>{
  for (const laterArchive of [false,true]) {
    const {panel,context}=harness();
    const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
    const first=deferred(),second=deferred();let requests=0;
    context.fetch=url=>url==='/api/import' ? (++requests===1?first.promise:second.promise) : Promise.resolve({blob:async()=>new Blob([url])});
    context.createImageBitmap=async()=>({width:80,height:60,close(){}});
    Object.assign(panel,{side:'left',select:{replaceChildren(){}},placeholder:{},scaleStatus:{},markerStatus:{},centreStatus:{},status:{},canvas:{},render(){}});
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
