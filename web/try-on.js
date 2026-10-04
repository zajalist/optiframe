import {visualFitPayload,captureOutlines,nativeTryOnFile} from './visual-fit.js?v=36';
import {saveConfirmedFace,loadConfirmedFace} from './face-confirmation.js?v=39';
import {apiFetch} from './api-fetch.js?v=43';
const $=id=>document.getElementById(id);
const entry=new URLSearchParams(location.search||'');
let demoMode=entry.get('demo')==='1';
$('home').hash=location.hash;
let outlines=null,assembly=null,style='classic',sequence=0,controller,closeTryOn=null,closeScan=null,opening=false;
try{const preferred=entry.get('style')||sessionStorage.getItem('optiframe-frame-style');if(['classic','bold','brow'].includes(preferred))style=preferred;}catch{}
const cache=new Map();
function usableCaptures(){
  try{
    const saved=JSON.parse(sessionStorage.getItem('optiframe-captures')||'null');
    if(!Array.isArray(saved)||saved.length!==2||!saved.every(item=>typeof item.image==='string'&&/^data:image\//.test(item.image)&&Number.isFinite(item.width)&&item.width>0&&Number.isFinite(item.height)&&item.height>0&&item.contour?.length>=12))return false;
    const pair=captureOutlines(saved);visualFitPayload(pair);return true;
  }catch{return false;}
}
function fittingLink(){
  const available=usableCaptures();
  $('continue-fitting').href=(available?'/studio.html?v=43':'/index.html')+location.hash;
  $('continue-fitting').textContent=available?'Continue fitting':'Scan lenses';
  $('continue-fitting').hidden=false;
}
function renderFace(){
  const face=loadConfirmedFace();$('face-result').hidden=!face;
  if(face){$('face-values').textContent=`Wearer left ${face.left.toFixed(1)} · Right ${face.right.toFixed(1)} mm`;fittingLink();}
}
renderFace();
try {
  const transferred=!demoMode&&sessionStorage.getItem('optiframe-visual-outlines');
  if(transferred){outlines=JSON.parse(transferred);$('source').textContent='Your lens shapes · Illustrative fit';}
  else if(!demoMode){const raw=sessionStorage.getItem('optiframe-captures');if(raw){outlines=captureOutlines(JSON.parse(raw));$('source').textContent='Your lens shapes · Illustrative fit';}}
} catch { $('status').textContent='Could not open your lens outlines.'; }
async function sample(signal){
  const response=await fetch(`/assets/demo-${style}.json?v=43`,{signal});
  if(!response.ok)throw new Error('Sample frames unavailable. Tap Retry.');
  const model=await response.json();
  if(model.schemaVersion!==1||model.frameStyle!==style||model.alignmentSource!=='illustrative'||!model.meshes?.length)
    throw new Error('Sample frames unavailable. Tap Retry.');
  return model;
}
function ready(value){$('try').disabled=!value||opening;$('native').disabled=!value;}
async function build(){
  const request=++sequence;controller?.abort();controller=new AbortController();const currentController=controller;const signal=currentController.signal;const timer=setTimeout(()=>currentController.abort(),60000);
  assembly=null;ready(false);$('viewer').dataset.stale='true';$('status').textContent='Preparing frame…';$('retry').hidden=true;$('sample').hidden=true;
  for(const b of document.querySelectorAll('[data-style]'))b.setAttribute('aria-pressed',String(b.dataset.style===style));
  try {
    const isDemo=demoMode||!outlines;
    $('source').textContent=isDemo?'Sample frames · Visual preview':'Your lens shapes · Illustrative fit';
    const payload=isDemo?null:visualFitPayload(outlines,style),key=isDemo?`demo:${style}`:JSON.stringify(payload);
    let result=cache.get(key);
    if(!result&&isDemo){result=await sample(signal);if(request!==sequence)return;cache.set(key,result);}
    else if(!result){
      let response;
      for(let attempt=0;attempt<3;attempt++){
        response=await apiFetch('/api/frame-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal});
        if(response.status!==503||attempt===2)break;
        await new Promise(resolve=>setTimeout(resolve,700));if(signal.aborted)throw new DOMException('Cancelled','AbortError');
      }
      if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(response.status===401?'Open your private try-on link.':response.status===503?'Frame service starting. Tap Retry.':error.detail||'Frame unavailable. Retry or use sample frames.');}
      result=await response.json();cache.set(key,result);
    }
    if(request!==sequence)return;
    const {showSTL}=await import('./viewer.js?v=42');if(request!==sequence)return;
    showSTL(new TextEncoder().encode(JSON.stringify(result)).buffer,$('viewer'));
    // Preserve the original viewer controls inside the secondary disclosure.
    const viewControls=$('viewer').querySelector('.frame-views');
    if(viewControls)$('view-options').replaceChildren(viewControls);
    assembly=nativeTryOnFile(result);$('viewer').dataset.stale='false';$('status').textContent='';ready(true);
  }catch(error){if(request!==sequence)return;$('status').textContent=error.name==='AbortError'?'Preview timed out. Retry.':error.message;$('retry').hidden=false;$('sample').hidden=false;}
  finally{clearTimeout(timer);}
}
for(const b of document.querySelectorAll('[data-style]'))b.addEventListener('click',()=>{if(style===b.dataset.style)return;style=b.dataset.style;try{sessionStorage.setItem('optiframe-frame-style',style);}catch{}void build();});
$('retry').addEventListener('click',build);
$('sample').addEventListener('click',()=>{demoMode=true;outlines=null;void build();});
$('try').addEventListener('click',async()=>{
  if(!assembly||opening)return;const current=assembly;opening=true;ready(true);$('try').textContent='Opening…';
  try{closeScan?.();const {openFaceTryOn}=await import('./face-tryon.js?v=45');closeTryOn=await openFaceTryOn({assembly:current});}
  catch(error){$('status').textContent=error.message;}
  finally{opening=false;$('try').textContent='Try on';ready(Boolean(assembly));}
});
$('scan-face').addEventListener('click',async()=>{
  if(opening)return;opening=true;$('scan-face').disabled=true;
  try{
    closeTryOn?.();const {openFaceScan}=await import('./face-scan.js?v=47');
    closeScan=openFaceScan({onConfirm:values=>{
      try{
        const confirmed=saveConfirmedFace(values);
        const saved=JSON.parse(sessionStorage.getItem('optiframe-fit-inputs')||'null');
        if(saved&&typeof saved==='object'&&!Array.isArray(saved)){
          const inputs=saved.values??saved;
          sessionStorage.setItem('optiframe-fit-inputs',JSON.stringify({values:{...inputs,
            'left-pd':confirmed.left.toFixed(1),'right-pd':confirmed.right.toFixed(1)},measurementSource:confirmed.source}));
        }
        renderFace();
      }
      catch(error){$('status').textContent=error.message||'Could not save your confirmed estimates.';}
    },onManual:()=>{
      if(usableCaptures())location.href='/studio.html?v=43&measure=manual'+location.hash;
      else{$('status').textContent='Scan both lenses to enter fitting measurements.';fittingLink();}
    }});
  }catch(error){$('status').textContent=error.message||'Face scan unavailable.';}
  finally{opening=false;$('scan-face').disabled=false;ready(Boolean(assembly));}
});
$('native').addEventListener('click',()=>{
  if(!assembly)return;const url=URL.createObjectURL(new Blob([JSON.stringify(assembly)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`optiframe-${style}-visual-tryon.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);$('native-note').hidden=false;
});
window.addEventListener('pagehide',()=>{++sequence;controller?.abort();closeTryOn?.();closeScan?.();});
void build();
