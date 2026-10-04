import {pupilGeometry} from './pupil-geometry.js?v=27';
import pupilReference from './assets/pupil-reference.js?v=27';

const emptyState=()=>({swapped:false,left:{rotation:0,mirror:false},right:{rotation:0,mirror:false}});
const number=value=>value===''||value==null?NaN:Number(value);
const valueOf=input=>typeof input==='function'?input():input?.value??input;
const validOutline=points=>Array.isArray(points)&&points.length>=3&&points.every(point=>Array.isArray(point)&&point.length===2&&point.every(Number.isFinite));

/** Display only: image-Y-down outlines projected into a frontal patient view. */
export function lensAdjustmentDiagram(pair,{leftPd,rightPd,leftOffset,rightOffset}) {
  if(!validOutline(pair?.left)||!validOutline(pair?.right))return null;
  const result={};
  for(const side of ['left','right']) {
    const pupil=pupilGeometry(side==='left'?leftPd:rightPd,side);
    const offset=number(side==='left'?leftOffset:rightOffset);
    if(!pupil.valid||!Number.isFinite(offset))return null;
    result[side]={pupilX:pupil.x,pupilY:88,points:pair[side].map(([x,y])=>[pupil.x-x*2,88+(y-offset)*2])};
  }
  return result;
}

