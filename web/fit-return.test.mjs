import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createLensAdjustmentStore,validCaptureIdentity} from './lens-adjustments.js';
import {saveConfirmedFace} from './face-confirmation.js';

const fit=readFileSync(new URL('./fit-flow.js',import.meta.url),'utf8');
const app=readFileSync(new URL('./app.js',import.meta.url),'utf8');
const tryOn=readFileSync(new URL('./try-on.js',import.meta.url),'utf8');
const ids=['left-pd','right-pd','left-edge-thickness','right-edge-thickness','left-vertical-offset','right-vertical-offset','temple-length','bed-width','bed-depth'];
const pair=['left','right'].map((side,i)=>({side,captureIdentity:`3fd05610-3b40-4e66-aeb6-41e6b79e992${i+1}`,image:'data:image/jpeg;base64,fixture',width:1000,height:700,refinement:{accepted:true}}));
function storage(initial={}){const data=new Map(Object.entries(initial));return{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};}
function saveHandoff(){
  const store=storage(),fields=Object.fromEntries(ids.map((id,i)=>[id,{value:String(30+i)}]));
  const panels=pair.map((item,i)=>({captureIdentity:item.captureIdentity,canvas:{width:500,height:350},points:[[10+i,20],[40,50],[60,30]],markerPoints:[[0,0],[500,0],[500,350],[0,350]],opticalCentre:[25+i,30],topMark:i?[25,10]:null,illustrativeAlignment:i===0}));
  const context=vm.createContext({captureBackup:null,getImportedCaptures:()=>pair,left:panels[0],right:panels[1],fields:id=>fields[id],getMeasurementSource:()=>'manual',sessionStorage:store});
  vm.runInContext(fit.slice(fit.indexOf('  function saveCurrentCaptures()'),fit.indexOf('  function visualTryOn()')),context);
  context.saveCurrentCaptures();return{store,fields,panels};
}

test('try-on handoff preserves source identities, image, marks and all fitting values despite completed import',()=>{
  const {store,fields}=saveHandoff();
  const saved=JSON.parse(store.getItem('optiframe-captures'));
  assert.deepEqual(saved.map(item=>item.captureIdentity),pair.map(item=>item.captureIdentity));
  assert.equal(saved[0].image,pair[0].image);assert.deepEqual(saved[0].refinement,{accepted:true});
  assert.deepEqual(saved[0].opticalCentre,[50,60]);assert.equal(saved[0].topMark,undefined);
  assert.deepEqual(saved[1].topMark,[50,20]);assert.equal(saved[0].illustrativeAlignment,true);
  assert.deepEqual(saved[1].contour,[[22,40],[80,100],[120,60]]);
  const record=JSON.parse(store.getItem('optiframe-fit-inputs'));
  assert.deepEqual(record.values,Object.fromEntries(ids.map(id=>[id,fields[id].value])));
  assert.equal(record.measurementSource,'manual');
  const adjustments=createLensAdjustmentStore();adjustments.bindPair(pair.map(item=>item.captureIdentity));adjustments.set({swapped:true,left:{rotation:15,mirror:true}});
  const returned=createLensAdjustmentStore();returned.bindPair(saved.map(item=>item.captureIdentity));
  assert.equal(returned.restore(adjustments.record()),true);assert.deepEqual(returned.get(),adjustments.get());
});

function restore(store,confirmedFace=null){
  const fields=Object.fromEntries(ids.map(id=>[id,{value:'',matches:()=>true}]));
  const context=vm.createContext({sessionStorage:store,document:{getElementById:id=>fields[id]},loadConfirmedFace:()=>confirmedFace});
  vm.runInContext("let measurementSource='manual';"+app.slice(app.indexOf('let restoredMeasurementSource=null;'),app.indexOf('const designStatus =')),context);
  return{fields,context,source:vm.runInContext('measurementSource',context)};
}

