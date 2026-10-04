import { leftPanel, rightPanel, capturesReady, makeFrame, project, getFrameStyle, setFrameStyle, getFrameAssembly } from './app.js?v=27';
import { validateFaceFit, lensReady, marksReady } from './fit-validation.js';
import { mountPupilMeasurements } from './pupil-measurements.js?v=27';
import { mountFrameCatalog } from './frame-catalog.js?v=27';

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
  let step = 0, method = 'manual', face = null, faceReviewed = false, loading = true, exporting = false;
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
      enabled &&= marksReady(panel);
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
    for (const p of panels) {
      const item = document.createElement('figure'); const label = document.createElement('figcaption'); label.textContent = `${p.side === 'left' ? 'Left' : 'Right'} lens`; item.append(label);
      if (lensReady(p)) {
        const points = p.points.map(point => project(point, p.homography));
        const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
        const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs)-x, h = Math.max(...ys)-y;
        const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
        svg.setAttribute('viewBox',`${x-7} ${y-7} ${w+14} ${h+14}`); svg.setAttribute('role','img'); svg.setAttribute('aria-label',`${p.side} lens, ${w.toFixed(1)} by ${h.toFixed(1)} millimetres`);
        const path = document.createElementNS(svg.namespaceURI,'path'); path.setAttribute('d',points.map((p,i)=>`${i?'L':'M'}${p[0]} ${p[1]}`).join(' ')+'Z'); svg.append(path);
        const text = document.createElementNS(svg.namespaceURI,'text'); text.setAttribute('x',x+w/2); text.setAttribute('y',y+h/2); text.textContent = `${w.toFixed(1)} × ${h.toFixed(1)} mm`; svg.append(text); item.append(svg);
      }
      pair.append(item);
    }
    body.append(pair);
    if (!panels.every(lensReady)) {
      note(loading ? 'Opening your captures…' : 'Scan both lenses to begin.');
      const a = document.createElement('a'); a.className = 'fit-link'; a.href = '/'+location.hash; a.textContent = 'Scan lenses'; body.append(a);
    } else {
      const a = document.createElement('a'); a.className = 'fit-link'; a.href = '/'+location.hash; a.textContent = 'Rescan'; body.append(a);
    }
  }
  function methodScreen() {
    const group = document.createElement('fieldset'); group.className='fit-methods';
    const legend = document.createElement('legend'); legend.textContent='Measurement source'; group.append(legend);
    for(const [value,label] of [['manual','Enter measurements'],['native','Import face scan']]) {
      const l = document.createElement('label'), radio=document.createElement('input'); radio.type='radio'; radio.name='fit-method';radio.value=value;radio.checked=method===value;
      radio.addEventListener('change',()=>{method=value;render();}); l.append(radio,document.createTextNode(label)); group.append(l);
    }
    body.append(group);
    if(method==='native') {
      note('Import an ARKit face estimate from the iPhone app. Browser ARCore cannot measure a face.');
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
    panel.setMode(markMode);
    note('Place the crosshair on the provider’s mark. Drag to refine.');
    const modes=document.createElement('div');modes.className='fit-mark-modes';
    for(const [mode,label] of [['optical','Optical centre'],['top','Lens top']]) {
      const b=button(label,()=>{markMode=mode;render();}); b.setAttribute('aria-pressed',String(mode===markMode));modes.append(b);
    }
    body.append(modes,panel.el);
    const nudges=document.createElement('div');nudges.className='fit-nudges';nudges.setAttribute('aria-label','Fine adjustment, one image pixel');
    for(const [label,dx,dy] of [['Left',-1,0],['Up',0,-1],['Down',0,1],['Right',1,0]])nudges.append(button(label,()=>{
      const key=markMode==='optical'?'opticalCentre':'topMark';if(!panel[key])return;
      panel[key]=[Math.max(0,Math.min(panel.canvas.width,panel[key][0]+dx)),Math.max(0,Math.min(panel.canvas.height,panel[key][1]+dy))];panel.render();update();
    }));
    body.append(nudges);
  }
  function render(focus=false) {
    cleanupStep(); cleanupStep = () => {};
    stash(); message.textContent=''; title.textContent=titles[step]; shell.dataset.step=String(step);
    shell.querySelector('.fit-progress').textContent=`${step+1} / ${titles.length}`;
    back.textContent=step===0?'Scanner':'Back';next.textContent=step===0?'Confirm':step===7?'Prepare print':step===8?'Download test kit':'Continue';
    if(step===0)summary();
    if(step===1)methodScreen();
    if(step===2) cleanupStep = mountPupilMeasurements(body, fields('left-pd'), fields('right-pd'));
    if(step===3){note('Measure each lens edge with calipers, in millimetres.');inputs(['left-edge-thickness','right-edge-thickness']);}
    if(step===4||step===5)markScreen(step===4?left:right);
    if(step===6){inputs(['left-vertical-offset','right-vertical-offset','temple-length']);note('Zero offsets and 130 mm temples are starting settings. Adjust for the wearer.');}
    if(step===7)cleanupStep=mountFrameCatalog({body,viewer,status:designStatus,panels,getStyle:getFrameStyle,setStyle:setFrameStyle,getAssembly:getFrameAssembly,rebuild:()=>makeFrame(true),onUpdate:update,leftPd:()=>Number(fields('left-pd').value),rightPd:()=>Number(fields('right-pd').value)});
    if(step===8){inputs(['bed-width','bed-depth']);note('Unverified fit-test STL kit. Slice at 100% in millimetres.');body.append(designStatus);const a=document.createElement('a');a.className='fit-link';a.href='?advanced=1'+location.hash;a.textContent='Physical checks';a.addEventListener('click',event=>{
      try {
        if(!Array.isArray(captureBackup))throw new Error('Return to Scanner to transfer both captures again.');
        const captures=captureBackup.map(item=>{const p=item.side==='left'?left:right;const sx=item.width/p.canvas.width,sy=item.height/p.canvas.height;return {...item,opticalCentre:p.opticalCentre?.map((v,i)=>v*(i?sy:sx)),topMark:p.topMark?.map((v,i)=>v*(i?sy:sx))};});
        sessionStorage.setItem('optiframe-captures',JSON.stringify(captures));
        const ids=['left-pd','right-pd','left-edge-thickness','right-edge-thickness','left-vertical-offset','right-vertical-offset','temple-length','bed-width','bed-depth'];
        sessionStorage.setItem('optiframe-fit-inputs',JSON.stringify(Object.fromEntries(ids.map(id=>[id,fields(id).value]))));
      } catch(error){event.preventDefault();message.textContent=error.message;}
    });body.append(a);}
    update();if(focus)title.focus({preventScroll:true});
  }
  back.addEventListener('click',()=>{if(step===0){location.href='/'+location.hash;return;}step--;markMode='optical';render(true);});
  next.addEventListener('click',async()=>{
    update();if(next.disabled)return;
    if(step===8){exporting=true;update();await makeFrame(false,true);exporting=false;update();return;}
    if(step===1&&method==='native'&&faceReviewed){fields('left-pd').value=face.left.toFixed(1);fields('right-pd').value=face.right.toFixed(1);for(const id of ['left-pd','right-pd'])fields(id).dispatchEvent(new Event('input',{bubbles:true}));}
    step++;markMode='optical';render(true);
  });
  shell.addEventListener('input',update);shell.addEventListener('change',update);
  panels.forEach(p=>p.canvas.addEventListener('pointerup',update));
  new MutationObserver(update).observe(viewer,{attributes:true,attributeFilter:['class','data-stale']});
  const resize=()=>{const viewport=window.visualViewport;const height=viewport?.height||window.innerHeight;shell.style.setProperty('--fit-height',`${height}px`);shell.classList.toggle('is-keyboard',height<window.innerHeight*.78);shell.classList.toggle('is-compact',height<560);};
  window.visualViewport?.addEventListener('resize',resize);window.addEventListener('resize',resize);resize();
  render();await capturesReady;loading=false;panels.forEach(p=>{p.guidedCapture=false;});render();
}
