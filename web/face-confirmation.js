const sources = ['browser-iris-estimate', 'arkit-eye-transform-estimate'];
export function confirmedFaceValues(value) {
  if (!value || value.confirmed !== true || !sources.includes(value.source) ||
      ![value.left, value.right].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 20 && v <= 40)) return null;
  return {left:value.left, right:value.right, source:value.source, confirmed:true};
}
export function saveConfirmedFace(values, storage = sessionStorage) {
  const confirmed = confirmedFaceValues({...values, confirmed:true});
  if (!confirmed) throw new Error('Review each pupil estimate between 20 and 40 mm.');
  storage.setItem('optiframe-face-estimate', JSON.stringify(confirmed));
  return confirmed;
}
export function loadConfirmedFace(storage = sessionStorage) {
  try { return confirmedFaceValues(JSON.parse(storage.getItem('optiframe-face-estimate') || 'null')); }
  catch { return null; }
}
