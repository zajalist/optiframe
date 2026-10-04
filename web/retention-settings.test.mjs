import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createLensAdjustmentStore,adjustLensPair} from './lens-adjustments.js';
const app=await readFile(new URL('./app.js',import.meta.url),'utf8');
function harness(saved){
 const storage=new Map([['optiframe-retention-style',saved]]);let invalidations=0;
 const context=vm.createContext({createLensAdjustmentStore,adjustLensPair,sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},invalidateFrameResult(){invalidations++;}});
 vm.runInContext(app.slice(app.indexOf("let frameStyle ="),app.indexOf('class LensPanel')),context);
 const panel={millimetreOutline:()=>[[1,2],[3,4],[0,4]],topMark:[1,1]};
 context.leftPanel=panel;context.rightPanel=panel;context.number=()=>32;
 vm.runInContext(app.slice(app.indexOf('function framePayload()'),app.indexOf('async function makeFrame(')),context);
 return {context,storage,get invalidations(){return invalidations;}};
}
test('retention defaults safely, persists valid choices, and submits selection to generated geometry',()=>{
 const h=harness('invalid');assert.equal(h.context.getRetentionStyle(),'screw');
 assert.equal(h.context.framePayload().settings.retention_style,'screw');
 h.context.setRetentionStyle('snap');assert.equal(h.storage.get('optiframe-retention-style'),'snap');
 assert.equal(h.context.framePayload().settings.retention_style,'snap');assert.equal(h.invalidations,1);
 h.context.setRetentionStyle('snap');assert.equal(h.invalidations,1);
 assert.throws(()=>h.context.setRetentionStyle('glue'),/Unknown lens retention/);
 assert.equal(h.context.getRetentionStyle(),'snap');
 assert.equal(harness('snap').context.getRetentionStyle(),'snap');
});
