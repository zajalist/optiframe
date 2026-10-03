import heroSource from './assets/hero-source.js';

const heroImage = document.getElementById('hero-image');
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
