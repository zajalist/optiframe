import test from 'node:test';
import assert from 'node:assert/strict';
import {sheetHomography,project,measure,benchmark,pixelResolution,contourRepeatability} from './calibration.js';
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
test('edge repeatability removes translation and detects changed edge with same bounding size',()=>{
 const a=[[0,0],[50,0],[50,30],[0,30]];
 assert.ok(contourRepeatability(a,a.map(([x,y])=>[x+12,y-8])).error<1e-8);
 const dent=[[0,0],[50,0],[50,30],[25,28],[0,30]];
 assert.equal(measure(dent,1).width,50);assert.equal(measure(dent,1).height,30);
 assert.equal(contourRepeatability(a,dent).pass,false);
 assert.equal(contourRepeatability(null,a).pass,false);
});
