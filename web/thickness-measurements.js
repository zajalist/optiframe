export function thicknessGeometry(value) {
  const mm = typeof value === 'string' && value.trim() === '' ? NaN : Number(value);
  return Number.isFinite(mm) && mm >= 1 && mm <= 6
    ? {valid:true, height:mm * 12, label:`${mm.toFixed(1)} mm`}
    : {valid:false, height:0, label:'—'};
}

export function mountThicknessMeasurements(body, left, right) {
  const abort = new AbortController();
  const guide=document.createElement('img');guide.className='thickness-guide';guide.src=thicknessGuide;guide.alt='Illustration: caliper jaws measure the lens retaining edge';body.append(guide);
  const group = document.createElement('div'); group.className='thickness-pair';
  for (const [side,input] of [['Left',left],['Right',right]]) {
    const card=document.createElement('div');card.className='thickness-lens';
    card.innerHTML=`<span class="thickness-name">${side} lens</span><svg viewBox="0 0 150 125" role="img" aria-label="${side} measured edge thickness, schematic cross-section"><defs><linearGradient id="thickness-${side}" x2="0" y2="1"><stop stop-color="#f2f5fa"/><stop offset=".4" stop-color="#acbacb" stop-opacity=".3"/><stop offset="1" stop-color="#718397"/></linearGradient></defs><rect class="thickness-edge" x="20" width="110" rx="1" fill="url(#thickness-${side})"/><text x="75" y="111"></text></svg>`;
    const label=input.closest('label');const fieldGroup=document.createElement('div');fieldGroup.className='fit-fields design-inputs';fieldGroup.append(label);card.append(fieldGroup);group.append(card);
    const update=()=>{const geometry=thicknessGeometry(input.value),shape=card.querySelector('rect');shape.setAttribute('y',String(53-geometry.height/2));shape.setAttribute('height',String(geometry.height));shape.style.visibility=geometry.valid?'visible':'hidden';card.querySelector('text').textContent=geometry.label;};
    input.addEventListener('input',update,{signal:abort.signal});input.addEventListener('change',update,{signal:abort.signal});update();
  }
  body.append(group);
  const hint=document.createElement('p');hint.className='fit-note thickness-hint';hint.textContent='Measure the retaining edge with calipers.';body.append(hint);
  return()=>abort.abort();
}
import thicknessGuide from './assets/thickness-guide.js?v=35';