test('return restores manual pupil distances and source without reviving a stale face estimate',()=>{
  const {store}=saveHandoff();const restored=restore(store,{left:25,right:26,source:'browser-iris-estimate'});
  assert.equal(restored.fields['left-pd'].value,'30');assert.equal(restored.fields['right-pd'].value,'31');
  assert.equal(restored.source,'manual');assert.equal(restored.context.getRestoredMeasurementSource(),'manual');
  assert.equal(store.getItem('optiframe-fit-inputs'),null);
  const context=vm.createContext({loadConfirmedFace:()=>({source:'browser-iris-estimate'}),getRestoredMeasurementSource:()=> 'manual'});
  vm.runInContext(fit.slice(fit.indexOf('  let step = 0,'),fit.indexOf("  if(new URLSearchParams(location.search).get('measure')"))+"globalThis.restoredMethod=method;",context);
  assert.equal(context.restoredMethod,'manual');
});

test('legacy fitting values and fresh confirmed estimates still restore; malformed source is ignored',()=>{
  assert.equal(restore(storage({'optiframe-fit-inputs':JSON.stringify({'left-pd':'31'})})).fields['left-pd'].value,'31');
  const fresh=restore(storage(),{left:30.2,right:32.1,source:'arkit-eye-transform-estimate'});
  assert.equal(fresh.fields['left-pd'].value,'30.2');assert.equal(fresh.source,'arkit-eye-transform-estimate');
  assert.equal(restore(storage({'optiframe-fit-inputs':JSON.stringify({values:{},measurementSource:'bogus'})})).context.getRestoredMeasurementSource(),null);
});

test('explicit face confirmation replaces saved PD and source while preserving lens-specific fitting data',()=>{
  const {store}=saveHandoff(),before=JSON.parse(store.getItem('optiframe-fit-inputs'));
  const context=vm.createContext({sessionStorage:store,saveConfirmedFace:value=>saveConfirmedFace(value,store),renderFace(){},$:()=>({textContent:''})});
  const callback=tryOn.slice(tryOn.indexOf('onConfirm:values=>{')+'onConfirm:'.length,tryOn.indexOf('},onManual:()=>{')+1);
  vm.runInContext('globalThis.confirm='+callback,context);
  context.confirm({left:29.7,right:32.2,source:'browser-iris-estimate'});
  const after=JSON.parse(store.getItem('optiframe-fit-inputs'));
  assert.deepEqual(after.values,{...before.values,'left-pd':'29.7','right-pd':'32.2'});
  const returned=restore(store);assert.equal(returned.source,'browser-iris-estimate');assert.equal(returned.fields['right-pd'].value,'32.2');
});

test('completed async capture import retains the image handoff after consuming session storage',async()=>{
  const saved=pair.map(item=>({...item,contour:[[20,30],[40,50],[60,20]],markers:[[0,0],[1000,0],[1000,700],[0,700]],opticalCentre:[40,30],topMark:[40,10]}));
  const store=storage({'optiframe-captures':JSON.stringify(saved)});
  const panel=()=>({canvas:{width:500,height:350},loadPhoto:async()=>true,markerStatus:{},render(){},setMode(){}});
  const leftPanel=panel(),rightPanel=panel();
  const context=vm.createContext({sessionStorage:store,leftPanel,rightPanel,validCaptureIdentity,fetch:async()=>({blob:async()=>({})}),sheetHomography:()=>[1,0,0,0,1,0,0,0,1],document:{body:{classList:{add(){}}},getElementById:()=>({}),querySelector:()=>({})},syncLensAdjustmentPair(){},lensAdjustmentStore:{restore(){}}});
  vm.runInContext(app.slice(app.indexOf('let importedCaptures=null;'),app.indexOf('const capturesReady =')),context);
  await context.importSimpleCaptures();
  assert.equal(store.getItem('optiframe-captures'),null);
  assert.deepEqual(JSON.parse(JSON.stringify(context.getImportedCaptures())),saved);
  assert.equal(leftPanel.captureIdentity,pair[0].captureIdentity);
  assert.deepEqual(Array.from(rightPanel.opticalCentre),[20,15]);
});
