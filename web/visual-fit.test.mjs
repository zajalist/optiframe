import test from 'node:test';
import assert from 'node:assert/strict';
import {visualFitPayload,captureOutlines,nativeTryOnFile} from './visual-fit.js';
const ellipse=(cx,cy,rx,ry)=>Array.from({length:64},(_,i)=>[cx+rx*Math.cos(i*Math.PI/32),cy+ry*Math.sin(i*Math.PI/32)]);
test('visual fit ignores patient values, centres contours and leaves source unchanged',()=>{
  const outlines=[ellipse(72,45,27.6,21.4),ellipse(44,51,23.7,17.8)],copy=structuredClone(outlines);
  const p=visualFitPayload(outlines,'bold');
  assert.deepEqual(outlines,copy);assert.equal(p.settings.alignment_source,'illustrative');
  assert.ok(p.settings.left_pd+p.settings.right_pd-27.6-23.7>13.2);
  assert.equal(p.settings.edge_thickness,2);assert.equal(p.settings.frame_style,'bold');
});
test('wide visual samples scale uniformly and remain within preview limits',()=>{
  const p=visualFitPayload([ellipse(0,0,45,20),ellipse(0,0,30,20)]);
  assert.equal(p.settings.left_pd,38);assert.equal(p.left[0][0],30);assert.equal(p.right[0][0],20);
});
test('capture projection uses sheet and never optical marks or patient inputs',()=>{
  const contour=ellipse(500,350,250,180),markers=[[0,0],[1000,0],[1000,700],[0,700]];
  const pair=captureOutlines(['left','right'].map(side=>({side,contour,markers,opticalCentre:[9999,9999]})));
  assert.ok(Math.abs(pair[0][0][0]-75)<1e-8);
  assert.throws(()=>captureOutlines([{side:'left',contour,markers}]));
});
test('malformed outlines rejected and native file stays explicitly visual',()=>{
  assert.throws(()=>visualFitPayload([[],[]]));assert.throws(()=>visualFitPayload([ellipse(0,0,20,15),[[NaN,0]]]));
  const original={alignmentSource:'provider-marked',meshes:[]};const native=nativeTryOnFile(original);
  assert.equal(native.alignmentSource,'illustrative');assert.equal(native.purpose,'visual-try-on');assert.equal(original.alignmentSource,'provider-marked');
});
