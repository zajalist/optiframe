// Rigid edits of reviewed image-Y-down millimetre contours, never scan mutation.
const sides=['left','right'];
export const validCaptureIdentity=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function normalizeLensAdjustments(value={}) {
  const result={swapped:value.swapped??false};
  if(typeof result.swapped!=='boolean')throw new Error('Invalid lens assignment');
  for(const side of sides){
    const entry=value[side]??{},rotation=entry.rotation??0,mirror=entry.mirror??false;
    if(!Number.isFinite(rotation)||typeof mirror!=='boolean')throw new Error('Invalid lens adjustment');
    result[side]={rotation:((rotation+180)%360+360)%360-180,mirror};
  }
  return result;
}
export function hasLensAdjustments(value) {
  const state=normalizeLensAdjustments(value);
  return state.swapped||sides.some(side=>state[side].rotation!==0||state[side].mirror);
}
export function transformLensOutline(points, adjustment={}) {
  if(points==null)return null;
  if(!Array.isArray(points)||points.length<3||!points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)))throw new Error('Invalid lens outline');
  const {rotation,mirror}=normalizeLensAdjustments({left:adjustment}).left;
  const radians=rotation*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
  // Positive angles turn counterclockwise in the image and, after backend Y
  // reflection, in the CAD view. Mirror about optical x=0 before rotating.
  const transformed=points.map(([originalX,y])=>{const x=mirror?-originalX:originalX;return[c*x+s*y,-s*x+c*y].map(v=>Math.abs(v)<1e-12?0:v);});
  // Reflection changes polygon winding. Preserve the input winding for importers.
  if(mirror)transformed.reverse();
  return transformed;
}
export function adjustLensPair(pair, adjustments={}) {
  const state=normalizeLensAdjustments(adjustments);
  const transformed=Object.fromEntries(sides.map(side=>[side,{outline:transformLensOutline(pair[side]?.outline,state[side]),thickness:pair[side]?.thickness??null}]));
  const sourceSides=state.swapped?{left:'right',right:'left'}:{left:'left',right:'right'};
  return {left:transformed[sourceSides.left].outline,right:transformed[sourceSides.right].outline,
    leftThickness:transformed[sourceSides.left].thickness,rightThickness:transformed[sourceSides.right].thickness,
    sourceSides,modified:hasLensAdjustments(state)};
}
export function createLensAdjustmentStore() {
  let pairIds=[],state=normalizeLensAdjustments();
  const get=()=>normalizeLensAdjustments(state);
  return {
    bindPair(ids){if(ids.length!==2)throw new Error('Two capture identities required');if(ids.some((id,i)=>id!==pairIds[i])){pairIds=[...ids];state=normalizeLensAdjustments();return true;}return false;},
    get,
    set(next){if(pairIds.length!==2||pairIds.some(id=>id==null))throw new Error('Load both lens captures first');const value=normalizeLensAdjustments(next),changed=JSON.stringify(value)!==JSON.stringify(state);state=value;return changed;},
    reset(){const changed=hasLensAdjustments(state);state=normalizeLensAdjustments();return changed;},
    record(){return pairIds.every(validCaptureIdentity)&&pairIds.length===2?{pairIds:[...pairIds],state:get()}:null;},
    restore(record){if(!record||!Array.isArray(record.pairIds)||record.pairIds.length!==2||!record.pairIds.every(validCaptureIdentity)||record.pairIds.some((id,i)=>id!==pairIds[i]))return false;try{state=normalizeLensAdjustments(record.state);return true;}catch{return false;}}
  };
}
