const styles = [
  {id:'classic', name:'Classic', rim:10.6},
  {id:'bold', name:'Bold', rim:13},
  {id:'brow', name:'Brow', rim:10.6},
];

export function mountFrameCatalog({body, viewer, status, panels, getStyle, setStyle, getAssembly, rebuild, onUpdate, leftPd, rightPd}) {
  let alive = true, busy = false, closeTryOn = null;
  const choices = document.createElement('div'); choices.className='frame-catalog';
  choices.setAttribute('role','group'); choices.setAttribute('aria-label','Frame style');
  let contours;
  try { contours=panels.map(panel=>panel.millimetreOutline()); } catch { contours=null; }
  for (const style of styles) {
    const button=document.createElement('button'); button.type='button'; button.className='frame-style';
    button.dataset.style=style.id; button.setAttribute('aria-pressed',String(getStyle()===style.id));
    if (contours?.every(points=>Array.isArray(points)&&points.length>2)) {
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('viewBox','-82 -42 164 84');svg.setAttribute('aria-hidden','true');
      contours.forEach((points,index)=>{
        // Catalog thumbnails use the captured silhouettes. The large viewer
        // displays the generated printable assembly for the selected style.
        const path=document.createElementNS(svg.namespaceURI,'path');
        const shifted=points.map(([x,y])=>[x+(index?32:-32),-y]);
        const d=shifted.map(([x,y],i)=>`${i?'L':'M'}${x} ${y}`).join(' ')+'Z';
        path.setAttribute('d',d);path.setAttribute('stroke-width',style.rim);svg.append(path);
        if(style.id==='brow') {const brow=path.cloneNode();brow.setAttribute('transform','translate(0 -2)');svg.prepend(brow);}
      });
      const bridge=document.createElementNS(svg.namespaceURI,'path');bridge.setAttribute('d','M-8 0Q0 -8 8 0');bridge.setAttribute('stroke-width','5');svg.append(bridge);
      button.append(svg);
    }
    const label=document.createElement('span');label.textContent=style.name;button.append(label);choices.append(button);
    button.addEventListener('click',async()=>{
      if (getStyle()===style.id) return;
      setStyle(style.id); refresh(); onUpdate();
      await rebuild(); if(alive){refresh();onUpdate();}
    });
  }
  const actions=document.createElement('div');actions.className='catalog-actions';
  const tryOn=document.createElement('button');tryOn.type='button';tryOn.className='catalog-tryon';tryOn.textContent='Try on';
  const retry=document.createElement('button');retry.type='button';retry.className='fit-link';retry.textContent='Rebuild';
  retry.addEventListener('click',async()=>{await rebuild();if(alive){refresh();onUpdate();}});
  tryOn.addEventListener('click',async()=>{
    const assembly=getAssembly(); if(!assembly||busy)return;
    busy=true;refresh();
    try {
      const {openFaceTryOn}=await import('./face-tryon.js?v=27');
      if(!alive)return;
      closeTryOn=await openFaceTryOn({assembly,leftPd:leftPd(),rightPd:rightPd()});
      if(!alive)closeTryOn?.();
    } catch(error) {if(alive)status.textContent=error.message||'Try-on unavailable. Please retry.';}
    finally {busy=false;if(alive)refresh();}
  });
  actions.append(tryOn,retry);body.append(viewer,choices,actions,status);
  function refresh(){
    const ready=Boolean(getAssembly())&&viewer.dataset.stale==='false';
    for(const button of choices.children)button.setAttribute('aria-pressed',String(button.dataset.style===getStyle()));
    tryOn.disabled=!ready||busy;tryOn.textContent=busy?'Opening…':'Try on';retry.hidden=ready;
  }
  const observer=new MutationObserver(refresh);observer.observe(viewer,{attributes:true,attributeFilter:['class','data-stale']});
  refresh();void rebuild().then(()=>{if(alive){refresh();onUpdate();}});
  return ()=>{alive=false;observer.disconnect();closeTryOn?.();};
}
