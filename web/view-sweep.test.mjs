import test from 'node:test';
import assert from 'node:assert/strict';
import {createViewSweep,countDistinctViews} from './view-sweep.js';
import {sheetHomography,unproject} from './calibration.js';
const contour=Array.from({length:40},(_,i)=>[50+25*Math.cos(i*Math.PI/20),35+20*Math.sin(i*Math.PI/20)]);
const base=[[100,100],[900,100],[900,660],[100,660]];
const poses=[base,[[140,120],[860,120],[900,660],[100,660]],[[100,100],[900,100],[860,640],[140,640]]];
const frame=(time,markers=base,extra={})=>({id:time,sampledAt:time,width:1000,height:760,
  blob:new Blob(['original']),contour:contour.map(p=>unproject(p,sheetHomography(markers))),presence:{detected:true},edgeRefinement:{accepted:true},
  quality:{score:.8,sharpness:180},calibration:{markers,contour},...extra});
test('three perspective views preserve originals and finish after 1.2 seconds',()=>{
 const sweep=createViewSweep();const inputs=poses.map((pose,i)=>frame(i*650,pose));
 let result;for(const input of inputs)result=sweep.update(input,input.sampledAt+20);
 assert.equal(result.ready,true);assert.equal(result.viewCount,3);
 assert.equal(result.frames.length,3);assert.equal(result.frames[0].blob,inputs[0].blob);
 assert.deepEqual(result.frames[0].calibration.contour,contour);
 assert.notEqual(result.frames[0].calibration.contour,contour);
 assert.equal(result.frames[0].homography.length,8);
});
test('translation scale rotation and subpixel jitter do not manufacture view diversity',()=>{
 const sweep=createViewSweep();sweep.update(frame(0),20);
 for(let i=1;i<7;i++){
  const angle=i*.03,c=Math.cos(angle),s=Math.sin(angle);
  const transformed=base.map(([x,y])=>[(x*c-y*s)*(1+i*.01)+i*5+.1,(x*s+y*c)*(1+i*.01)+i*3]);
  const result=sweep.update(frame(i*500,transformed),i*500+20);
  assert.equal(result.ready,false);assert.equal(result.viewCount,1);
 }
 const result=sweep.update(frame(4100),4120);
 assert.equal(result.state,'retry');assert.equal(result.reason,'insufficient-view-change');
});
test('duplicates stale frames and missing markers cannot qualify; reset starts another lens',()=>{
 const sweep=createViewSweep();sweep.update(frame(0),20);
 assert.equal(sweep.update(frame(100,poses[1],{id:0}),120).viewCount,1);
 assert.equal(sweep.update(frame(100,poses[1]),3000).reason,'stale-frame');
 assert.equal(sweep.update(frame(120,poses[1],{calibration:null}),140).viewCount,1);
 sweep.reset();assert.equal(sweep.update(frame(200),220).viewCount,1);
});
test('a later original extends a diverse short arc without pretending to add another view',()=>{
 const sweep=createViewSweep();poses.forEach((pose,i)=>sweep.update(frame(i*200,pose),i*200+20));
 const result=sweep.update(frame(1300,poses[2]),1320);
 assert.equal(result.ready,true);assert.equal(result.viewCount,3);assert.equal(result.frames.length,4);
 assert.equal(new Set(result.frames.map(f=>f.id)).size,4);
});
test('invalid limits fail and repeated accepted views do not count as independent angles',()=>{
 for(const config of [{minFrames:NaN},{maxFrames:3.5},{maxDurationMs:NaN},{minViewChange:0}])assert.throws(()=>createViewSweep(config));
 assert.equal(countDistinctViews([frame(0),frame(1,poses[1]),frame(2,poses[1])]),2);
});
test('raw legacy edges unsupported refinement and malformed source contours never qualify',()=>{
 for(const extra of [{edgeRefinement:undefined},{edgeRefinement:{accepted:false}},
   {contour:[[1,2],[3,4],[5,6]]},{contour:Array.from({length:12},()=>[2000,30])}]){
  const sweep=createViewSweep();
  for(let i=0;i<3;i++)assert.equal(sweep.update(frame(i*650,poses[i],extra),i*650+20).viewCount,0);
 }
});
