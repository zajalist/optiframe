import { catalogConcepts } from './assets/catalog-concepts.js?v=29';

const styles = [
  {id:'classic', name:'Classic', rim:10.6},
  {id:'bold', name:'Bold', rim:13},
  {id:'brow', name:'Brow', rim:10.6},
];

export function mountFrameCatalog({body, viewer, status, panels, getStyle, setStyle, getRetention, setRetention, getAssembly, rebuild, onUpdate, leftPd, rightPd, visualTryOn}) {
  let alive = true, busy = false, building = false, closeTryOn = null;
  if (!document.querySelector('link[data-frame-catalog]')) {
    const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./frame-catalog.css?v=49',import.meta.url).href;
    css.dataset.frameCatalog='';document.head.append(css);
  }
  const choices = document.createElement('div'); choices.className='frame-catalog';
  choices.setAttribute('role','group'); choices.setAttribute('aria-label','Frame style');
  const caption=document.createElement('p');caption.className='catalog-caption';caption.id='catalog-concepts-label';caption.textContent='Style concepts';
  choices.setAttribute('aria-describedby',caption.id);
  let contours;
  try { contours=panels.map(panel=>panel.millimetreOutline()); } catch { contours=null; }
  for (const [index,style] of styles.entries()) {
    const button=document.createElement('button'); button.type='button'; button.className='frame-style';
    button.dataset.style=style.id; button.setAttribute('aria-pressed',String(getStyle()===style.id));
    const artwork=document.createElement('span');artwork.className='frame-style-art';artwork.setAttribute('aria-hidden','true');
    const photo=document.createElement('img');photo.className='frame-style-photo';photo.src=catalogConcepts;photo.alt='';photo.decoding='async';photo.draggable=false;
    photo.style.setProperty('--style-index',index);artwork.append(photo);
    if (contours?.every(points=>Array.isArray(points)&&points.length>2)) {
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('viewBox','-82 -42 164 84');svg.setAttribute('aria-hidden','true');
      contours.forEach((points,index)=>{
        // A failed concept image falls back to the captured silhouettes.
        // The large viewer displays the generated printable assembly.
        const path=document.createElementNS(svg.namespaceURI,'path');
        const shifted=points.map(([x,y])=>[x+(index?32:-32),-y]);
        const d=shifted.map(([x,y],i)=>`${i?'L':'M'}${x} ${y}`).join(' ')+'Z';
        path.setAttribute('d',d);path.setAttribute('stroke-width',style.rim);svg.append(path);
        if(style.id==='brow') {const brow=path.cloneNode();brow.setAttribute('transform','translate(0 -2)');svg.prepend(brow);}
      });
      const bridge=document.createElementNS(svg.namespaceURI,'path');bridge.setAttribute('d','M-8 0Q0 -8 8 0');bridge.setAttribute('stroke-width','5');svg.append(bridge);
      svg.classList.add('frame-style-fallback');artwork.append(svg);
      photo.addEventListener('error',()=>{photo.hidden=true;artwork.classList.add('is-fallback');});
    }
    const label=document.createElement('span');label.className='frame-style-name';label.textContent=style.name;
    const check=document.createElementNS('http://www.w3.org/2000/svg','svg');check.classList.add('frame-style-check');check.setAttribute('viewBox','0 0 16 16');check.setAttribute('aria-hidden','true');
    const checkPath=document.createElementNS(check.namespaceURI,'path');checkPath.setAttribute('d','m4 8 2.5 2.5L12 5');check.append(checkPath);
    button.append(artwork,label,check);choices.append(button);
    button.addEventListener('click',async()=>{
      if (building || getStyle()===style.id) return;
      setStyle(style.id); refresh(); onUpdate();
      await build();
    });
  }
  const actions=document.createElement('div');actions.className='catalog-actions';
  const retention=document.createElement('div');retention.className='catalog-retention';retention.setAttribute('role','group');retention.setAttribute('aria-label','Lens retention');
  for(const [id,name] of [['screw','Screw'],['snap','Push pins'],['clip','Clip-in']]){
    const choice=document.createElement('button');choice.type='button';choice.dataset.retention=id;choice.textContent=name;
    choice.setAttribute('aria-label',id==='screw'?'Screw retention':`${name} retention, experimental`);
    choice.addEventListener('click',async()=>{
      if(building||getRetention()===id)return;
      setRetention(id);refresh();onUpdate();await build();
    });retention.append(choice);
  }
  const tryOn=document.createElement('button');tryOn.type='button';tryOn.className='catalog-tryon';tryOn.textContent='Try on';
  const retry=document.createElement('button');retry.type='button';retry.className='fit-link';retry.textContent='Rebuild';
  retry.addEventListener('click',build);
  tryOn.addEventListener('click',async()=>{
    if(busy||building)return;
    const assembly=getAssembly();
    if(!assembly||viewer.dataset.stale!=='false'){visualTryOn?.();return;}
    busy=true;refresh();
    try {
      const {openFaceTryOn}=await import('./face-tryon.js?v=45');
      if(!alive)return;
      closeTryOn=await openFaceTryOn({assembly,leftPd:leftPd(),rightPd:rightPd()});
      if(!alive)closeTryOn?.();
    } catch(error) {if(alive)status.textContent=error.message||'Try-on unavailable. Please retry.';}
    finally {busy=false;if(alive)refresh();}
  });
  actions.append(retention,tryOn,retry);body.append(viewer,caption,choices,actions,status);
  async function build(){
    if(building || !alive)return;
    building=true;refresh();
    try {await rebuild();}
    catch(error){if(alive)status.textContent=error.message||'Could not build this frame. Try again.';}
    finally {building=false;if(alive){refresh();onUpdate();}}
  }
  function refresh(){
    const ready=Boolean(getAssembly())&&viewer.dataset.stale==='false';
    choices.setAttribute('aria-busy',String(building));
    for(const button of choices.children){button.setAttribute('aria-pressed',String(button.dataset.style===getStyle()));button.disabled=building;}
    for(const button of retention.children){button.setAttribute('aria-pressed',String(button.dataset.retention===getRetention()));button.disabled=building;}
    tryOn.disabled=(!ready&&!visualTryOn)||busy||building;tryOn.textContent=busy?'Opening…':!ready&&visualTryOn?'Just try on':'Try on';retry.hidden=ready||building;
  }
  const observer=new MutationObserver(refresh);observer.observe(viewer,{attributes:true,attributeFilter:['class','data-stale']});
  refresh();void build();
  return ()=>{alive=false;observer.disconnect();closeTryOn?.();};
}
