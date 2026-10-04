import test from 'node:test';
import assert from 'node:assert/strict';
import {createFaceEstimator,estimateFaceFrame,assessFaceLighting} from './face-estimate.js';

const width=800,height=600;
function fixture({scale=1,roll=0,dx=0,dy=0}={}) {
  const points=Array.from({length:478},()=>({x:400,y:300,z:0}));
  const set=(i,x,y,z=0)=>{points[i]={x,y,z};};
  set(468,300,250);set(473,500,250);
  // A 200px inter-iris span at this diameter represents 64 nominal millimetres.
  const radius=(200*11.7/64)/2;
  for(const [start,x] of [[469,300],[474,500]]) {
    set(start,x+radius,250);set(start+1,x,250-radius);
    set(start+2,x-radius,250);set(start+3,x,250+radius);
  }
  set(33,255,250);set(133,345,250);set(362,455,250);set(263,545,250);
  set(159,300,234);set(145,300,266);set(386,500,234);set(374,500,266);
  set(168,406.25,250,-10);set(1,406.25,310,-30);set(10,400,100);set(152,400,470);
  return points.map(p=>({x:(400+dx+scale*((p.x-400)*Math.cos(roll)-(p.y-300)*Math.sin(roll)))/width,
    y:(300+dy+scale*((p.x-400)*Math.sin(roll)+(p.y-300)*Math.cos(roll)))/height,z:p.z*scale/width}));
}
function run(estimator,points,from=0,to=2100,step=50) {
  let response;
  for(let now=from;now<=to;now+=step)response=estimator.update(points,{width,height,now,frameId:now});
  return response;
}
test('wearer left473/right468 preserve asymmetry using the projected nose bridge',()=>{
  const result=estimateFaceFrame(fixture(),{width,height});
  assert.equal(result.valid,true);assert.ok(Math.abs(result.left-30)<1e-8);assert.ok(Math.abs(result.right-34)<1e-8);
});
test('translation, proportional scaling, frame resolution and mild roll preserve the estimate',()=>{
  for(const transform of [{dx:50,dy:-20},{scale:.7},{roll:.12},{scale:1.1,roll:-.15,dx:-10}]) {
    const points=fixture(transform);
    const result=estimateFaceFrame(points,{width,height});
    assert.equal(result.valid,true,JSON.stringify(transform));
    assert.ok(Math.abs(result.left-30)<1e-8);assert.ok(Math.abs(result.right-34)<1e-8);
    const resized=estimateFaceFrame(points,{width:width*2,height:height*2});
    assert.ok(Math.abs(resized.left-result.left)<1e-8);
  }
});
test('missing landmarks, nonfinite depth and invalid dimensions fail closed',()=>{
  assert.equal(estimateFaceFrame(fixture().slice(0,468),{width,height}).valid,false);
  for(const field of ['x','y','z']){const p=fixture();p[473][field]=NaN;assert.equal(estimateFaceFrame(p,{width,height}).valid,false);}
  for(const dimensions of [{width:0,height},{width,height:Infinity},{}])assert.equal(estimateFaceFrame(fixture(),dimensions).valid,false);
});
test('pose, gaze, blink, asymmetric iris and pixel resolution give short recovery cues',()=>{
  const cases=[
    [()=>fixture({roll:.3}),'Keep your head level'],
    [()=>fixture({scale:.3}),'Move closer'],
    [()=>{const p=fixture();p[473].z=.04;return p;},'Face the camera straight on'],
    [()=>{const p=fixture();p[1].x+=.04;return p;},'Face the camera straight on'],
    [()=>{const p=fixture();p[152].z=.3;return p;},'Hold the phone at eye level'],
    [()=>{const p=fixture();p[145].y=p[159].y+.01;return p;},'Open both eyes'],
    [()=>{const p=fixture();for(const i of [473,474,475,476,477])p[i].x+=.025;return p;},'Look at the camera'],
    [()=>{const p=fixture();for(const i of [474,475,476,477]){p[i].x=p[473].x+(p[i].x-p[473].x)*1.15;p[i].y=p[473].y+(p[i].y-p[473].y)*1.15;}return p;},'Face the camera straight on'],
    [()=>{const p=fixture();p[168].x+=.06;p[1].x+=.06;return p;},'Face the camera'],
  ];
  for(const [make,message] of cases)assert.deepEqual(estimateFaceFrame(make(),{width,height}),{valid:false,message});
});
test('a continuous two-second multi-frame window yields labeled nominal estimates only',()=>{
  const estimator=createFaceEstimator();
  assert.equal(run(estimator,fixture(),0,1950).state,'collecting');
  const ready=estimator.update(fixture(),{width,height,now:2000,frameId:2000});
  assert.equal(ready.state,'ready');assert.equal(ready.progress,1);
  assert.deepEqual(ready.result,{left:30,right:34,source:'browser-iris-estimate',sampleCount:41,
    assumedIrisDiameterMm:11.7,durationMs:2000,dispersionMm:0,scaleCalibrated:false,accuracyMm:null,totalRepeatabilityMm:0});
  assert.equal('templeLength' in ready.result,false);
  estimator.reset();assert.equal(estimator.update(fixture(),{width,height,now:2200}).state,'collecting');
});
test('median aggregation tolerates small alternating landmark jitter',()=>{
  const estimator=createFaceEstimator();let response;
  for(let now=0;now<=2000;now+=50) {
    const points=fixture();points[168].x+=(now%100?.75:-.75)/width;
    response=estimator.update(points,{width,height,now,frameId:now});
  }
  assert.equal(response.state,'ready');assert.ok(Math.abs(response.result.left-30)<.4);
  assert.ok(response.result.dispersionMm<.7);
});
test('a noisy two-second window is rejected even without one large outlier',()=>{
  const estimator=createFaceEstimator();let response;
  for(let now=0;now<=2000;now+=50) {
    const points=fixture();points[168].x+=(now%100?1:-1)/width;
    response=estimator.update(points,{width,height,now,frameId:now});
  }
  assert.equal(response.state,'guidance');assert.equal(response.result,undefined);
});
test('unstable estimates, tracking loss and gaps cannot reuse the prior stable span',()=>{
  for(const invalid of ['unstable','missing','gap','backwards']) {
    const estimator=createFaceEstimator();run(estimator,fixture(),0,1500);
    let response;
    if(invalid==='unstable'){const points=fixture();points[168].x+=6/width;response=estimator.update(points,{width,height,now:1550});}
    if(invalid==='missing')response=estimator.update([],{width,height,now:1550});
    if(invalid==='gap')response=estimator.update(fixture(),{width,height,now:2000});
    if(invalid==='backwards')response=estimator.update(fixture(),{width,height,now:1000});
    assert.notEqual(response.state,'ready');
    assert.notEqual(run(estimator,fixture(),2050,2500).state,'ready');
  }
});
test('duplicate video frames cannot satisfy duration or sample count',()=>{
  const estimator=createFaceEstimator();
  for(let now=0;now<5000;now+=50)
    assert.notEqual(estimator.update(fixture(),{width,height,now,frameId:1}).state,'ready');
});
test('one outlying estimate resets rather than silently averaging a changed face',()=>{
  const estimator=createFaceEstimator();run(estimator,fixture(),0,1800);
  const points=fixture();points[168].x-=5/width;
  assert.equal(estimator.update(points,{width,height,now:1850}).state,'guidance');
  assert.equal(run(estimator,fixture(),1900,2200).state,'collecting');
});
test('invalid sampling configurations cannot disable minimum evidence',()=>{
  for(const options of [{minDurationMs:10},{minSamples:1},{maxGapMs:Infinity},{maxGapMs:-1}])
    assert.throws(()=>createFaceEstimator(options),RangeError);
});

