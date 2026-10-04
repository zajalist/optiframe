const $ = id => document.getElementById(id);
const access = new URLSearchParams(location.hash.slice(1)).get('access');
$('home').hash = location.hash;
let style = 'classic';
let retention = 'screw';
let fixture;
let generation = 0;
let pending;
let ready = false;
let exporting = false;
const cache = new Map();
const payload = () => ({ ...fixture, settings: { ...fixture.settings, frame_style: style, retention_style: retention } });
async function api(path, body, signal) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(path, { method: 'POST', headers: {
      'Content-Type': 'application/json', ...(access ? { 'X-OptiFrame-Key': access } : {}),
    }, body: JSON.stringify(body), signal });
    if (response.status !== 503 || attempt === 2) return response;
    await new Promise((resolve, reject) => {
      const cancel = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, 1000 * (attempt + 1));
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
    });
  }
}
async function checked(response) {
  if (response.ok) return response;
  const detail = await response.json().catch(() => ({}));
  if (response.status === 429 || response.status === 503) throw new Error('Service busy. Try again shortly.');
  throw new Error(typeof detail.detail === 'string' ? detail.detail : response.status === 401 || response.status === 403 ? 'Open your private review link to continue.' : 'Model unavailable. Try again.');
}
function renderSelection() {
  document.querySelectorAll('[data-style]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.style === style)));
  document.querySelectorAll('[data-retention]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.retention === retention)));
  $('model-name').textContent = style[0].toUpperCase() + style.slice(1);
  $('fit-note').textContent = retention === 'snap' ? 'Experimental snap fit · Test retention first' : 'Experimental fit · Verify before wear';
  $('download').disabled = !ready || exporting;
}
async function build() {
  const request = ++generation;
  pending?.abort();
  pending = new AbortController();
  const controller = pending;
  const timer = setTimeout(() => controller.abort(), 60000);
  ready = false;
  $('viewer').dataset.stale = 'true';
  $('status').textContent = 'Building model…';
  $('rebuild').hidden = true;
  renderSelection();
  try {
    if (!fixture) fixture = await fetch('/assets/review-lens-pair.json', { signal: controller.signal }).then(checked).then(response => response.json());
    if (request !== generation) return;
    const key = `${style}:${retention}`;
    let buffer = cache.get(key);
    if (!buffer) {
      const response = await checked(await api('/api/frame-preview', payload(), controller.signal));
      buffer = await response.arrayBuffer();
      const assembly = JSON.parse(new TextDecoder().decode(buffer));
      if (assembly.frameStyle !== style || assembly.retentionStyle !== retention) throw new Error('Model version changed. Retry the preview.');
      if (request !== generation) return;
      cache.set(key, buffer);
    }
    const { showSTL } = await import('./viewer.js?v=30');
    if (request !== generation) return;
    showSTL(buffer, $('viewer'));
    ready = true;
    $('viewer').dataset.stale = 'false';
    $('status').textContent = '';
  } catch (error) {
    if (request !== generation) return;
    $('status').textContent = error.name === 'AbortError' ? 'Preview timed out. Try again.' : error.message;
    $('rebuild').hidden = false;
  } finally {
    clearTimeout(timer);
    if (request === generation) renderSelection();
  }
}
document.querySelectorAll('[data-style]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.style === style) return;
  style = button.dataset.style; void build();
}));
document.querySelectorAll('[data-retention]').forEach(button => button.addEventListener('click', () => {
  if (button.dataset.retention === retention) return;
  retention = button.dataset.retention; void build();
}));
$('rebuild').addEventListener('click', () => void build());
$('download').addEventListener('click', async () => {
  if (!ready || exporting) return;
  exporting = true; renderSelection();
  const model = payload();
  const filename = `optiframe-${style}-${retention}-experimental.zip`;
  $('download').textContent = 'Preparing…';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await checked(await api('/api/frame', model, controller.signal));
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) {
    $('status').textContent = error.name === 'AbortError' ? 'Export timed out. Try again.' : error.message;
  } finally {
    clearTimeout(timer); exporting = false;
    $('download').textContent = 'Download STL kit'; renderSelection();
  }
});
void build();
