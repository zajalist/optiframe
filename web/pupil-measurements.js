import { pupilGeometry } from './pupil-geometry.js?v=27';
import pupilReference from './assets/pupil-reference.js?v=27';
// Reuse the fitting controls so validation and CAD keep the same source of truth.
export function mountPupilMeasurements(body, left, right) {
  const listeners = new AbortController();
  const diagram = document.createElement('div');
  diagram.className = 'pupil-diagram';
  diagram.innerHTML = `<svg viewBox="0 0 320 213" role="img" aria-label="Illustrative front view. Pupil markers respond to your measurements; this is not a face scan.">
    <image href="${pupilReference}" width="320" height="213" preserveAspectRatio="none"/>
    <path class="pupil-centre" d="M160 55V166"/>
    <g class="pupil-measure" data-pupil="left"><circle r="4" cy="88"/><path/><text y="185"></text></g>
    <g class="pupil-measure" data-pupil="right"><circle r="4" cy="88"/><path/><text y="185"></text></g>
  </svg>`;
  const group = document.createElement('div');
  group.className = 'fit-fields design-inputs pupil-fields';
  const hint = document.createElement('p');
  hint.className = 'pupil-hint'; hint.id = 'pupil-hint';
  hint.textContent = 'Illustration · nose centre to each pupil';
  const error = document.createElement('p');
  error.className = 'pupil-error'; error.id = 'pupil-error'; error.setAttribute('aria-live', 'polite');
  const update = () => {
    const invalid = [left, right].filter(input => (input.value !== '' || input.validity.badInput) && !input.validity.valid);
    for (const input of [left, right]) input.setAttribute('aria-invalid', String(invalid.includes(input)));
    error.textContent = invalid.length ? 'Enter each distance between 20 and 40 mm.' : '';
    for (const [side, input] of [['left', left], ['right', right]]) {
      const geometry = pupilGeometry(input.value, side);
      const marker = diagram.querySelector(`[data-pupil="${side}"]`);
      marker.classList.toggle('is-empty', !geometry.valid);
      marker.querySelector('circle').setAttribute('cx', geometry.x);
      marker.querySelector('path').setAttribute('d', geometry.valid ? `M${geometry.x} 100V166 M${geometry.x} 160H160 M160 156V164` : '');
      const text = marker.querySelector('text'); text.setAttribute('x', geometry.middle); text.textContent = geometry.label;
    }
  };
  for (const [side, input, next] of [['left', left, right], ['right', right, null]]) {
    const label = input.closest('label');
    // Preserve the input node and its original label text for advanced mode.
    label.dataset.pupil = side;
    const name = document.createElement('span'); name.className = 'pupil-field-name';
    name.textContent = side === 'left' ? 'Wearer’s left' : 'Wearer’s right';
    const original = [...label.childNodes].filter(node => node.nodeType === 3);
    original.forEach(node => node.remove());
    label.prepend(name);
    input.placeholder = '—'; input.enterKeyHint = next ? 'next' : 'done';
    input.setAttribute('aria-describedby', 'pupil-hint pupil-error');
    input.addEventListener('focus', () => { diagram.dataset.active = side; }, {signal: listeners.signal});
    input.addEventListener('blur', () => { delete diagram.dataset.active; }, {signal: listeners.signal});
    input.addEventListener('input', update, {signal: listeners.signal});
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); if (input.validity.valid && input.value !== '') next ? next.focus() : input.blur(); }
    }, {signal: listeners.signal});
    group.append(label);
  }
  body.append(diagram, group, hint, error);
  update();
  return () => {
    listeners.abort();
    for (const [input, text] of [[left, 'Left pupil distance '], [right, 'Right pupil distance ']]) {
      const label = input.closest('label');
      label.querySelector('.pupil-field-name')?.remove(); label.prepend(document.createTextNode(text));
      delete label.dataset.pupil;
      input.removeAttribute('aria-describedby'); input.removeAttribute('aria-invalid'); input.removeAttribute('placeholder');
    }
  };
}
