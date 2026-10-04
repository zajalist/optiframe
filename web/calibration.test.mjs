import test from 'node:test';
import assert from 'node:assert/strict';
import {sheetHomography,project,unproject,measure,benchmark,pixelResolution,contourRepeatability,normalizeLensOrientation,outlineProofSVG} from './calibration.js';

test('fused millimetre edges map back to their reference image without a scale change',()=>{
 const h=sheetHomography([[50,30],[1050,80],[900,780],[100,680]]);
 for(const mm of [[20,15],[52.25,31.75],[80,60]])
  project(unproject(mm,h),h).forEach((v,i)=>assert.ok(Math.abs(v-mm[i])<1e-8));
 assert.throws(()=>unproject([0,0],[0,0,0,0,0,0,0,0]),/inverted/);
});
test('perspective quadrilateral maps to physical marker centres',()=>{
 const corners=[[50,30],[1050,80],[900,780],[100,680]], h=sheetHomography(corners);
 const targets=[[0,0],[100,0],[100,70],[0,70]];
 corners.forEach((p,i)=>project(p,h).forEach((v,k)=>assert.ok(Math.abs(v-targets[i][k])<1e-8)));
});
test('reject crossed, reversed, and severely foreshortened markers',()=>{
 for(const corners of [[[0,0],[100,70],[100,0],[0,70]],[[0,0],[0,70],[100,70],[100,0]],[[0,0],[100,0],[100,2],[0,2]]]) assert.throws(()=>sheetHomography(corners),/Marker geometry/);
});
test('rectified contour has expected dimensions and area',()=>{
 const h=sheetHomography([[10,20],[1010,20],[1010,720],[10,720]]);
 const result=measure([[210,220],[710,220],[710,520],[210,520]].map(p=>project(p,h)),1);
 assert.ok(Math.abs(result.width-50)<1e-8);assert.ok(Math.abs(result.height-30)<1e-8);assert.ok(Math.abs(result.area-1500)<1e-8);
});
test('physical benchmark threshold and incomplete evidence',()=>{
 const result={width:50,height:30};assert.equal(benchmark(result,{width:50.5,height:29.5}).pass,true);
 assert.equal(benchmark(result,{width:50.501,height:30}).pass,false);
 assert.equal(benchmark(result,{width:0,height:30}).pass,false);
 assert.equal(benchmark(null,{width:50,height:30}).pass,false);
});
test('resolution includes working-image downsampling',()=>{
 const h=sheetHomography([[0,0],[1000,0],[1000,700],[0,700]]);
 const r=pixelResolution([[500,350]],h,null,2,2);
 assert.ok(Math.abs(r.working-0.1)<1e-8);assert.ok(Math.abs(r.source-0.05)<1e-8);
});
test('edge repeatability preserves optical-centre placement and detects changed edge',()=>{
 const a=[[0,0],[50,0],[50,30],[0,30]];
 assert.ok(contourRepeatability(a,a).error<1e-8);
 const shifted=a.map(([x,y])=>[x+0.7,y]);
 assert.equal(contourRepeatability(a,shifted).pass,false);
 assert.ok(contourRepeatability(a,shifted).error>=0.69);
 const dent=[[0,0],[50,0],[50,30],[25,28],[0,30]];
 assert.equal(measure(dent,1).width,50);assert.equal(measure(dent,1).height,30);
 assert.equal(contourRepeatability(a,dent).pass,false);
 assert.equal(contourRepeatability(null,a).pass,false);
});

test('optical centre and top mark orient an asymmetric measured contour without changing scale or winding',()=>{
 const contour=[[-20,-10],[5,-15],[22,4],[-10,12]];
 const angle=37*Math.PI/180, origin=[103,42];
 const captured=point=>[
  origin[0]+Math.cos(angle)*point[0]-Math.sin(angle)*point[1],
  origin[1]+Math.sin(angle)*point[0]+Math.cos(angle)*point[1],
 ];
 const photographed=contour.map(captured);
 const result=normalizeLensOrientation(photographed,origin,captured([0,-15]));
 result.contour.forEach((point,i)=>point.forEach((coordinate,k)=>assert.ok(Math.abs(coordinate-contour[i][k])<1e-9)));
 assert.ok(Math.abs(result.top[0])<1e-9);
 assert.ok(Math.abs(result.top[1]+15)<1e-9);
 assert.ok(Math.abs(result.topAngleRadians-angle)<1e-9);
 assert.ok(Math.abs(result.appliedRotationRadians+angle)<1e-9);
 const signedArea=points=>points.reduce((sum,p,i)=>{
  const q=points[(i+1)%points.length];return sum+p[0]*q[1]-q[0]*p[1];
 },0)/2;
 assert.ok(Math.abs(signedArea(photographed)-signedArea(result.contour))<1e-9);
 for(let i=0;i<contour.length;i++) assert.ok(Math.abs(
  Math.hypot(...contour[i].map((v,k)=>v-contour[(i+1)%contour.length][k]))-
  Math.hypot(...result.contour[i].map((v,k)=>v-result.contour[(i+1)%contour.length][k]))
 )<1e-9);
});
test('orientation rejects invalid and coincident marks',()=>{
 const contour=[[0,0],[1,0],[0,1]];
 assert.throws(()=>normalizeLensOrientation(contour,[0,0],[0,0]),/at least 5 mm/);
 assert.throws(()=>normalizeLensOrientation(contour,[0,0],[4.9,0]),/at least 5 mm/);
 assert.throws(()=>normalizeLensOrientation(contour,[Infinity,0],[0,-1]),/finite/);
 assert.throws(()=>normalizeLensOrientation([[0,0],[1,NaN],[0,1]],[0,0],[0,-1]),/finite/);
 assert.throws(()=>normalizeLensOrientation(contour,[0,0],[0]),/finite/);
});
test('physical outline proof uses A4 millimetres and a separate 50 mm check line',()=>{
 const contour=Array.from({length:32},(_,i)=>[25*Math.cos(i*2*Math.PI/32),18*Math.sin(i*2*Math.PI/32)]);
 const svg=outlineProofSVG(contour,'left');
 assert.match(svg,/width="210mm" height="297mm" viewBox="0 0 210 297"/);
 assert.match(svg,/translate\(105 135\)/);
 assert.match(svg,/M15 253 H65/);
 assert.match(svg,/M25\.000 0\.000/);
 assert.throws(()=>outlineProofSVG(contour.map(([x,y])=>[x+100,y]),'left'),/safe A4/);
});
