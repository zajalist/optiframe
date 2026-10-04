import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveSegmentSession} from './live-segment.js';
import {sheetHomography,project,unproject} from './calibration.js';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const originalPose=[[.15,.15],[.8,.15],[.8,.8],[.15,.8]];
const changedPose=[[.24,.12],[.86,.20],[.78,.88],[.1,.72]];
const rawContour=[[300,250],[600,250],[600,480],[300,480]];
const markers=(pose,width,height)=>pose.map(([x,y])=>[x*width,y*height]);

function setup(t) {
  const old={document:globalThis.document,raf:globalThis.requestAnimationFrame,cancel:globalThis.cancelAnimationFrame};
  let scheduled, canvasId=0, response, captured;
  const trackingSizes=[];
  function canvas() {
    const value={id:canvasId++,width:0,height:0,pose:null,paths:[],path:[],textContent:'',
      addEventListener(){},toBlob(done){done(new Blob(['unaltered-original']));}};
    const context={
      clearRect(){value.paths=[];},beginPath(){value.path=[];},closePath(){},
      moveTo(x,y){value.path.push([x,y]);},lineTo(x,y){value.path.push([x,y]);},
      stroke(){value.paths.push(value.path.map(p=>[...p]));},save(){},restore(){},arc(){},fill(){},
      drawImage(source){value.pose=source.pose;},
      getImageData(x,y,width,height){
        if(width<=480)trackingSizes.push([width,height]);
        return {width,height,pose:value.pose,data:new Uint8ClampedArray(width*height*4).fill(180)};
      },
    };
    value.getContext=()=>context;
    return value;
  }
  globalThis.document={createElement:canvas};
  globalThis.requestAnimationFrame=callback=>{scheduled=callback;return 1;};
  globalThis.cancelAnimationFrame=()=>{scheduled=null;};
  const video={videoWidth:1920,videoHeight:1440,currentTime:1,pose:originalPose,play:async()=>{},pause(){}};
  const overlay=canvas(), source={width:960,height:720,contour:rawContour.map(p=>[...p]),
    presence:{detected:true},quality:{score:.8,sharpness:180}};
  const session=createLiveSegmentSession({video,overlay,status:canvas(),captureButton:canvas(),
    autoCapture:true,intervalMs:10000,
    mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})},
    apiFetch:()=>new Promise(resolve=>{response=()=>resolve({ok:true,json:async()=>source});}),
    calibrateFrame(pixels,contour){
      if(!pixels.pose)return null;
      const corners=markers(pixels.pose,pixels.width,pixels.height),h=sheetHomography(corners);
      return {markers:corners,contour:contour.map(p=>project(p,h))};
    },
    onCapture:async value=>{captured=value;},
  });
  t.after(()=>{
    session.stop();
    globalThis.document=old.document;
    globalThis.requestAnimationFrame=old.raf;
    globalThis.cancelAnimationFrame=old.cancel;
  });
  return {session,video,overlay,source,trackingSizes,
    reply:async()=>{while(!response)await pause(1);response();await pause(5);},
    tick:async()=>{await pause(205);const callback=scheduled;assert.ok(callback);callback();},
    get captured(){return captured;},
  };
}

function assertPoints(actual,expected) {
  assert.equal(actual.length,expected.length);
  actual.forEach((point,i)=>point.forEach((v,axis)=>assert.ok(Math.abs(v-expected[i][axis])<1e-6)));
}

test('delayed SAM outline follows the current perspective without changing captured measurements',async t=>{
  const fixture=setup(t);
  await fixture.session.start();
  fixture.video.pose=changedPose;
  await fixture.reply();
  const initial=sheetHomography(markers(originalPose,960,720));
  const current=sheetHomography(markers(changedPose,480,360));
  const expected=rawContour.map(p=>unproject(project(p,initial),current).map(v=>v*2));
  assertPoints(fixture.overlay.paths.at(-1),expected);
  assert.notDeepEqual(fixture.overlay.paths.at(-1),rawContour);
  assert.deepEqual(fixture.source.contour,rawContour);
  assert.deepEqual(fixture.trackingSizes,[[480,360]]);
  // Exercise the stored source capture, independently of its preview drawing.
  await fixture.session.capture(undefined,true);
  assert.deepEqual(fixture.captured.contour,rawContour);
  assert.equal(await fixture.captured.file.text(),'unaltered-original');
  assert.deepEqual(fixture.captured.markers,markers(originalPose,960,720));
});

test('lost or invalid sheet markers hide the outline and valid markers restore it',async t=>{
  const fixture=setup(t);
  await fixture.session.start();await fixture.reply();
  assert.equal(fixture.overlay.paths.length,1);
  fixture.video.pose=null;await fixture.tick();
  assert.equal(fixture.overlay.paths.length,0);
  fixture.video.pose=[originalPose[0],originalPose[2],originalPose[1],originalPose[3]];
  await fixture.tick();assert.equal(fixture.overlay.paths.length,0);
  fixture.video.pose=changedPose;await fixture.tick();
  assert.equal(fixture.overlay.paths.length,1);
  assert.deepEqual(fixture.source.contour,rawContour);
  assert.ok(fixture.trackingSizes.every(([width,height])=>Math.max(width,height)<=480));
});
