import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFaceFit, lensReady, marksReady } from './fit-validation.js';
const scan = () => ({schemaVersion:1,kind:'optiframe-face-fit',units:'mm',source:'arkit-eye-transform-estimate',requiresProviderVerification:true,
  measurements:{leftMonocularEstimateMm:31,rightMonocularEstimateMm:32,totalEstimateMm:63},
  quality:{sampleCount:60,durationSeconds:3,leftStdDevMm:.2,rightStdDevMm:.3,thermalState:'nominal'},
  capability:{faceTrackingSupported:true,trueDepthAvailable:true},reference:'ARFaceAnchor local x=0; eye-transform origins, not clinical pupil centres'});
test('native estimate imports asymmetric PD without assigning clinical verification',()=>assert.deepEqual(validateFaceFit(scan()),{left:31,right:32,trueDepthAvailable:true}));
test('the actual 21-sample native export meets the web import gate',()=>{
  const native={...scan(),quality:{sampleCount:21,durationSeconds:1.9,leftStdDevMm:.4,rightStdDevMm:.4,thermalState:'fair'}};
  assert.deepEqual(validateFaceFit(native),{left:31,right:32,trueDepthAvailable:true});
  for(const quality of [{sampleCount:20},{durationSeconds:1.89},{leftStdDevMm:.401},{rightStdDevMm:.401}])
    assert.throws(()=>validateFaceFit({...native,quality:{...native.quality,...quality}}));
});
test('supported ARKit without TrueDepth retains an explicit non-depth capability',()=>{
  assert.deepEqual(validateFaceFit({...scan(),capability:{faceTrackingSupported:true,trueDepthAvailable:false}}),{left:31,right:32,trueDepthAvailable:false});
});
test('depth-labelled imports require confirmed real TrueDepth provenance',()=>{
  const depth={...scan(),depthSource:'front-truedepth-absolute',userReviewed:true};
  assert.equal(validateFaceFit(depth).left,31);
  for(const change of [{depthSource:'rgb'},{userReviewed:false},{capability:{faceTrackingSupported:true,trueDepthAvailable:false}}])assert.throws(()=>validateFaceFit({...depth,...change}));
});
test('native import rejects fabricated or unsupported provenance',()=>{
  for(const change of [{source:'webxr'},{units:'cm'},{requiresProviderVerification:false},{capability:{faceTrackingSupported:false,trueDepthAvailable:true}},{capability:{faceTrackingSupported:true}}])
    assert.throws(()=>validateFaceFit({...scan(),...change}));
});
test('native import refuses unstable, hot, short, or sparse captures',()=>{
  for(const change of [{sampleCount:3},{sampleCount:30.5},{durationSeconds:.5},{leftStdDevMm:1},{rightStdDevMm:-1},{thermalState:'serious'}])
    assert.throws(()=>validateFaceFit({...scan(),quality:{...scan().quality,...change}}));
});
test('native import refuses malformed numbers and inconsistent sums',()=>{
  for(const change of [{leftMonocularEstimateMm:'31'},{rightMonocularEstimateMm:Infinity},{totalEstimateMm:70},{leftMonocularEstimateMm:19}])
    assert.throws(()=>validateFaceFit({...scan(),measurements:{...scan().measurements,...change}}));
});
test('wizard cannot advance missing, loading, or uncalibrated lenses',()=>{
  const p={bitmap:{},homography:[1],points:Array(12).fill([1,2]),photoLoading:false};
  assert.equal(lensReady(p),true);
  for(const change of [{bitmap:null},{homography:null},{points:[]},{photoLoading:true}]) assert.equal(lensReady({...p,...change}),false);
});
test('orientation requires distinct finite optical centre and top',()=>{
  assert.equal(marksReady({opticalCentre:[20,20],topMark:[20,10]}),true);
  for(const p of [{},{opticalCentre:[0,0],topMark:[0,0]},{opticalCentre:[NaN,0],topMark:[1,4]}]) assert.equal(marksReady(p),false);
});
