import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {adjustLensPair,hasLensAdjustments,normalizeLensAdjustments} from './lens-adjustments.js';
const adjustmentContext={adjustLensPair,hasLensAdjustments,getLensAdjustments:()=>normalizeLensAdjustments()};
const source=await readFile(new URL('./app.js',import.meta.url),'utf8');
test('illustrative alignment allows preview and prototype, but blocks checked STL',async()=>{
  const start=source.indexOf('async function makeFrame('),end=source.indexOf('    const payload = framePayload();',start);
  const context=vm.createContext({...adjustmentContext,automaticPreview:null,measurementSource:'manual',leftPanel:{illustrativeAlignment:true},rightPanel:{illustrativeAlignment:false}});
  vm.runInContext(source.slice(start,end)+`return 'allowed';}catch(error){return error.message;}}`,context);
  assert.equal(await context.makeFrame(true),'allowed');
  assert.equal(await context.makeFrame(false,true),'allowed');
  assert.match(await context.makeFrame(false,false),/Checked export needs both provider/);
});
test('CAD payload explicitly distinguishes illustrative from provider alignment',()=>{
  const panel=()=>({millimetreOutline:()=>[[0,0],[1,0],[0,1]],topMark:[0,-1]});
  const left=panel(),right=panel(),context=vm.createContext({...adjustmentContext,leftPanel:left,rightPanel:right,frameStyle:'classic',retentionStyle:'screw',measurementSource:'browser-iris-estimate',number:()=>32});
  vm.runInContext(source.slice(source.indexOf('function framePayload()'),source.indexOf('async function makeFrame(')),context);
  assert.equal(context.framePayload().settings.alignment_source,'provider-marked');
  assert.equal(context.framePayload().settings.measurement_source,'browser-iris-estimate');
  right.illustrativeAlignment=true;assert.equal(context.framePayload().settings.alignment_source,'illustrative');
  right.illustrativeAlignment='marking';assert.equal(context.framePayload().settings.alignment_source,'illustrative');
});
test('confirming a camera estimate does not allow checked export',async()=>{
  const start=source.indexOf('async function makeFrame('),end=source.indexOf('    const payload = framePayload();',start);
  const context=vm.createContext({...adjustmentContext,automaticPreview:null,measurementSource:'browser-iris-estimate',leftPanel:{},rightPanel:{}});
  vm.runInContext(source.slice(start,end)+`return 'allowed';}catch(error){return error.message;}}`,context);
  assert.equal(await context.makeFrame(true),'allowed');
  assert.equal(await context.makeFrame(false,true),'allowed');
  assert.match(await context.makeFrame(false,false),/Face scan values are estimates/);
});
