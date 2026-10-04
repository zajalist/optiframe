/** A decorative video never blocks the landing page or replaces an unready poster. */
export function heroMotionSource(value, base) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, base), origin = new URL(base);
    return url.protocol === 'https:' || (url.origin === origin.origin && url.protocol === origin.protocol)
      ? url.href : null;
  } catch { return null; }
}

export function mountHeroMotion({container, button, configUrl='/assets/hero-motion.json?v=44',
  doc=document, win=window, connection=navigator.connection, fetcher=fetch,
  observe=typeof IntersectionObserver === 'function' ? callback=>new IntersectionObserver(callback,{threshold:.05}) : null}={}) {
  if (!container || !button) return ()=>{};
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)');
  let visible=false, disposed=false, failed=false, paused=false, loading=null, video=null;
  let pendingPlay=false, generation=0, blocked=false, playing=false;
  button.hidden=true;
  const allowed=()=>!disposed&&!failed&&visible&&!doc.hidden&&!reduced.matches&&!connection?.saveData;
  function render() {
    button.hidden=!video || failed || reduced.matches || Boolean(connection?.saveData);
    button.dataset.state=playing?'playing':'paused';
    button.setAttribute('aria-label',playing?'Pause animation':'Play animation');
    button.setAttribute('aria-pressed',String(playing));
  }
  function stop({poster=false}={}) {
    generation++;pendingPlay=false;playing=false;
    video?.pause();
    if(poster)container.classList.remove('has-motion');
    render();
  }
  function fail() {
    failed=true;stop({poster:true});
    video?.removeAttribute('src');video?.load();video?.remove();video=null;render();
  }
  async function play() {
    if(!video || pendingPlay || playing || !allowed() || paused || blocked)return;
    const token=++generation;pendingPlay=true;
    try {
      await video.play();
      if(token!==generation)return;
      if(!allowed() || paused){video.pause();return;}
      playing=true;container.classList.add('has-motion');render();
    } catch {
      // Autoplay may be blocked, including iPhone Low Power Mode. Keep the
      // still image and let the explicit control make one user-initiated retry.
      if(token===generation){blocked=true;playing=false;container.classList.remove('has-motion');render();}
    } finally {if(token===generation)pendingPlay=false;}
  }
  async function load() {
    if(loading || video || !allowed())return;
    const controller=new AbortController();loading=controller;
    try {
      const response=await fetcher(configUrl,{signal:controller.signal,credentials:'same-origin'});
      if(!response.ok)throw new Error('Unavailable motion');
      const config=await response.json(), src=heroMotionSource(config.src,win.location.href);
      if(controller.signal.aborted || !allowed())return;
      if(!src){failed=true;return;}
      video=doc.createElement('video');video.className='hero-motion';
      video.muted=true;video.defaultMuted=true;video.loop=true;video.playsInline=true;video.preload='metadata';
      video.setAttribute('muted','');video.setAttribute('playsinline','');video.setAttribute('aria-hidden','true');
      video.addEventListener('error',fail,{once:true});
      video.src=src;container.append(video);render();void play();
    } catch(error) {
      if(!controller.signal.aborted)failed=true;
    } finally {if(loading===controller)loading=null;}
  }
  function update() {
    if(!allowed()) {
      loading?.abort();loading=null;
      stop({poster:reduced.matches || Boolean(connection?.saveData)});return;
    }
    if(!video)void load();else void play();
  }
  function toggle() {
    if(playing || pendingPlay){paused=true;stop();}
    else {paused=false;blocked=false;void play();}
  }
  const observer=observe?.(entries=>{visible=entries.some(entry=>entry.isIntersecting);update();});
  if(observer)observer.observe(container);
  else {const rect=container.getBoundingClientRect();visible=rect.bottom>0&&rect.top<win.innerHeight;}
  const onPageHide=()=>{visible=false;update();};
  const onPageShow=()=>{const rect=container.getBoundingClientRect();visible=rect.bottom>0&&rect.top<win.innerHeight;update();};
  doc.addEventListener('visibilitychange',update);
  win.addEventListener('pagehide',onPageHide);
  win.addEventListener('pageshow',onPageShow);
  if(!observer)win.addEventListener('scroll',onPageShow,{passive:true});
  reduced.addEventListener?.('change',update);
  connection?.addEventListener?.('change',update);
  button.addEventListener('click',toggle);update();
  return ()=>{
    disposed=true;loading?.abort();stop({poster:true});observer?.disconnect();
    doc.removeEventListener('visibilitychange',update);win.removeEventListener('pagehide',onPageHide);
    win.removeEventListener('pageshow',onPageShow);if(!observer)win.removeEventListener('scroll',onPageShow);
    reduced.removeEventListener?.('change',update);connection?.removeEventListener?.('change',update);
    button.removeEventListener('click',toggle);video?.removeAttribute('src');video?.load();video?.remove();button.hidden=true;
  };
}
