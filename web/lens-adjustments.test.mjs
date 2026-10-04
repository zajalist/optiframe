import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {normalizeLensAdjustments,hasLensAdjustments,transformLensOutline,adjustLensPair,createLensAdjustmentStore,validCaptureIdentity} from './lens-adjustments.js';

const left=[[0,0],[4,0],[3,2],[-1,1]],right=[[0,0],[2,0],[1,3]];
const area=p=>p.reduce((sum,[x,y],i)=>{const q=p[(i+1)%p.length];return sum+x*q[1]-q[0]*y;},0)/2;
const distances=p=>p.flatMap((a,i)=>p.slice(i+1).map(b=>Math.hypot(a[0]-b[0],a[1]-b[1]))).sort((a,b)=>a-b);
const id1='3fd05610-3b40-4e66-aeb6-41e6b79e9921',id2='3fd05610-3b40-4e66-aeb6-41e6b79e9922',id3='3fd05610-3b40-4e66-aeb6-41e6b79e9923';
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
const payloadCode=source.slice(source.indexOf('function framePayload()'),source.indexOf('async function makeFrame('));

test('rotation and mirror preserve optical origin, all distances, area and winding',()=>{
  for(const rotation of [-179,-35,0,90,180,367])for(const mirror of [false,true]){
    const result=transformLensOutline(left,{rotation,mirror});
    assert.ok(result.some(p=>p[0]===0&&p[1]===0));
    distances(left).forEach((distance,i)=>assert.ok(Math.abs(distance-distances(result)[i])<1e-10));
    assert.ok(Math.abs(area(result)-area(left))<1e-10);
  }
  assert.deepEqual(transformLensOutline([[1,0],[0,0],[0,1]],{rotation:90}),[[0,-1],[0,0],[1,0]]);
  assert.deepEqual(left,[[0,0],[4,0],[3,2],[-1,1]]);
});

test('mirror is applied before rotation and swap carries source thickness',()=>{
  const result=adjustLensPair({left:{outline:left,thickness:1.2},right:{outline:right,thickness:5.4}},
    {swapped:true,left:{rotation:90,mirror:true}});
  assert.deepEqual(result.right,transformLensOutline(left,{rotation:90,mirror:true}));
  assert.deepEqual(result.left,right);
  assert.equal(result.leftThickness,5.4);assert.equal(result.rightThickness,1.2);
  assert.deepEqual(result.sourceSides,{left:'right',right:'left'});assert.equal(result.modified,true);
  result.left[0][0]=99;assert.equal(right[0][0],0);
});

test('state normalizes equivalent rotations and rejects invalid controls',()=>{
  assert.equal(hasLensAdjustments({left:{rotation:720}}),false);
  assert.equal(normalizeLensAdjustments({right:{rotation:181}}).right.rotation,-179);
  for(const state of [{swapped:1},{left:{rotation:NaN}},{right:{rotation:'90'}},{left:{mirror:'false'}}])assert.throws(()=>normalizeLensAdjustments(state));
  assert.throws(()=>transformLensOutline([[0,0],[1,0],[Infinity,1]]));
});

test('session state restores only the exact source capture pair and replacement resets it',()=>{
  const store=createLensAdjustmentStore();assert.throws(()=>store.set({swapped:true}));
  store.bindPair([id1,id2]);store.set({left:{rotation:15},swapped:true});const record=store.record();
  const copied=store.get();copied.left.rotation=123;assert.equal(store.get().left.rotation,15);
  store.bindPair([id1,id3]);assert.equal(hasLensAdjustments(store.get()),false);assert.equal(store.restore(record),false);
  store.bindPair([id2,id1]);assert.equal(store.restore(record),false);
  store.bindPair([id1,id2]);assert.equal(store.restore(record),true);assert.equal(store.get().swapped,true);
  assert.equal(store.reset(),true);assert.equal(store.reset(),false);
  store.bindPair([{},{}]);store.set({swapped:true});assert.equal(store.record(),null);
  assert.equal(validCaptureIdentity('left'),false);
});

