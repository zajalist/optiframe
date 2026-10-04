// Prototype scale inference, not calibrated pupillometry. Google reports a
// population iris diameter of 11.7 ± 0.5 mm; temporal stability cannot remove
// that anatomical bias, near-camera convergence, lens distortion or model bias.
// https://research.google/blog/mediapipe-iris-real-time-iris-tracking-depth-estimation/
const IRIS_MM = 11.7;
const median = values => {
  const sorted=[...values].sort((a,b)=>a-b), middle=Math.floor(sorted.length/2);
  return sorted.length%2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2;
};
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const dot = (a,b) => a.x*b.x+a.y*b.y;
const subtract = (a,b) => ({x:a.x-b.x,y:a.y-b.y});
const midpoint = (a,b) => ({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
const reject = message => ({valid:false,message});

/** Original unmirrored MediaPipe normalized coordinates; x/y use actual frame
 * dimensions, while MediaPipe z shares the x scale. No camera intrinsics assumed.
 * Gates are conservative geometry heuristics, not a clinical gaze/pose model. */
export function estimateFaceFrame(landmarks,{width,height}={}) {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||!Array.isArray(landmarks)||landmarks.length<478)
    return reject('Centre your face');
  const required=[1,10,33,133,145,152,159,168,263,362,374,386,468,469,470,471,472,473,474,475,476,477];
  if(required.some(i=>!landmarks[i]||!['x','y','z'].every(k=>Number.isFinite(landmarks[i][k]))))
    return reject('Keep both eyes visible');
  if(required.some(i=>landmarks[i].x<.025||landmarks[i].x>.975||landmarks[i].y<.025||landmarks[i].y>.975))
    return reject('Centre your face');
  const p=i=>({x:landmarks[i].x*width,y:landmarks[i].y*height,z:landmarks[i].z*width});
  const right=p(468),left=p(473),baseline=subtract(left,right),ipd=distance(left,right);
  if(ipd<40) return reject('Move closer');
  // Reject mirrored model inputs and large roll; small roll is removed by the
  // eye-line basis, rather than treating screen-horizontal distance as PD.
  const roll=Math.atan2(baseline.y,baseline.x);
  if(Math.abs(roll)>.21) return reject('Keep your head level');
  const horizontal={x:baseline.x/ipd,y:baseline.y/ipd};
  const vertical={x:-horizontal.y,y:horizontal.x};
  const eyeMid=midpoint(left,right),bridge=p(168),tip=p(1);
  if(Math.abs(left.z-right.z)/ipd>.10||Math.abs(dot(subtract(tip,bridge),horizontal))/ipd>.10)
    return reject('Face the camera');
  const faceHeight=dot(subtract(p(152),p(10)),vertical);
  const noseDrop=dot(subtract(tip,eyeMid),vertical)/ipd;
  if(faceHeight<ipd||Math.abs(p(152).z-p(10).z)/faceHeight>.45||noseDrop<.10||noseDrop>.65)
    return reject('Face the camera');
  const eyes=[{centre:right,ring:[469,470,471,472],corners:[33,133],lids:[159,145]},
    {centre:left,ring:[474,475,476,477],corners:[362,263],lids:[386,374]}];
  const diameters=[];
  for(const eye of eyes) {
    const ring=eye.ring.map(p),corners=eye.corners.map(p),lids=eye.lids.map(p);
    // Opposite iris points follow eye orientation, so mild head roll is harmless.
    const diameter=distance(ring[0],ring[2]),verticalDiameter=distance(ring[1],ring[3]);
    const eyeWidth=distance(...corners),lidGap=Math.abs(dot(subtract(lids[1],lids[0]),vertical));
    if(diameter<12) return reject('Move closer');
    if(lidGap/eyeWidth<.17) return reject('Open both eyes');
    if(eyeWidth<diameter*1.5||diameter/eyeWidth<.22||diameter/eyeWidth>.60||verticalDiameter/diameter<.70||verticalDiameter/diameter>1.35)
      return reject('Look at the camera');
    const ringCentre=midpoint(midpoint(ring[0],ring[2]),midpoint(ring[1],ring[3]));
    if(distance(ringCentre,eye.centre)>.18*diameter) return reject('Keep both eyes visible');
    // Iris displacement only detects pronounced off-axis gaze. It does not
    // certify fixation or compensate accommodation/convergence at phone range.
    if(Math.abs(dot(subtract(eye.centre,midpoint(...corners)),horizontal))/eyeWidth>.16||
       Math.abs(dot(subtract(eye.centre,midpoint(...lids)),vertical))/lidGap>.45)
      return reject('Look at the camera');
    diameters.push(diameter);
  }
  if(Math.max(...diameters)/Math.min(...diameters)>1.12) return reject('Face the camera');
  const scale=IRIS_MM/median(diameters);
  const rightMm=dot(subtract(bridge,right),horizontal)*scale;
  const leftMm=dot(subtract(left,bridge),horizontal)*scale;
  // Bridge projection is an estimated facial midline, not an optical fitting
  // reference. Large apparent asymmetry is rejected rather than equalized.
  if(leftMm<22||leftMm>42||rightMm<22||rightMm>42||Math.abs(leftMm-rightMm)>7||leftMm+rightMm<45||leftMm+rightMm>80)
    return reject('Face the camera');
  return {valid:true,left:leftMm,right:rightMm,irisDiameterPx:median(diameters)};
}

/** Collect a continuous stable window. Results are editable estimates only.
 * Pass frameId=video.currentTime to avoid counting repeated decoded frames. */
export function createFaceEstimator({minDurationMs=2000,minSamples=20,maxGapMs=400}={}) {
  if(!Number.isFinite(minDurationMs)||minDurationMs<2000||!Number.isInteger(minSamples)||minSamples<20||
     !Number.isFinite(maxGapMs)||maxGapMs<=0||maxGapMs>1000) throw new RangeError('Invalid face estimate sampling limits');
  let samples=[],lastNow=null,lastFrameId=null,complete=null;
  const reset=()=>{samples=[];lastNow=null;lastFrameId=null;complete=null;};
  const guidance=message=>({state:'guidance',message,progress:0});
  return {reset,update(landmarks,{width,height,now,frameId}={}) {
    if(!Number.isFinite(now)){reset();return guidance('Hold still');}
    if(lastNow!==null&&(now<=lastNow||now-lastNow>maxGapMs)){reset();}
    const estimate=estimateFaceFrame(landmarks,{width,height});
    if(!estimate.valid){reset();return guidance(estimate.message);}
    if(complete) return {state:'ready',message:'Estimate ready',progress:1,result:complete};
    // Ignore duplicate/too-fast observations; they cannot advance the window.
    if((frameId!==undefined&&frameId===lastFrameId)||(lastNow!==null&&now-lastNow<40))
      return {state:'collecting',message:'Hold still',progress:samples.length?Math.min(.99,(samples.at(-1).now-samples[0].now)/minDurationMs):0};
    lastNow=now;lastFrameId=frameId;
    if(samples.length>=3) {
      const leftMedian=median(samples.map(s=>s.left)),rightMedian=median(samples.map(s=>s.right));
      if(Math.max(Math.abs(estimate.left-leftMedian),Math.abs(estimate.right-rightMedian))>1.25) {
        samples=[];return guidance('Hold still');
      }
    }
    samples.push({...estimate,now});
    // Bounded even if callers configure longer durations.
    if(samples.length>300) samples.shift();
    const durationMs=now-samples[0].now;
    const progress=Math.min(.99,durationMs/minDurationMs,samples.length/minSamples);
    if(durationMs<minDurationMs||samples.length<minSamples) return {state:'collecting',message:'Hold still',progress};
    const left=median(samples.map(s=>s.left)),right=median(samples.map(s=>s.right));
    const residuals=samples.map(s=>Math.max(Math.abs(s.left-left),Math.abs(s.right-right))).sort((a,b)=>a-b);
    const dispersionMm=residuals[Math.floor((residuals.length-1)*.9)];
    if(dispersionMm>.6){samples=[];return guidance('Hold still');}
    complete={left:Math.round(left*10)/10,right:Math.round(right*10)/10,source:'browser-iris-estimate',
      sampleCount:samples.length,assumedIrisDiameterMm:IRIS_MM,durationMs,dispersionMm,
      scaleCalibrated:false};
    return {state:'ready',message:'Estimate ready',progress:1,result:complete};
  }};
}