test('irises between the old 12px floor and 20px cannot yield a nominal scale',()=>{
  assert.deepEqual(estimateFaceFrame(fixture({scale:.45}),{width,height}),{valid:false,message:'Move closer'});
  assert.equal(estimateFaceFrame(fixture({scale:.6}),{width,height}).valid,true);
});
test('slow bridge drift is rejected even when total PD and overall spread look stable',()=>{
  const estimator=createFaceEstimator();let response;
  for(let now=0;now<=2000;now+=50){const points=fixture();points[168].x+=(now/2000)*(.9/.32)/width;response=estimator.update(points,{width,height,now,frameId:now});}
  assert.equal(response.state,'guidance');assert.equal(response.result,undefined);
  assert.equal(run(estimator,fixture(),2050,4150).state,'ready');
});
test('common iris-scale drift is rejected despite small per-eye residuals',()=>{
  const estimator=createFaceEstimator();let response;
  for(let now=0;now<=2000;now+=50){
    const points=fixture(),factor=64/(64+.9*now/2000);
    for(const [centre,indices] of [[468,[469,470,471,472]],[473,[474,475,476,477]]])
      for(const index of indices){points[index].x=points[centre].x+(points[index].x-points[centre].x)*factor;points[index].y=points[centre].y+(points[index].y-points[centre].y)*factor;}
    response=estimator.update(points,{width,height,now,frameId:now});
  }
  assert.equal(response.state,'guidance');assert.equal(response.result,undefined);
});
test('a completed window cannot freeze and reuse estimates for a changed face',()=>{
  const estimator=createFaceEstimator();assert.equal(run(estimator,fixture()).state,'ready');
  const changed=fixture();changed[168].x+=3/width;
  const result=estimator.update(changed,{width,height,now:2200,frameId:2200});assert.equal(result.state,'guidance');assert.equal(result.result,undefined);
});
test('framing separates a cropped close face from an off-centre face',()=>{
  assert.equal(estimateFaceFrame(fixture({scale:1.65}),{width,height}).message,'Move back until your face fits');
  assert.equal(estimateFaceFrame(fixture({dx:350}),{width,height}).message,'Centre your face');
});
test('distance and head movement cannot build a stable window merely because PD ratios match',()=>{
  for(const [transform,message] of [[{scale:1.1},'Keep the phone at one distance'],[{dx:30},'Keep your head and phone still'],[{roll:.08},'Keep your head and phone still']]){
    const estimator=createFaceEstimator();run(estimator,fixture(),0,1200);
    const result=estimator.update(fixture(transform),{width,height,now:1250,frameId:1250});
    assert.equal(result.state,'guidance');assert.equal(result.message,message);assert.equal(result.result,undefined);
    assert.equal(run(estimator,fixture(),1300,3350).state,'ready');
  }
});
test('tiny natural motion remains usable without claiming metric calibration',()=>{
  const estimator=createFaceEstimator();let result;
  for(let now=0;now<=2000;now+=50)result=estimator.update(fixture({dx:Math.sin(now/80)*2,scale:1+Math.sin(now/100)*.005,roll:Math.sin(now/90)*.005}),{width,height,now,frameId:now});
  assert.equal(result.state,'ready');assert.equal(result.result.accuracyMm,null);assert.equal(result.result.scaleCalibrated,false);
});
test('exposure guidance rejects extreme clipping, not normal darker skin or mild dimness',()=>{
  const pixels=value=>Uint8ClampedArray.from({length:64*4},(_,index)=>index%4===3?255:value);
  assert.equal(assessFaceLighting(pixels(5)).message,'Add light in front of your face');
  assert.equal(assessFaceLighting(pixels(253)).message,'Move out of the glare');
  for(const value of [24,45,80,140,220])assert.equal(assessFaceLighting(pixels(value)).usable,true);
  const estimator=createFaceEstimator();run(estimator,fixture(),0,1500);
  assert.equal(estimator.update(fixture(),{width,height,now:1550,frameId:1550,lighting:assessFaceLighting(pixels(5))}).state,'guidance');
  assert.notEqual(run(estimator,fixture(),1600,2100).state,'ready');
});
