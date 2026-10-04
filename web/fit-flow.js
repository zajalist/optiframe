import { leftPanel, rightPanel, capturesReady, makeFrame, project, getFrameStyle, setFrameStyle, getRetentionStyle, setRetentionStyle, getFrameAssembly, applyFaceMeasurements, useManualMeasurements, getMeasurementSource } from './app.js?v=40';
import { openFaceScan } from './face-scan.js?v=41';
import { loadConfirmedFace, saveConfirmedFace } from './face-confirmation.js?v=39';
import { validateFaceFit, lensReady, marksReady } from './fit-validation.js';
import { mountPupilMeasurements } from './pupil-measurements.js?v=27';
import { mountFrameCatalog } from './frame-catalog.js?v=41';
import { mountThicknessMeasurements } from './thickness-measurements.js?v=35';

if (new URLSearchParams(location.search).get('advanced') !== '1') void startFitFlow();

async function startFitFlow() {
  document.body.classList.add('fit-flow');
  const source = document.querySelector('main');
  source.classList.add('fit-source');
  const shell = document.createElement('main');
  shell.className = 'fit-shell';
  shell.innerHTML = '<header class="fit-heading"><h1 tabindex="-1">Your lenses</h1><span class="fit-progress" aria-label="Progress"></span></header><section class="fit-body"></section><p class="fit-message" role="status"></p><nav class="fit-navigation" aria-label="Fitting steps"><button type="button" class="fit-back">Back</button><button type="button" class="fit-next">Continue</button></nav>';
  source.after(shell);
  const title = shell.querySelector('h1'), body = shell.querySelector('.fit-body'), message = shell.querySelector('.fit-message');
  const next = shell.querySelector('.fit-next'), back = shell.querySelector('.fit-back');
  const left = leftPanel, right = rightPanel;
  const fields = id => document.getElementById(id);
  const panels = [left, right];
  const viewer = fields('viewer'), designStatus = fields('design-status');
  let step = 0, method = 'camera', face = loadConfirmedFace(), faceReviewed = Boolean(face), loading = true, exporting = false;
  if(new URLSearchParams(location.search).get('measure')==='manual'){method='manual';face=null;faceReviewed=false;useManualMeasurements();}
  let markMode = 'optical';
  let cleanupStep = () => {};
  let captureBackup = null;
  try { captureBackup = JSON.parse(sessionStorage.getItem('optiframe-captures') || 'null'); } catch { /* Recovery remains available via Scanner. */ }
  const titles = ['Your lenses','Fit measurements','Pupil distances','Lens thickness','Left lens marks','Right lens marks','Frame fit','Your frame','Print test kit'];
  panels.forEach(p => { p.guidedWizard = true; p.guidedCapture = false; });
  document.querySelector('.site-header .header-link').hidden = true;
  const home = document.querySelector('.site-header .brand');
  home.hash = location.hash;
  function button(text, action, className = '') {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.className = className; b.addEventListener('click', action); return b;
  }
  function note(text) { const p = document.createElement('p'); p.className = 'fit-note'; p.textContent = text; body.append(p); return p; }
  function visualTryOn() {
    try {
      if(!panels.every(lensReady))throw new Error('Scan both lenses first.');
      const outlines=panels.map(p=>p.points.map(point=>project(point,p.homography)));
      sessionStorage.setItem('optiframe-visual-outlines',JSON.stringify(outlines));
      // Keep the fitting flow recoverable when returning from visual try-on.
      if(captureBackup)sessionStorage.setItem('optiframe-captures',JSON.stringify(captureBackup));
      location.href='/try-on.html?v=41'+location.hash;
    } catch(error){message.textContent=error.message;}
  }
  function inputs(ids) {
    const group = document.createElement('div'); group.className = 'fit-fields design-inputs';
    ids.forEach(id => group.append(fields(id).closest('label'))); body.append(group);
  }
  function valid(ids) { return ids.every(id => fields(id).value.trim() && fields(id).validity.valid && Number.isFinite(Number(fields(id).value))); }
  function stash() {
    // Keep original controls alive: LensPanel and export validation still own them.
    body.querySelectorAll('.lens-panel').forEach(el => source.append(el));
    body.querySelectorAll('.design-inputs label').forEach(el => source.append(el));
    if (body.contains(viewer)) source.append(viewer);
    if (body.contains(designStatus)) source.append(designStatus);
    body.replaceChildren();
  }
  function update() {
    let enabled = !loading && !exporting;
    if (step === 0) enabled &&= panels.every(lensReady);
    if (step === 1) enabled &&= method === 'manual' || Boolean(face && faceReviewed);
    if (step === 2) enabled &&= valid(['left-pd','right-pd']);
    if (step === 3) enabled &&= valid(['left-edge-thickness','right-edge-thickness']);
    if (step === 4 || step === 5) {
      const panel = step === 4 ? left : right;
      enabled &&= markMode==='optical' ? Boolean(panel.opticalCentre) : marksReady(panel);
      message.textContent = panel.opticalCentre && panel.topMark && !marksReady(panel) ? 'Place the top mark at least 5 mm from the optical centre.' : '';
    }
    if (step === 6) enabled &&= valid(['left-vertical-offset','right-vertical-offset','temple-length']);
    if (step === 7) enabled &&= viewer.classList.contains('active') && viewer.dataset.stale === 'false';
    if (step === 8) enabled &&= valid(['bed-width','bed-depth']);
    next.disabled = !enabled;
    back.disabled = exporting;
  }
  function summary() {
    const pair = document.createElement('div'); pair.className = 'fit-pair';
    // Use one physical scale for the pair; separate SVG view boxes must not make
    // a small lens look the same size as a large one.
    const outlines = panels.map(p => {
      if (!lensReady(p)) return null;
      const points = p.points.map(point => project(point, p.homography));
      const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
      const x = Math.min(...xs), y = Math.min(...ys);
      return {points, x, y, w:Math.max(...xs)-x, h:Math.max(...ys)-y};
    });
    const commonWidth = Math.max(1,...outlines.filter(Boolean).map(o => o.w)) + 10;
    const commonHeight = Math.max(1,...outlines.filter(Boolean).map(o => o.h)) + 10;
    for (const p of panels) {
      const item = document.createElement('figure'); const label = document.createElement('figcaption'); label.textContent = `${p.side === 'left' ? 'Left' : 'Right'} lens`; item.append(label);
      const outline = outlines[panels.indexOf(p)];
      if (outline) {
        const {points,x,y,w,h} = outline;
        const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
        svg.setAttribute('viewBox',`${x+w/2-commonWidth/2} ${y+h/2-commonHeight/2} ${commonWidth} ${commonHeight}`); svg.setAttribute('role','img'); svg.setAttribute('aria-label',`${p.side} lens, ${w.toFixed(1)} by ${h.toFixed(1)} millimetres`);
        const id = `fit-lens-${p.side}`, d = points.map((point,i)=>`${i?'L':'M'}${point[0]} ${point[1]}`).join(' ')+'Z';
        const node = (tag, attrs, parent=svg) => { const el=document.createElementNS(svg.namespaceURI,tag);for(const [key,value] of Object.entries(attrs))el.setAttribute(key,String(value));parent.append(el);return el; };
        const defs = node('defs',{});
        const fill = node('linearGradient',{id:`${id}-fill`,x1:0,y1:0,x2:1,y2:1},defs);
        for(const [offset,color] of [['0%','#59616c'],['38%','#30363e'],['72%','#20262e'],['100%','#414a55']]) node('stop',{offset,'stop-color':color},fill);
        const edge = node('linearGradient',{id:`${id}-edge`,x1:0,y1:0,x2:1,y2:1},defs);
        for(const [offset,color] of [['0%','#ffffff'],['26%','#a2adb9'],['70%','#66717f'],['100%','#eef2f6']]) node('stop',{offset,'stop-color':color},edge);
        const sheen = node('linearGradient',{id:`${id}-sheen`,x1:0,y1:0,x2:1,y2:1},defs);
        for(const [offset,opacity] of [['0%','.72'],['32%','.06'],['55%','0'],['78%','.15'],['100%','0']]) node('stop',{offset,'stop-color':'#fff','stop-opacity':opacity},sheen);
        const clip = node('clipPath',{id:`${id}-clip`},defs);node('path',{d},clip);
        node('path',{d,class:'fit-lens-surface',fill:`url(#${id}-fill)`,stroke:'#788491'});
        node('path',{d,class:'fit-lens-edge',fill:'none',stroke:`url(#${id}-edge)`});
        node('rect',{x,y,width:w,height:h,fill:`url(#${id}-sheen)`,'clip-path':`url(#${id}-clip)`,class:'fit-lens-reflection'});
        const text = node('text',{x:x+w/2,y:y+h/2-1.5,class:'fit-lens-dimensions'});text.textContent=`${w.toFixed(1)} × ${h.toFixed(1)}`;
        const unit = node('text',{x:x+w/2,y:y+h/2+4,class:'fit-lens-unit'});unit.textContent='mm';
        item.append(svg);
      }
      pair.append(item);
    }
    body.append(pair);
    if (!panels.every(lensReady)) {
      note(loading ? 'Opening your captures…' : 'Scan both lenses to begin.');
      const a = document.createElement('a'); a.className = 'fit-link'; a.href = '/'+location.hash; a.textContent = 'Scan lenses'; body.append(a);
    } else {
      const a = document.createElement('a'); a.className = 'fit-link'; a.href = '/'+location.hash; a.textContent = 'Rescan'; body.append(a);
      body.append(button('Just try on',visualTryOn,'fit-link'));
    }
  }
  function methodScreen() {
    body.append(button('Just try on',visualTryOn,'catalog-tryon'));
    const group = document.createElement('fieldset'); group.className='fit-methods';
    const legend = document.createElement('legend'); legend.textContent='Measurement source'; group.append(legend);
    for(const [value,label] of [['camera','Camera scan'],['manual','Enter manually'],['native','iPhone app scan']]) {
      const l = document.createElement('label'), radio=document.createElement('input'); radio.type='radio'; radio.name='fit-method';radio.value=value;radio.checked=method===value;
      radio.addEventListener('change',()=>{method=value;face=null;faceReviewed=false;if(value==='manual')useManualMeasurements();render();}); l.append(radio,document.createTextNode(label)); group.append(l);
    }
    body.append(group);
    if(method==='camera') {
      note('Scan, review, then confirm your pupil estimates.');
      body.append(button(faceReviewed?'Scan again':'Scan face',()=>{
        cleanupStep=openFaceScan({onConfirm:value=>{try{saveConfirmedFace(value);face=value;faceReviewed=true;applyFaceMeasurements(value);render();}catch(error){message.textContent=error.message;}},onManual:()=>{method='manual';face=null;faceReviewed=false;useManualMeasurements();render();}});
      },'catalog-tryon'));
      if(face&&faceReviewed)note(`Left ${face.left.toFixed(1)} · Right ${face.right.toFixed(1)} mm · Confirmed estimate`);
    } else if(method==='native') {
      note('Import a reviewed ARKit estimate from the OptiFrame iPhone app.');
      const label=document.createElement('label');label.className='fit-file';label.textContent='Face scan JSON';
      const file=document.createElement('input'); file.type='file';file.accept='.json,application/json'; label.append(file);body.append(label);
      file.addEventListener('change',async()=>{
        face=null;faceReviewed=false;message.textContent='';update();
        try { const selected=file.files[0]; if(!selected)return; if(selected.size>100000)throw new Error('Choose the small face scan JSON file.');face=validateFaceFit(JSON.parse(await selected.text()));render(); }
        catch(error){message.textContent=error.message;update();}
      });
      if(face) {
        note(face.trueDepthAvailable ? 'ARKit estimate · TrueDepth available' : 'ARKit estimate · No TrueDepth');
        note(`Left ${face.left.toFixed(1)} mm · Right ${face.right.toFixed(1)} mm`);
        const label=document.createElement('label'); label.className='fit-check'; const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=faceReviewed;
        checkbox.addEventListener('change',()=>{faceReviewed=checkbox.checked;update();}); label.append(checkbox,document.createTextNode('I will verify these estimates with the lens provider.'));body.append(label);
      }
    } else note('Use the wearer’s measured left and right pupil distances.');
  }
  function markScreen(panel) {
    panel.guidedCapture=false; panel.guidedWizard=true;
    if(panel.illustrativeAlignment===true && markMode==='optical'){panel.opticalCentre=null;panel.topMark=null;panel.markReview={};panel.illustrativeAlignment='marking';}
    panel.setMode(markMode);
    title.textContent=`${panel.side==='left'?'Left':'Right'} ${markMode==='optical'?'optical centre':'lens top'}`;
    next.textContent=markMode==='optical'?'Set centre':'Set top';
    note(markMode==='optical'?'Aligns the lens with the pupil. Drag to the provider’s centre mark.':'Keeps the lens oriented correctly. Drag to its top mark.');
    body.append(panel.el);
    const wrap=panel.canvas.closest('.canvas-wrap'),oldStyle=panel.canvas.getAttribute('style');
    wrap.classList.add('fit-zoom-photo');
    const zoom=()=>{if(!panel.points.length)return;const xs=panel.points.map(p=>p[0]),ys=panel.points.map(p=>p[1]);const x=Math.min(...xs),y=Math.min(...ys),w=Math.max(...xs)-x,h=Math.max(...ys)-y;const bounds=wrap.getBoundingClientRect();const scale=Math.min(bounds.width/(w*1.3),bounds.height/(h*1.3));if(!Number.isFinite(scale)||scale<=0)return;Object.assign(panel.canvas.style,{width:`${panel.canvas.width*scale}px`,height:`${panel.canvas.height*scale}px`,left:`${bounds.width/2-(x+w/2)*scale}px`,top:`${bounds.height/2-(y+h/2)*scale}px`});};
    const observer=new ResizeObserver(zoom);observer.observe(wrap);zoom();
    cleanupStep=()=>{observer.disconnect();wrap.classList.remove('fit-zoom-photo');oldStyle===null?panel.canvas.removeAttribute('style'):panel.canvas.setAttribute('style',oldStyle);};
    const details=document.createElement('details');details.className='fit-fine-adjust';const heading=document.createElement('summary');heading.textContent='Fine adjust';details.append(heading);
    const nudges=document.createElement('div');nudges.className='fit-nudges';nudges.setAttribute('aria-label','Fine adjustment, one image pixel');
    for(const [label,dx,dy] of [['Left',-1,0],['Up',0,-1],['Down',0,1],['Right',1,0]])nudges.append(button(label,()=>{
      const key=markMode==='optical'?'opticalCentre':'topMark';if(!panel[key])return;
      panel[key]=[Math.max(0,Math.min(panel.canvas.width,panel[key][0]+dx)),Math.max(0,Math.min(panel.canvas.height,panel[key][1]+dy))];panel.render();update();
    }));
    details.append(nudges);body.append(details);
    body.append(button('Skip for prototype',()=>{
      for(const p of panels){if(marksReady(p)&&!p.illustrativeAlignment)continue;const xs=p.points.map(a=>a[0]),ys=p.points.map(a=>a[1]);const cx=(Math.min(...xs)+Math.max(...xs))/2;p.opticalCentre=[cx,(Math.min(...ys)+Math.max(...ys))/2];p.topMark=[cx,Math.min(...ys)];p.illustrativeAlignment=true;p.markReview={};p.render();}
      step=6;render(true);
    },'fit-link fit-preview-only'));
  }
  function render(focus=false) {
    cleanupStep(); cleanupStep = () => {};
    stash(); message.textContent=''; title.textContent=titles[step]; shell.dataset.step=String(step);
    shell.querySelector('.fit-progress').textContent=`${step+1} / ${titles.length}`;
    back.textContent=step===0?'Scanner':'Back';next.textContent=step===0?'Confirm':step===7?'Prepare print':step===8?'Download test kit':'Continue';
    if(step===0)summary();
    if(step===1)methodScreen();
    if(step===2) {cleanupStep = mountPupilMeasurements(body, fields('left-pd'), fields('right-pd'));if(getMeasurementSource()!=='manual')note('Face scan estimate · verify before printing.');}
    if(step===3)cleanupStep=mountThicknessMeasurements(body,fields('left-edge-thickness'),fields('right-edge-thickness'));
    if(step===4||step===5)markScreen(step===4?left:right);
    if(step===6){inputs(['left-vertical-offset','right-vertical-offset','temple-length']);note('Zero offsets and 130 mm temples are starting settings. Adjust for the wearer.');}
    if(step===7)cleanupStep=mountFrameCatalog({body,viewer,status:designStatus,panels,getStyle:getFrameStyle,setStyle:setFrameStyle,getRetention:getRetentionStyle,setRetention:setRetentionStyle,getAssembly:getFrameAssembly,rebuild:()=>makeFrame(true),onUpdate:update,leftPd:()=>Number(fields('left-pd').value),rightPd:()=>Number(fields('right-pd').value),visualTryOn});
    if(step===8){inputs(['bed-width','bed-depth']);note(panels.some(p=>p.illustrativeAlignment)?'Prototype alignment · unverified fit-test STL only.':'Unverified fit-test STL kit. Slice at 100% in millimetres.');body.append(designStatus);const a=document.createElement('a');a.className='fit-link';a.href='?advanced=1'+location.hash;a.textContent='Physical checks';a.addEventListener('click',event=>{
      try {
        if(!Array.isArray(captureBackup))throw new Error('Return to Scanner to transfer both captures again.');
        const captures=captureBackup.map(item=>{const p=item.side==='left'?left:right;const sx=item.width/p.canvas.width,sy=item.height/p.canvas.height;return {...item,illustrativeAlignment:Boolean(p.illustrativeAlignment),opticalCentre:p.opticalCentre?.map((v,i)=>v*(i?sy:sx)),topMark:p.topMark?.map((v,i)=>v*(i?sy:sx))};});
        sessionStorage.setItem('optiframe-captures',JSON.stringify(captures));
        const ids=['left-pd','right-pd','left-edge-thickness','right-edge-thickness','left-vertical-offset','right-vertical-offset','temple-length','bed-width','bed-depth'];
        sessionStorage.setItem('optiframe-fit-inputs',JSON.stringify(Object.fromEntries(ids.map(id=>[id,fields(id).value]))));
      } catch(error){event.preventDefault();message.textContent=error.message;}
    });body.append(a);}
    update();if(focus)title.focus({preventScroll:true});
  }
  back.addEventListener('click',()=>{if(step===0){location.href='/'+location.hash;return;}if((step===4||step===5)&&markMode==='top'){markMode='optical';render(true);return;}step--;markMode='optical';render(true);});
  next.addEventListener('click',async()=>{
    update();if(next.disabled)return;
    if(step===4||step===5){const p=step===4?left:right;p.markReview||={};if(markMode==='optical'){p.markReview.optical=true;markMode='top';if(p.illustrativeAlignment)p.illustrativeAlignment='marking';render(true);return;}p.markReview.top=true;if(p.markReview.optical&&p.markReview.top)p.illustrativeAlignment=false;}
    if(step===8){exporting=true;update();await makeFrame(false,true);exporting=false;update();return;}
    if(step===1&&method==='native'&&faceReviewed){const value={...face,source:'arkit-eye-transform-estimate'};saveConfirmedFace(value);applyFaceMeasurements(value);}
    step++;markMode='optical';render(true);
  });
  shell.addEventListener('input',update);shell.addEventListener('change',update);
  panels.forEach(p=>p.canvas.addEventListener('pointerup',update));
  new MutationObserver(update).observe(viewer,{attributes:true,attributeFilter:['class','data-stale']});
  const resize=()=>{const viewport=window.visualViewport;const height=viewport?.height||window.innerHeight;shell.style.setProperty('--fit-height',`${height}px`);shell.classList.toggle('is-keyboard',height<window.innerHeight*.78);shell.classList.toggle('is-compact',height<560);};
  window.visualViewport?.addEventListener('resize',resize);window.addEventListener('resize',resize);resize();
  render();await capturesReady;loading=false;panels.forEach(p=>{p.guidedCapture=false;});render();
}