export function mountLensAdjustments({body,getState,onChange,getOutlines,leftPd,rightPd,leftOffset,rightOffset}) {
  if(!document.querySelector('link[data-lens-adjustments]')) {
    const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./lens-adjustment-controls.css?v=48',import.meta.url).href;
    css.dataset.lensAdjustments='';document.head.append(css);
  }
  const listeners=new AbortController();
  let selected='left',available=false,pair=null;
  const icon=path=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  const preview=document.createElement('figure');preview.className='lens-adjustment-preview';
  preview.innerHTML=`<svg class="lens-adjustments-diagram" viewBox="0 0 320 213" role="img" aria-label="Illustrative frontal view of the patient. Reviewed lens outlines follow pupil distances and fitting offsets.">
    <image href="${pupilReference}" width="320" height="213" preserveAspectRatio="none"/>
    <path class="lens-adjustments-centre" d="M160 52V155"/>
    <g data-lens="left"><path class="lens-adjustments-outline"/><path class="lens-adjustments-pupil"/><text y="198">Left</text></g>
    <g data-lens="right"><path class="lens-adjustments-outline"/><path class="lens-adjustments-pupil"/><text y="198">Right</text></g>
  </svg>`;
  body.prepend(preview);
  const details=document.createElement('details');details.className='lens-adjustments';
  details.innerHTML=`<summary>${icon('M4 7h16M4 17h16M8 4v6M16 14v6')}<span>Adjust lenses</span><svg class="lens-adjustments-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m5 6 3 3 3-3"/></svg></summary>
    <div class="lens-adjustments-content">
      <p class="lens-adjustments-note">Image correction · prototype alignment</p>
      <p class="lens-adjustments-status" role="status"></p>
      <fieldset>
        <legend>Lens image correction</legend>
        <div class="lens-adjustments-sides" role="group" aria-label="Patient lens to adjust"><button type="button" data-side="right">Wearer’s right</button><button type="button" data-side="left">Wearer’s left</button></div>
        <label class="lens-adjustments-spacing">Pupil distance<span><input data-pd type="number" inputmode="decimal" min="20" max="40" step="0.1" placeholder="—" aria-label="Selected wearer pupil distance in millimetres"><span aria-hidden="true">mm</span></span></label>
        <div class="lens-adjustments-rotation"><button type="button" data-action="minus" aria-label="Rotate selected lens minus 5 degrees">${icon('M4 5v5h5M5 10a7 7 0 1 1 1 8')}<span>−5°</span></button><label>Rotation<span><input data-angle type="number" inputmode="decimal" min="-180" max="180" step="1" value="0" aria-label="Selected lens rotation in degrees"><span aria-hidden="true">°</span></span></label><button type="button" data-action="plus" aria-label="Rotate selected lens plus 5 degrees">${icon('M20 5v5h-5M19 10a7 7 0 1 0-1 8')}<span>+5°</span></button></div>
        <div class="lens-adjustments-tools" role="group" aria-label="Image corrections">
          <button type="button" data-action="flip" aria-label="Rotate selected lens 180 degrees">${icon('M4 12a8 8 0 0 1 14-5M18 3v4h-4M20 12a8 8 0 0 1-14 5M6 21v-4h4')}<span>180°</span></button>
          <button type="button" data-action="mirror" aria-label="Mirror selected lens image" aria-pressed="false">${icon('M12 3v3m0 3v6m0 3v3M8 5H4v14h4M16 5h4v14h-4')}<span>Mirror</span></button>
          <button type="button" data-action="swap" aria-label="Swap left and right lenses" aria-pressed="false">${icon('M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4')}<span>Swap</span></button>
          <button type="button" data-action="reset" aria-label="Reset image corrections">${icon('M4 4v6h6M5 10a7 7 0 1 1 1 8')}<span>Reset</span></button>
        </div>
      </fieldset>
    </div>`;
  body.append(details);
  const fieldset=details.querySelector('fieldset'),angle=details.querySelector('[data-angle]'),spacing=details.querySelector('[data-pd]');
  const status=details.querySelector('.lens-adjustments-status'),diagram=preview.querySelector('.lens-adjustments-diagram');
  const button=action=>details.querySelector(`[data-action="${action}"]`);
  const sourceSide=()=>pair?.sourceSides?.[selected]||selected;
  function stateCopy() {
    const state=getState();return {swapped:state.swapped,left:{...state.left},right:{...state.right}};
  }
  function render() {
    try {pair=getOutlines();} catch {pair=null;}
    available=validOutline(pair?.left)&&validOutline(pair?.right);fieldset.disabled=!available;
    const state=getState(),source=sourceSide(),part=state[source];
    if(document.activeElement!==angle)angle.value=String(part.rotation);
    const canonicalPd=selected==='left'?leftPd:rightPd;
    spacing.disabled=typeof canonicalPd?.dispatchEvent!=='function';
    if(document.activeElement!==spacing)spacing.value=String(valueOf(canonicalPd)??'');
    spacing.setAttribute('aria-label',`Wearer's ${selected} pupil distance in millimetres`);
    button('mirror').setAttribute('aria-pressed',String(part.mirror));
    button('swap').setAttribute('aria-pressed',String(state.swapped));
    for(const control of details.querySelectorAll('[data-side]'))control.setAttribute('aria-pressed',String(control.dataset.side===selected));
    const projection=available?lensAdjustmentDiagram(pair,{leftPd:valueOf(leftPd),rightPd:valueOf(rightPd),leftOffset:valueOf(leftOffset),rightOffset:valueOf(rightOffset)}):null;
    status.textContent=!available?'Mark both lens centres first.':!projection?'Enter pupil distances and offsets to preview.':state.swapped?'Left and right assignments swapped.':'';
    diagram.dataset.selected=selected;
    let all=[];
    for(const side of ['left','right']) {
      const group=diagram.querySelector(`[data-lens="${side}"]`),geometry=projection?.[side];
      group.style.display=geometry?'':'none';
      if(!geometry)continue;
      all.push(...geometry.points);
      group.querySelector('.lens-adjustments-outline').setAttribute('d',geometry.points.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ')+'Z');
      const x=geometry.pupilX,y=geometry.pupilY;
      group.querySelector('.lens-adjustments-pupil').setAttribute('d',`M${x-4} ${y}H${x+4}M${x} ${y-4}V${y+4}`);
      group.querySelector('text').setAttribute('x',x);
    }
    const xs=all.map(p=>p[0]),ys=all.map(p=>p[1]);
    const minX=Math.min(0,...xs.map(x=>x-6)),minY=Math.min(0,...ys.map(y=>y-6));
    diagram.setAttribute('viewBox',`${minX} ${minY} ${Math.max(320,...xs.map(x=>x+6))-minX} ${Math.max(213,...ys.map(y=>y+6))-minY}`);
  }
  function commit(change) {
    if(!available)return;
    try {const next=stateCopy();change(next,sourceSide());onChange(next);render();}
    catch(error){status.textContent=error.message||'Could not update this lens.';}
  }
  const listen=(node,type,handler)=>node.addEventListener(type,handler,{signal:listeners.signal});
  for(const control of details.querySelectorAll('[data-side]'))listen(control,'click',()=>{angle.blur();spacing.blur();selected=control.dataset.side;render();});
  const rotate=delta=>commit((state,source)=>{state[source].rotation=((state[source].rotation+delta+180)%360+360)%360-180;});
  listen(button('minus'),'click',()=>rotate(-5));listen(button('plus'),'click',()=>rotate(5));
  listen(button('flip'),'click',()=>rotate(180));
  listen(button('mirror'),'click',()=>commit((state,source)=>{state[source].mirror=!state[source].mirror;}));
  listen(button('swap'),'click',()=>commit(state=>{state.swapped=!state.swapped;}));
  listen(button('reset'),'click',()=>{if(!available)return;try{onChange(emptyState());angle.blur();render();}catch(error){status.textContent=error.message||'Could not reset lenses.';}});
  listen(angle,'input',()=>{
    const degrees=number(angle.value),valid=Number.isFinite(degrees)&&degrees>=-180&&degrees<=180;
    angle.setAttribute('aria-invalid',String(!valid));
    if(valid)commit((state,source)=>{state[source].rotation=degrees;});
  });
  listen(angle,'blur',()=>{angle.removeAttribute('aria-invalid');angle.value=String(getState()[sourceSide()].rotation);});
  listen(angle,'keydown',event=>{if(event.key==='Enter'){event.preventDefault();angle.blur();}});
  listen(spacing,'input',()=>{
    const millimetres=number(spacing.value),valid=Number.isFinite(millimetres)&&millimetres>=20&&millimetres<=40;
    spacing.setAttribute('aria-invalid',String(!valid));
    if(!valid){status.textContent='Enter a pupil distance from 20 to 40 mm.';return;}
    const canonicalPd=selected==='left'?leftPd:rightPd;
    canonicalPd.value=String(millimetres);canonicalPd.dispatchEvent(new Event('input',{bubbles:true}));render();
  });
  listen(spacing,'blur',()=>{spacing.removeAttribute('aria-invalid');spacing.value=String(valueOf(selected==='left'?leftPd:rightPd)??'');render();});
  listen(spacing,'keydown',event=>{if(event.key==='Enter'){event.preventDefault();spacing.blur();}});
  listen(details,'toggle',()=>{
    body.classList.toggle('lens-adjustments-open',details.open);
    if(details.open)render();
    else body.scrollTop=0;
  });
  for(const input of [leftPd,rightPd,leftOffset,rightOffset])if(input?.addEventListener)listen(input,'input',render);
  render();
  const cleanup=()=>{listeners.abort();body.classList.remove('lens-adjustments-open');details.remove();preview.remove();};
  cleanup.refresh=render;return cleanup;
}
