import { project } from './calibration.js';
// Native face coordinates are estimates; importing them never verifies a lens.
export function validateFaceFit(data) {
  const fail = message => { throw new Error(message); };
  if (data?.schemaVersion !== 1 || data.kind !== 'optiframe-face-fit' || data.units !== 'mm'
      || data.source !== 'arkit-eye-transform-estimate' || data.requiresProviderVerification !== true)
    fail('Use an OptiFrame face scan exported from the iPhone app.');
  const m = data.measurements, q = data.quality;
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  if (!m || ![m.leftMonocularEstimateMm, m.rightMonocularEstimateMm, m.totalEstimateMm].every(finite))
    fail('The face scan has missing measurements. Scan again.');
  const left = m.leftMonocularEstimateMm, right = m.rightMonocularEstimateMm;
  if ([left, right].some(v => v < 20 || v > 40) || Math.abs(left + right - m.totalEstimateMm) > 0.2)
    fail('The face measurements are inconsistent. Enter measured values instead.');
  if (!q || !Number.isInteger(q.sampleCount) || q.sampleCount < 21 || !finite(q.durationSeconds) || q.durationSeconds < 1.9
      || ![q.leftStdDevMm, q.rightStdDevMm].every(v => finite(v) && v >= 0 && v <= 0.4)
      || !['nominal', 'fair'].includes(q.thermalState))
    fail('This face scan is not stable enough. Scan again or enter measured values.');
  if (data.capability?.faceTrackingSupported !== true || typeof data.capability?.trueDepthAvailable !== 'boolean'
      || data.reference !== 'ARFaceAnchor local x=0; eye-transform origins, not clinical pupil centres')
    fail('This file does not contain a supported ARKit face estimate.');
  return { left, right, trueDepthAvailable: data.capability.trueDepthAvailable };
}

export function lensReady(panel) {
  return Boolean(panel?.bitmap && panel.homography && panel.points?.length >= 12 && !panel.photoLoading);
}

export function marksReady(panel) {
  const a = panel?.opticalCentre, b = panel?.topMark;
  if (!(a?.length === 2 && b?.length === 2 && [...a, ...b].every(Number.isFinite))) return false;
  try {
    const [pa,pb] = panel.homography ? [project(a,panel.homography),project(b,panel.homography)] : [a,b];
    return Math.hypot(pa[0]-pb[0],pa[1]-pb[1]) >= (panel.homography ? 5 : 2);
  } catch { return false; }
}
