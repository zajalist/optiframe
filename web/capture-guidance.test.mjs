import test from 'node:test';
import assert from 'node:assert/strict';
import {createCaptureGuidance, frameBrightness, optimizeCameraTrack} from './capture-guidance.js';
const base = {calibration:{markers:[[80,50],[560,50],[560,386],[80,386]]}, width:640,height:480,
  quality:{score:.7,sharpness:180,clippedFraction:0},presence:{detected:true},brightness:180,latencyMs:180,now:0,state:'steady'};
const settled = (guide, extra) => {guide.update({...base,...extra,now:0}); return guide.update({...base,...extra,now:350});};
test('distance instructions require measured marker size or clipping evidence', () => {
  assert.equal(settled(createCaptureGuidance(),{calibration:{markers:[[200,100],[400,100],[400,240],[200,240]]}}).message,'Move closer');
  assert.equal(settled(createCaptureGuidance(),{calibration:{markers:[[5,50],[560,50],[560,386],[5,386]]}}).message,'Move back slightly');
  const missing=settled(createCaptureGuidance(),{calibration:null});
  assert.equal(missing.message,'Show all four dots'); assert.equal(missing.ready,false);
});
test('darkness, glare and blur block capture with one short prioritized cue', () => {
  const dark=settled(createCaptureGuidance(),{brightness:20,quality:{sharpness:5,clippedFraction:.1}});
  assert.deepEqual(dark,{message:'Add soft light',ready:false});
  assert.deepEqual(settled(createCaptureGuidance(),{quality:{sharpness:180,clippedFraction:.05}}),{message:'Soften the light',ready:false});
  assert.deepEqual(settled(createCaptureGuidance(),{quality:{sharpness:10,clippedFraction:0}}),{message:'Let the camera focus',ready:false});
});
test('guidance resists flicker and sustained latency never claims a phone temperature', () => {
  const guide=createCaptureGuidance();
  assert.equal(guide.update({...base,brightness:20}).message,'');
  assert.equal(guide.update({...base,now:100}).message,'');
  assert.equal(guide.update({...base,now:450}).message,'Hold steady');
  guide.reset();
  for(let i=0;i<6;i++) guide.update({...base,latencyMs:800,now:i*200,state:'searching'});
  assert.equal(guide.update({...base,latencyMs:800,now:1400,state:'searching'}).message,'Processing slowly');
  guide.reset(); assert.equal(guide.update({...base,presence:{detected:false},state:'searching'}).message,'');
});
test('dark lens pixels do not classify a well-lit sheet as a dark scene', () => {
  const data=new Uint8ClampedArray(100*4).fill(180);
  data.fill(5,0,60*4);
  assert.equal(frameBrightness({data}),180);
  assert.equal(frameBrightness({data:new Uint8ClampedArray(400).fill(15)}),15);
});
test('white paper clipping does not block a supported lens boundary', () => {
  const bright=settled(createCaptureGuidance(),{brightness:255,quality:{sharpness:180,clippedFraction:.6},
    presence:{detected:true,evidence:{edgeSupport:.88,sectorsSupported:8}}});
  assert.deepEqual(bright,{message:'Hold steady',ready:true});
  const lost=settled(createCaptureGuidance(),{quality:{sharpness:180,clippedFraction:.6},
    presence:{detected:false,evidence:{edgeSupport:.3,sectorsSupported:3}},state:'searching'});
  assert.deepEqual(lost,{message:'Soften the light',ready:false});
});
test('camera tuning applies only supported continuous controls and rejection is harmless', async () => {
  const requests=[];
  await optimizeCameraTrack({getCapabilities:()=>({focusMode:['manual','continuous'],exposureMode:['manual'],whiteBalanceMode:['continuous']}),applyConstraints:async value=>requests.push(value)});
  assert.deepEqual(requests,[{advanced:[{focusMode:'continuous',whiteBalanceMode:'continuous'}]}]);
  await optimizeCameraTrack({getCapabilities:()=>({}),applyConstraints:async()=>assert.fail('unsupported tuning')});
  await optimizeCameraTrack({getCapabilities:()=>({focusMode:['continuous']}),applyConstraints:async()=>{throw Error('Unsupported');}});
  await optimizeCameraTrack({});
});

test('ambiguous shadow boundaries show a recovery cue and cannot qualify', () => {
  assert.deepEqual(settled(createCaptureGuidance(), {presence:{detected:false,reason:'edge-refinement-unsupported'}}),
    {message:'Edge unclear. Soften the light',ready:false});
});

test('undersampled sheet takes priority over ambiguous-edge lighting advice', () => {
  // Reproduced marker span from the user's phone screenshot at 960px preview.
  const calibration={markers:[[148,403],[383,402],[394,565],[146,570]]};
  for(const presence of [{detected:true},{detected:false,reason:'edge-refinement-unsupported'}]) {
    assert.deepEqual(settled(createCaptureGuidance(),{width:539,height:960,calibration,presence}),
      {message:'Move closer',ready:false});
  }
  assert.deepEqual(settled(createCaptureGuidance(),{calibration:null,presence:{detected:false,reason:'edge-refinement-unsupported'}}),
    {message:'Show all four dots',ready:false});
});
