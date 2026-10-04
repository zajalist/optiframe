import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveSegmentSession} from './live-segment.js';
import {sheetHomography,project,unproject} from './calibration.js';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const outline=Array.from({length:80},(_,i)=>[50+25*Math.cos(i*Math.PI/40),35+20*Math.sin(i*Math.PI/40)]);
const poses=[[[.15,.15],[.85,.15],[.85,.85],[.15,.85]],[[.20,.18],[.80,.18],[.85,.85],[.15,.85]],
 [[.15,.15],[.85,.15],[.80,.82],[.20,.82]]];
const markers=(index,w,h)=>poses[index%3].map(([x,y])=>[x*w,y*h]);
function setup(t,{lost=false,requireRemoval=false}={}) {
 const previous=globalThis.document;let captured=null,index=0;const requests=[];
 const canvas=()=>{const value={width:0,height:0,index:0,textContent:'',addEventListener(){},
   toBlob(done,type,quality){done(new Blob([`jpeg-${value.index}-${quality}`]));}};
  value.getContext=()=>({drawImage(source){value.index=source.index??index;},clearRect(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},stroke(){},save(){},restore(){},arc(){},fill(){},
   getImageData(x,y,width,height){return {width,height,index:value.index,data:new Uint8ClampedArray(width*height*4).fill(180)};}});
  return value;};
 globalThis.document={createElement:canvas};
 const video={videoWidth:1920,videoHeight:1440,get currentTime(){return index;},get index(){return index;},play:async()=>{},pause(){}};
 const session=createLiveSegmentSession({video,overlay:canvas(),status:canvas(),captureButton:canvas(),viewSweep:true,autoCapture:true,intervalMs:50,
  mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})},
  calibrateFrame(pixels,contour){if(lost&&pixels.index>=2)return null;
   const corners=markers(pixels.index,pixels.width,pixels.height),h=sheetHomography(corners);
   return {markers:corners,contour:contour.map(p=>project(p,h))};},
  apiFetch:async(path,options)=>{requests.push({path,image:await options.body.get('image').text()});const id=index++;
   await pause(260);const h=sheetHomography(markers(id,1600,1200));
   return {ok:true,json:async()=>({width:1600,height:1200,contour:outline.map(p=>unproject(p,h)),
    presence:{detected:true},edgeRefinement:{accepted:true},quality:{score:.8,sharpness:180+id}})};},
  captureFrame:()=>{throw new Error('Sweep must not request an extra burst');},
  onCapture:async value=>{captured=value;},
 });
 t.after(()=>{session.stop();globalThis.document=previous;});
 return {session,requests,start:()=>session.start({requireRemoval}),get captured(){return captured;}};
}
test('sweep fuses diverse live originals with no extra GPU request and preserves the reference JPEG',async t=>{
 const fixture=setup(t);await fixture.start();
 const deadline=Date.now()+3500;while(!fixture.captured&&Date.now()<deadline)await pause(20);
 assert.ok(fixture.captured,'diverse live views should produce a capture');
 assert.equal(fixture.captured.source,'view-sweep');
 assert.equal(fixture.captured.width,1600);assert.equal(fixture.captured.height,1200);
 assert.ok(fixture.captured.refinement.viewCount>=3);
 assert.ok(fixture.captured.refinement.collectionMs>=1200);
 assert.ok(fixture.requests.every(request=>request.path==='/api/live-segment'&&request.image.endsWith('-0.95')));
 const image=await fixture.captured.file.text();assert.ok(fixture.requests.some(request=>request.image===image));
 const h=sheetHomography(fixture.captured.markers);
 const points=fixture.captured.contour.map(point=>project(point,h));
 const width=Math.max(...points.map(p=>p[0]))-Math.min(...points.map(p=>p[0]));
 assert.ok(Math.abs(width-50)<.2);
});
test('missing calibration resets a sweep and cannot export accumulated earlier views',async t=>{
 const fixture=setup(t,{lost:true});await fixture.start();await pause(1900);
 assert.equal(fixture.captured,null);assert.equal(fixture.session.active,true);
});
test('sweep preserves first-lens removal gate and stopping invalidates late replies',async t=>{
 const fixture=setup(t,{requireRemoval:true});await fixture.start();await pause(1600);
 assert.equal(fixture.captured,null);fixture.session.stop();await pause(400);
 assert.equal(fixture.captured,null);assert.equal(fixture.session.active,false);
});