test('CAD assignment preserves wearer PD and offsets and downgrades alignment provenance',()=>{
  let state=normalizeLensAdjustments();
  const values={'left-edge-thickness':1.2,'right-edge-thickness':5.4,'left-pd':31,'right-pd':33,'left-vertical-offset':2,'right-vertical-offset':-1};
  const context=vm.createContext({adjustLensPair,getLensAdjustments:()=>state,leftPanel:{millimetreOutline:()=>left,topMark:[0,-1]},rightPanel:{millimetreOutline:()=>right,topMark:[0,-1]},frameStyle:'classic',retentionStyle:'screw',measurementSource:'manual',number:key=>values[key]??100});
  vm.runInContext(payloadCode,context);
  assert.equal(context.framePayload().settings.alignment_source,'provider-marked');
  state=normalizeLensAdjustments({swapped:true,right:{rotation:90}});const payload=context.framePayload();
  assert.deepEqual(payload.left,transformLensOutline(right,{rotation:90}));
  assert.equal(payload.settings.left_edge_thickness,5.4);assert.equal(payload.settings.right_edge_thickness,1.2);
  assert.equal(payload.settings.left_pd,31);assert.equal(payload.settings.right_pd,33);
  assert.equal(payload.settings.left_vertical_offset,2);assert.equal(payload.settings.right_vertical_offset,-1);
  assert.equal(payload.settings.alignment_source,'illustrative');
});

test('nonidentity controls permit preview and prototype but reject checked export',async()=>{
  const start=source.indexOf('async function makeFrame('),end=source.indexOf('    const payload = framePayload();',start);
  for(const state of [{swapped:true},{left:{rotation:5}},{right:{mirror:true}}]){
    const context=vm.createContext({automaticPreview:null,measurementSource:'manual',leftPanel:{},rightPanel:{},hasLensAdjustments,getLensAdjustments:()=>state});
    vm.runInContext(source.slice(start,end)+`return 'allowed';}catch(error){return error.message;}}`,context);
    assert.equal(await context.makeFrame(true),'allowed');assert.equal(await context.makeFrame(false,true),'allowed');
    assert.match(await context.makeFrame(false,false),/prototype only/);
  }
});

test('app adjustment changes and resets invalidate outstanding frame requests and persist exact identities',()=>{
  const saved=new Map(),leftPanel={captureIdentity:id1,photo:{},side:'left',millimetreOutline:()=>left},rightPanel={captureIdentity:id2,photo:{},side:'right',millimetreOutline:()=>right};
  const context=vm.createContext({leftPanel,rightPanel,createLensAdjustmentStore,adjustLensPair,document:{getElementById:()=>null},sessionStorage:{setItem:(key,value)=>saved.set(key,value)},makeFrame:{sequence:7},automaticPreview:null});
  vm.runInContext('let frameAssembly={};'+source.slice(source.indexOf('const lensAdjustmentStore='),source.indexOf('function getMeasurementSource()'))+source.slice(source.indexOf('function invalidateFrameResult()'),source.indexOf('function frameSnapshot(')),context);
  context.setLensAdjustments({left:{rotation:5}});assert.equal(context.makeFrame.sequence,8);assert.equal(vm.runInContext('frameAssembly',context),null);
  assert.deepEqual(JSON.parse(saved.get('optiframe-lens-adjustments')).pairIds,[id1,id2]);
  context.setLensAdjustments({left:{rotation:5}});assert.equal(context.makeFrame.sequence,8);
  context.resetLensAdjustments();assert.equal(context.makeFrame.sequence,9);
  assert.equal(hasLensAdjustments(context.getLensAdjustments()),false);
  context.setLensAdjustments({swapped:true});leftPanel.captureIdentity=id3;assert.equal(hasLensAdjustments(context.getLensAdjustments()),false);
  rightPanel.millimetreOutline=()=>null;assert.throws(()=>context.getAdjustedLensOutlines(),/Both normalized/);
  rightPanel.photoLoading=true;assert.throws(()=>context.getAdjustedLensOutlines(),/photos to load/);
});
