import {sheetHomography} from './calibration.js';
import {createAutoCaptureGate} from './auto-capture.js?v=23';

const copy=points=>points?.map(p=>[...p]);
function signature(markers) {
  const center=[0,1].map(a=>markers.reduce((sum,p)=>sum+p[a]/4,0));
  const points=markers.map(p=>p.map((v,a)=>v-center[a]));
  const scale=Math.sqrt(points.reduce((sum,p)=>sum+p[0]**2+p[1]**2,0)/4);
  const angle=Math.atan2(markers[1][1]-markers[0][1],markers[1][0]-markers[0][0]);
  const c=Math.cos(angle),s=Math.sin(angle);
  return points.map(([x,y])=>[(x*c+y*s)/scale,(-x*s+y*c)/scale]);
}
const distance=(a,b)=>Math.max(...a.map((p,i)=>Math.hypot(p[0]-b[i][0],p[1]-b[i][1])));
export function countDistinctViews(frames,minViewChange=.018) {
  const views=[];
  for(const frame of frames){
    const shape=signature(frame.calibration.markers);
    if(views.every(view=>distance(shape,view)>=minViewChange))views.push(shape);
  }
  return views.length;
}

/** Collect independent originals; view diversity is a geometry cue, not accuracy evidence. */
export function createViewSweep({minFrames=3,maxFrames=5,minDurationMs=1200,maxDurationMs=4000,
  maxAgeMs=2000,minViewChange=.018}={}) {
  if(!Number.isInteger(minFrames)||!Number.isInteger(maxFrames)||
    ![minDurationMs,maxDurationMs,maxAgeMs,minViewChange].every(Number.isFinite)||
    minFrames<3||maxFrames<minFrames||maxFrames>5||minDurationMs<0||maxDurationMs<=minDurationMs||maxAgeMs<=0||minViewChange<=0)
    throw new TypeError('Invalid sweep limits');
  let views=[],seen=new Set(),started=null,latest=null,finished=null;
  const reset=()=>{views=[];seen=new Set();started=null;latest=null;finished=null;};
  const snapshot=(now,reason)=>({ready:false,state:'collecting',reason,frames:views.map(v=>v.frame),
    viewCount:views.length,elapsedMs:started===null?0:Math.max(0,now-started)});
  return {reset,update(sample,now=performance.now()) {
    if(finished)return finished;
    if(started!==null&&now-started>maxDurationMs)
      return finished={...snapshot(now,'insufficient-view-change'),state:'retry'};
    if(!sample||!Number.isFinite(sample.sampledAt)||!Number.isFinite(now)||now<sample.sampledAt||now-sample.sampledAt>maxAgeMs)
      return snapshot(now,'stale-frame');
    if(sample.edgeRefinement?.accepted!==true)return snapshot(now,'refinement-unsupported');
    if(!Array.isArray(sample.contour)||sample.contour.length<12||!sample.contour.every(point=>
      Array.isArray(point)&&point.length===2&&point.every((value,axis)=>Number.isFinite(value)&&value>=0&&value<=(axis?sample.height:sample.width))))
      return snapshot(now,'invalid-pixel-contour');
    const id=sample.id??sample.sampledAt;
    if(seen.has(id))return snapshot(now,'duplicate-frame');
    const checked=createAutoCaptureGate({durationMs:0,minFrames:1,maxAgeMs}).update({...sample,now,id});
    if(!checked.capture||!sample.blob?.size||!(sample.width>0)||!(sample.height>0))
      return snapshot(now,checked.reason||'invalid-frame');
    let homography;
    try {homography=sheetHomography(sample.calibration.markers);}catch{return snapshot(now,'calibration');}
    if(!homography)return snapshot(now,'calibration');
    seen.add(id);
    // Only IDs within a bounded capture window are retained; completed attempts
    // require an explicit reset before receiving another lens.
    if(seen.size>128)return finished={...snapshot(now,'too-many-frames'),state:'retry'};
    started??=sample.sampledAt;
    const frame={...sample,id,contour:copy(sample.contour),rawContour:copy(sample.rawContour),
      calibration:{...sample.calibration,markers:copy(sample.calibration.markers),contour:copy(sample.calibration.contour)},
      homography,normalizedMarkerQuad:sample.calibration.markers.map(([x,y])=>[x/sample.width,y/sample.height])};
    latest=frame;
    const shape=signature(frame.calibration.markers);
    const distinct=views.every(view=>distance(shape,view.shape)>=minViewChange);
    if(distinct&&views.length<Math.max(minFrames,maxFrames-1))views.push({shape,frame});
    // Keep the best original in each view without manufacturing a new view.
    else if(!distinct) {
      const nearest=views.reduce((a,b)=>distance(shape,a.shape)<distance(shape,b.shape)?a:b);
      if(nearest!==views[0]&&(frame.quality.score>nearest.frame.quality.score||
        (frame.quality.score===nearest.frame.quality.score&&frame.quality.sharpness>nearest.frame.quality.sharpness)))nearest.frame=frame;
    }
    const frames=views.map(view=>view.frame);
    if(!frames.some(frame=>frame.id===latest.id)) {
      if(frames.length===maxFrames)frames.pop();
      frames.push(latest);
    }
    const duration=Math.max(...frames.map(f=>f.sampledAt))-Math.min(...frames.map(f=>f.sampledAt));
    if(countDistinctViews(frames,minViewChange)>=minFrames&&duration>=minDurationMs)
      return finished={...snapshot(now,null),ready:true,state:'ready',frames,
        bestFrame:frames.reduce((a,b)=>b.quality.score>a.quality.score||
          (b.quality.score===a.quality.score&&b.quality.sharpness>a.quality.sharpness)?b:a)};
    return {...snapshot(now,views.length<minFrames?'change-view':'keep-moving'),frames};
  }};
}
