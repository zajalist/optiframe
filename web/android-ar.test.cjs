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

test('cloud preview plots finite captured points without changing export', () => {
  const rectangles = [];
  const ctx = {clearRect(){},fillRect(...args){rectangles.push(args);},set fillStyle(_) {}};
  const frames = [{views:[{samples:[{point:[1,2,3]},{point:null},{point:[NaN,0,0]},{point:[2,3,4]}]}]}];
  assert.equal(math.drawPointCloud(ctx,{width:480,height:360},frames),2);
  assert.equal(rectangles.length,3); // Background and two plotted points.
  assert.equal(math.drawPointCloud(ctx,{width:480,height:360},[],0,0),0);
});

test('cloud preview decimates valid points and keeps sparse depth visible', () => {
  const rectangles = [];
  const ctx = {clearRect(){},fillRect(...args){rectangles.push(args);},set fillStyle(_) {}};
  const samples = Array.from({length:12000}, () => ({point:null}));
  samples[1] = {point:[0,0,1]};
  samples[11999] = {point:[1,1,1]};
  assert.equal(math.drawPointCloud(ctx,{width:100,height:80},[{views:[{samples}]}]),2);
  assert.equal(rectangles.length,3);
  const dense = Array.from({length:12000}, (_, x) => ({point:[x,0,0]}));
  assert.ok(math.drawPointCloud(ctx,{width:100,height:80},[{views:[{samples:dense}]}]) <= 6000);
});

test('cloud preview fits rotated 3D bounds inside canvas', () => {
  const rectangles = [];
  const ctx = {clearRect(){},fillRect(...args){rectangles.push(args);},set fillStyle(_) {}};
  const samples = [-10,10].flatMap(x => [-10,10].flatMap(y => [-10,10].map(z => ({point:[x,y,z]}))));
  for (const [yaw,pitch] of [[Math.PI/4,Math.PI/4],[-1.1,1.2],[0,0]]) {
    rectangles.length = 0;
    assert.equal(math.drawPointCloud(ctx,{width:100,height:80},[{views:[{samples}]}],yaw,pitch),8);
    for (const [x,y,w,h] of rectangles.slice(1)) assert.ok(x >= 0 && y >= 0 && x+w <= 100 && y+h <= 80, `clipped point at ${x},${y}`);
  }
});

function harness(deferAt, endReject = false) {
  let resolveSetup, endHandler, resetHandler, frameHandler, releases = 0, frameRequests = 0, timers = 0;
  const deferred = new Promise(resolve => { resolveSetup = resolve; });
  const elements = Object.fromEntries(['start','stop','json','ply','status','coverage','diagnostics','depth-preview','cloud-preview','overlay'].map(id => [id,{disabled:true,addEventListener(type, fn){this[type] = fn;}}]));
  const gl = {makeXRCompatible: () => deferAt === 'gl' ? deferred : Promise.resolve(),getExtension: () => ({loseContext(){releases++;}}),bindFramebuffer(){},clearColor(){},clear(){}};
  const space = {addEventListener(type, fn){if(type === 'reset') resetHandler = fn;}};
  const session = {depthUsage:'cpu-optimized',depthDataFormat:'float32',renderState:{baseLayer:{framebuffer:{}}},addEventListener(type,fn){endHandler=fn;},end:async()=>endReject ? Promise.reject(new Error('exit blocked')) : endHandler(),updateRenderState(){},requestReferenceSpace:()=>deferAt === 'space' ? deferred : Promise.resolve(space),requestAnimationFrame(fn){frameHandler=fn;frameRequests++;}};
  elements['depth-preview'].getContext = () => ({createImageData:()=>({data:new Uint8Array(3072)}),putImageData(){}});
  elements['cloud-preview'].width=480;
  elements['cloud-preview'].height=360;
  elements['cloud-preview'].getContext = () => ({clearRect(){},fillRect(){},set fillStyle(_) {}});
  vm.runInNewContext(fs.readFileSync(require.resolve('./android-ar.js'),'utf8'),{document:{getElementById:id=>elements[id],createElement:()=>({getContext:()=>gl}),querySelectorAll:()=>[]},navigator:{userAgent:'mock',xr:{isSessionSupported:async()=>true,requestSession:async()=>session}},isSecureContext:true,location:{hash:''},performance:{now:()=>0},XRWebGLLayer:function(){},setTimeout(){timers++;return 1;},clearTimeout(){}});
  return {elements,session,finish:()=>resolveSetup(space),reset:()=>resetHandler(),frame:(time,frame)=>frameHandler(time,frame),counts:()=>({releases,frameRequests,timers})};
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

test('valid depth updates the live point count and sample coverage',async()=>{
  const h=harness(); await flush(); await h.elements.start.click();
  const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const view={eye:'none',projectionMatrix:identity,transform:{matrix:identity}};
  h.frame(1000,{getViewerPose:()=>({views:[view],transform:{matrix:identity}}),getDepthInformation:()=>({width:1,height:1,rawValueToMeters:1,normDepthBufferFromNormView:{matrix:identity},getDepthInMeters:()=>1,data:new Float32Array([1]).buffer})});
  assert.match(h.elements.coverage.textContent,/1\/15 s · 1\/60 frames · 768 points · 100% valid depth/);
  assert.equal(JSON.parse(h.elements.diagnostics.textContent).sampledPoints,768);
  await h.session.end();
  assert.equal(h.elements.ply.disabled,false);
  assert.equal(h.elements.json.disabled,false);
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

test('reference-space reset freezes capture even when session end fails',async()=>{
  const h=harness(null,true); await flush(); await h.elements.start.click();
  const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  const view={eye:'none',projectionMatrix:identity,transform:{matrix:identity}};
  const frame={getViewerPose:()=>({views:[view],transform:{matrix:identity}}),getDepthInformation:()=>({width:1,height:1,rawValueToMeters:1,normDepthBufferFromNormView:{matrix:identity},getDepthInMeters:()=>1,data:new Float32Array([1]).buffer})};
  h.frame(0,frame);
  assert.equal(JSON.parse(h.elements.diagnostics.textContent).frames,1);
  h.reset();
  h.frame(300,frame); // Callback delivered while session.end is pending.
  await flush();
  h.frame(600,{getViewerPose(){throw new Error('sampling continued after reset');}});
  const diagnostics=JSON.parse(h.elements.diagnostics.textContent);
  assert.equal(diagnostics.frames,1);
  assert.equal(diagnostics.referenceSpaceResets,1);
  assert.match(diagnostics.lastError,/Could not end AR/);
});

test('XR DOM overlay has dedicated styling',()=>{
  const html=fs.readFileSync(require.resolve('./android-ar.html'),'utf8');
  assert.match(html,/#overlay:xr-overlay\s*\{/);
});

test('browser-driven end records a reason in capture diagnostics',async()=>{
  const h=harness(); await flush(); await h.elements.start.click();
  await h.session.end();
  assert.match(JSON.parse(h.elements.diagnostics.textContent).stopReason,/browser or device/);
  assert.equal(h.counts().releases,1);
});
