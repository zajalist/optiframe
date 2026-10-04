// Stability is a capture aid, not an accuracy certificate. All distances are
// in sheet millimetres, so camera movement cannot disguise an unstable edge.
export function createAutoCaptureGate({ durationMs = 1100, minFrames = 4, maxAgeMs = 2000,
  maxGapMs = 600, toleranceMm = 0.65 } = {}) {
  let baseline = null, previous = null, count = 0, fired = false, removal = false, absentSince = null, absentPrevious = null;
  const clearSpan = () => { baseline = null; previous = null; count = 0; };
  const validPoints = points => Array.isArray(points) && points.length >= 12 &&
    points.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));
  function boundaryDistance(a, b) {
    const directed = (source, target) => Math.max(...source.map(p => {
      let nearest = Infinity;
      for (let i = 0; i < target.length; i++) {
        const u = target[i], v = target[(i + 1) % target.length];
        const dx = v[0] - u[0], dy = v[1] - u[1];
        const t = Math.max(0, Math.min(1, ((p[0] - u[0]) * dx + (p[1] - u[1]) * dy) / (dx * dx + dy * dy || 1)));
        nearest = Math.min(nearest, Math.hypot(p[0] - u[0] - t * dx, p[1] - u[1] - t * dy));
      }
      return nearest;
    }));
    return Math.max(directed(a, b), directed(b, a));
  }
  return {
    reset({ requireRemoval = false } = {}) { clearSpan(); fired = false; removal = requireRemoval; absentSince = null; absentPrevious = null; },
    invalidate() { clearSpan(); absentSince = null; absentPrevious = null; },
    update(sample) {
      if (fired) return { capture: false, state: 'captured' };
      const { presence, quality, calibration, sampledAt, now, id, dragging, brightness } = sample;
      const fresh = Number.isFinite(now) && Number.isFinite(sampledAt) && now >= sampledAt && now - sampledAt <= maxAgeMs;
      const calibrated = calibration?.markers?.length === 4 && calibration.markers.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));
      if (removal) {
        // A tracked loss with the sheet still visible is required between sides.
        // Timeouts or missing calibration never count as removing the first lens.
        // An unsupported refinement or weak boundary can still be the first
        // lens. Only ordinary empty/background results prove its tracked loss.
        // Missing reason retains compatibility with older explicit-absence APIs.
        const absent = presence?.detected === false &&
          (presence.reason == null || ['no-closed-edge', 'background-shape'].includes(presence.reason));
        if (fresh && calibrated && absent && !dragging &&
            Number.isFinite(quality?.sharpness) && quality.sharpness >= 35 &&
            Number.isFinite(brightness) && brightness >= 45) {
          if (absentPrevious && (id === absentPrevious.id || sampledAt <= absentPrevious.sampledAt)) return { capture: false, state: 'remove' };
          if (absentPrevious && sampledAt - absentPrevious.now > maxGapMs) absentSince = null;
          absentSince ??= sampledAt;
          absentPrevious = sample;
          if (sampledAt - absentSince >= 450) { removal = false; absentSince = null; }
        } else { absentSince = null; absentPrevious = null; }
        clearSpan();
        return { capture: false, state: removal ? 'remove' : 'searching' };
      }
      const points = calibration?.contour;
      if (!fresh || !calibrated || presence?.detected !== true || dragging ||
          !Number.isFinite(quality?.score) || quality.score < 0.3 ||
          !Number.isFinite(quality?.sharpness) || quality.sharpness < 35 || !validPoints(points)) {
        const reason = !fresh ? 'stale' : !calibrated ? 'calibration' : presence?.detected !== true ? 'no-lens'
          : dragging ? 'adjusting' : !Number.isFinite(quality?.sharpness) || quality.sharpness < 35 ? 'blur'
          : !Number.isFinite(quality?.score) || quality.score < .3 ? 'quality' : 'outline';
        clearSpan(); return { capture: false, state: 'searching', reason, progress: 0 };
      }
      const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
      const width = Math.max(...xs) - Math.min(...xs), height = Math.max(...ys) - Math.min(...ys);
      const area = Math.abs(points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
      if (width < 20 || width > 92 || height < 15 || height > 65 || area < width * height * .3 ||
          area > width * height * .985 || Math.min(...xs) < 0 || Math.max(...xs) > 100 || Math.min(...ys) < 0 || Math.max(...ys) > 70) {
        clearSpan(); return { capture: false, state: 'searching', reason: 'outline', progress: 0 };
      }
      if (previous && (id === previous.id || sampledAt <= previous.sampledAt)) return { capture: false, state: 'steady' };
      const markerMotion = baseline ? Math.max(...calibration.markers.map((p, i) => Math.hypot(p[0] - baseline.calibration.markers[i][0], p[1] - baseline.calibration.markers[i][1]))) : 0;
      const markerSpan = Math.hypot(calibration.markers[1][0] - calibration.markers[0][0], calibration.markers[1][1] - calibration.markers[0][1]);
      // Inference is serial: its latency is not a gap in camera observations.
      // Bound frame age independently; only an idle gap after the previous reply resets stability.
      if (!baseline || sampledAt - previous.now > maxGapMs || markerMotion > markerSpan * .015 ||
          boundaryDistance(points, baseline.calibration.contour) > toleranceMm) {
        baseline = sample; count = 0;
      }
      previous = sample; count++;
      fired = count >= minFrames && sampledAt - baseline.sampledAt >= durationMs;
      const progress = Math.min(1, count / minFrames, (sampledAt - baseline.sampledAt) / durationMs);
      return { capture: fired, state: fired ? 'captured' : 'steady', progress };
    },
  };
}
