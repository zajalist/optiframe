const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const math = require('./android-ar.js');

test('axial depth, projection, pose and export', () => {
  const projection = [1,0,0,0,0,1,0,0,0,0,-1.02,-1,0,0,-.202,0];
  const inverse = math.inverseMatrix(projection);
  const pose = [0,0,-1,0,0,1,0,0,1,0,0,0,1,2,3,1];
  const near = (actual, expected) => actual.forEach((v,k) => assert.ok(Math.abs(v-expected[k]) < 1e-8));
  near(math.backProject(.5,.5,2,inverse,pose), [-1,2,3]);
  near(math.backProject(.75,.25,2,inverse,pose), [-1,3,2]);
  near(math.multiplyPoint(projection, math.multiplyPoint(inverse,[.5,.25,-1,1])), [.5,.25,-1,1]);
  for (const value of [0,-1,NaN,Infinity]) assert.equal(math.backProject(.5,.5,value,inverse,pose),null);
  assert.throws(() => math.inverseMatrix(Array(16).fill(0)));
  const ply = math.pointCloudPLY([{views:[{samples:[{point:[1,2,3]},{point:null}]}]}]);
  assert.ok(ply.includes('element vertex 1'));
  assert.ok(ply.endsWith('1 2 3\n'));
});

function harness(deferAt, endReject = false) {
  let resolveSetup, endHandler, frameHandler, releases = 0, frameRequests = 0, timers = 0;
  const deferred = new Promise(resolve => { resolveSetup = resolve; });
  const elements = Object.fromEntries(['start','stop','json','ply','status','diagnostics','depth-preview','overlay'].map(id => [id,{disabled:true,addEventListener(type, fn){this[type] = fn;}}]));
  const gl = {makeXRCompatible: () => deferAt === 'gl' ? deferred : Promise.resolve(),getExtension: () => ({loseContext(){releases++;}}),bindFramebuffer(){},clearColor(){},clear(){}};
  const space = {addEventListener(){}};
  const session = {depthUsage:'cpu-optimized',depthDataFormat:'float32',renderState:{baseLayer:{framebuffer:{}}},addEventListener(type,fn){endHandler=fn;},end:async()=>endReject ? Promise.reject(new Error('exit blocked')) : endHandler(),updateRenderState(){},requestReferenceSpace:()=>deferAt === 'space' ? deferred : Promise.resolve(space),requestAnimationFrame(fn){frameHandler=fn;frameRequests++;}};
  elements['depth-preview'].getContext = () => ({createImageData:()=>({data:new Uint8Array(3072)}),putImageData(){}});
  vm.runInNewContext(fs.readFileSync(require.resolve('./android-ar.js'),'utf8'),{document:{getElementById:id=>elements[id],createElement:()=>({getContext:()=>gl}),querySelectorAll:()=>[]},navigator:{userAgent:'mock',xr:{isSessionSupported:async()=>true,requestSession:async()=>session}},isSecureContext:true,location:{hash:''},performance:{now:()=>0},XRWebGLLayer:function(){},setTimeout(){timers++;return 1;},clearTimeout(){}});
  return {elements,session,finish:()=>resolveSetup(space),frame:(time,frame)=>frameHandler(time,frame),counts:()=>({releases,frameRequests,timers})};
}
const flush = async () => {for(let i=0;i<8;i++) await Promise.resolve();};

for (const stage of ['gl','space']) test(`session ends while waiting for ${stage}`, async () => {
  const h = harness(stage); await flush();
  const start = h.elements.start.click(); await flush();
  await h.session.end();
  assert.equal(h.elements.start.disabled,true);
  h.finish(); await start;
  assert.deepEqual(h.counts(),{releases:1,frameRequests:0,timers:0});
  assert.equal(h.elements.start.disabled,false);
});

test('tracking diagnostics refresh and memory stop reason survives end',async()=>{
  const h=harness(); await flush(); await h.elements.start.click();
  h.frame(0,{getViewerPose:()=>null});
  assert.equal(JSON.parse(h.elements.diagnostics.textContent).trackingLostFrames,1);
  const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const view={eye:'none',projectionMatrix:identity,transform:{matrix:identity}};
  h.frame(300,{getViewerPose:()=>({views:[view],transform:{matrix:identity}}),getDepthInformation:()=>({getDepthInMeters:()=>1,data:new ArrayBuffer(4000001*4)})});
  await flush();
  assert.match(h.elements.status.textContent,/Depth memory limit reached/);
  assert.equal(h.counts().releases,1);
});

test('failed end resumes RAF after a pending callback was consumed',async()=>{
  const h=harness(null,true); await flush(); await h.elements.start.click();
  const before=h.counts().frameRequests;
  h.elements.stop.click();
  h.frame(0,{}); // Browser delivers the only pending callback during session.end().
  await flush();
  assert.equal(h.counts().frameRequests,before+1);
  assert.match(JSON.parse(h.elements.diagnostics.textContent).lastError,/Could not end AR/);
});

test('browser-driven end records a reason in capture diagnostics',async()=>{
  const h=harness(); await flush(); await h.elements.start.click();
  await h.session.end();
  assert.match(JSON.parse(h.elements.diagnostics.textContent).stopReason,/browser or device/);
  assert.equal(h.counts().releases,1);
});
