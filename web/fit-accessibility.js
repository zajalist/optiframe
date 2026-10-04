// Keyboard placement is a provisional starting point, never a provider mark.
export function initializeMark(panel, mode) {
  const key = mode === 'optical' ? 'opticalCentre' : 'topMark';
  if (panel[key]) return panel[key];
  const xs = panel.points.map(point => point[0]), ys = panel.points.map(point => point[1]);
  if (!xs.length || ![...xs, ...ys].every(Number.isFinite)) return null;
  panel[key] = [(Math.min(...xs) + Math.max(...xs)) / 2,
    mode === 'optical' ? (Math.min(...ys) + Math.max(...ys)) / 2 : Math.min(...ys)];
  panel.illustrativeAlignment = 'marking';
  panel.markReview ||= {};
  panel.markReview[mode] = false;
  return panel[key];
}

export function numericError(input) {
  const value = input.value.trim();
  if (!value || input.validity.badInput || !Number.isFinite(Number(value))) return 'Enter a measurement in millimetres.';
  if (input.validity.rangeUnderflow || input.validity.rangeOverflow)
    return input.max ? `Enter a value from ${input.min} to ${input.max} mm.` : `Enter a value of at least ${input.min} mm.`;
  if (input.validity.stepMismatch) return `Use increments of ${input.step} mm.`;
  return '';
}

export function moveMark(panel, mode, dx, dy, step = 1) {
  const key = mode === 'optical' ? 'opticalCentre' : 'topMark';
  if (!panel[key]) return false;
  panel[key] = [Math.max(0, Math.min(panel.canvas.width, panel[key][0] + dx * step)),
    Math.max(0, Math.min(panel.canvas.height, panel[key][1] + dy * step))];
  return true;
}

export function mountNumericFeedback(inputs) {
  const abort = new AbortController();
  const entries = inputs.map(input => {
    const previous = input.getAttribute('aria-describedby');
    const error = document.createElement('span');
    error.id = `${input.id}-error`; error.className = 'fit-field-error';
    error.setAttribute('aria-live', 'polite');
    input.closest('label').append(error);
    input.setAttribute('aria-describedby', [previous, error.id].filter(Boolean).join(' '));
    const update = () => { const text = numericError(input); error.textContent = text; input.setAttribute('aria-invalid', String(Boolean(text))); };
    input.addEventListener('input', update, {signal: abort.signal});
    input.addEventListener('change', update, {signal: abort.signal});
    update();
    return {input, error, previous};
  });
  return () => {
    abort.abort();
    for (const {input, error, previous} of entries) {
      error.remove(); input.removeAttribute('aria-invalid');
      previous === null ? input.removeAttribute('aria-describedby') : input.setAttribute('aria-describedby', previous);
    }
  };
}
