// Torch control stays on the existing camera track; it never opens a second camera.
export function createCameraTorch(onChange = () => {}, timeoutMs = 3000) {
  let track = null, revision = 0;
  let state = {supported:false, enabled:false, busy:false, error:''};
  const emit = patch => { state={...state,...patch};onChange({...state}); };
  const off = target => {
    if (target?.readyState !== 'ended') {
      try { void target?.applyConstraints?.({torch:false,advanced:[{torch:false}]}).catch(()=>{}); } catch {}
    }
  };
  return {
    attach(next) {
      const previous=track;revision++;track=next;
      if(previous && state.supported)off(previous);
      let capability;
      try { capability=next?.getCapabilities?.().torch; } catch {}
      const supported=Boolean(next?.applyConstraints && (capability===true ||
        Array.isArray(capability)&&capability.includes(true)&&capability.includes(false)));
      let enabled=false;try{enabled=next?.getSettings?.().torch===true;}catch{}
      emit({supported,enabled:supported&&enabled,busy:false,error:''});
    },
    async set(enabled) {
      if(!track||!state.supported||state.busy)return false;
      const target=track, token=revision;
      let timer, expired=false;
      emit({busy:true,error:''});
      try {
        // Preserve continuous focus/exposure and any other active constraints.
        const constraints=target.getConstraints?.()||{};
        const advanced=(constraints.advanced||[]).map(({torch,...rest})=>rest);
        const applied=Promise.resolve(target.applyConstraints({...constraints,torch:enabled,advanced:[...advanced,{torch:enabled}]}));
        void applied.then(()=>{if(expired)off(target);},()=>{});
        await Promise.race([applied,new Promise((_,reject)=>{timer=setTimeout(()=>{
          expired=true;reject(new Error('Flashlight timed out'));
        },timeoutMs);})]);
        if(token!==revision){off(target);return false;}
        const actual=target.getSettings?.().torch;
        if(typeof actual==='boolean' && actual!==enabled)throw new Error('Flashlight change was not applied');
        emit({enabled,busy:false});return true;
      } catch(error) {
        if(token===revision)emit({busy:false,...(expired?{supported:false}:{}),error:'Flashlight unavailable in this browser.'});
        return false;
      } finally {clearTimeout(timer);}
    },
    get state(){return {...state};},
  };
}
