import heroSource from './assets/hero-source.js';
import {catalogConcepts} from './assets/catalog-concepts.js?v=29';

const collectionChoices=[...document.querySelectorAll('.collection-style')];
let chosenStyle='classic';
try{const saved=sessionStorage.getItem('optiframe-frame-style');if(['classic','bold','brow'].includes(saved))chosenStyle=saved;}catch{}
function chooseStyle(style){
  chosenStyle=style;
  for(const button of collectionChoices)button.setAttribute('aria-pressed',String(button.dataset.style===style));
  document.getElementById('collection-scan').textContent=`Scan for ${style[0].toUpperCase()+style.slice(1)}`;
  try{sessionStorage.setItem('optiframe-frame-style',style);}catch{}
}
for(const button of collectionChoices){
  const img=button.querySelector('img');img.src=catalogConcepts;img.style.setProperty('--concept-index',img.dataset.concept);
  button.addEventListener('click',()=>chooseStyle(button.dataset.style));
}
chooseStyle(chosenStyle);

const heroImage = document.getElementById('hero-image');
// One short studio reveal; never keep a mobile GPU busy with a decorative loop.
if (navigator.connection?.saveData || document.hidden) document.body.classList.add('motion-still');
document.addEventListener('visibilitychange', () => {
  if (document.hidden) document.body.classList.add('motion-still');
});
heroImage.addEventListener('load', () => { heroImage.hidden = false; }, { once: true });
heroImage.src = heroSource;

/* Keep a shared session's access fragment when moving into the capture app. */
(() => {
  let access = new URLSearchParams(window.location.hash.slice(1)).get('access');
  function preserveAccess() {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    if (fragment.has('access')) access = fragment.get('access');
    for (const link of document.querySelectorAll('[data-preserve-access]')) {
      const url = new URL(link.getAttribute('href'), window.location.origin);
      url.hash = access ? new URLSearchParams({ access }).toString() : '';
      link.href = url.pathname + url.search + url.hash;
    }
  }
  preserveAccess();
  window.addEventListener('hashchange', preserveAccess);
  for (const link of document.querySelectorAll('a[href^="#"]')) {
    link.addEventListener('click', event => {
      const target = document.getElementById(link.getAttribute('href').slice(1));
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    });
  }
})();
