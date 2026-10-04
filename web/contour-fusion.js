// All coordinates are already rectified into the same capture-sheet millimetres.
// Never align individual contours: doing so would hide lens movement or bad calibration.
const RAYS = 360;
const MAX_SMOOTHING_MM = 0.12;
const MAX_RESAMPLING_MM = 0.12;
const MAX_DIMENSION_CHANGE_MM = 0.2;
const P95_LIMIT_MM = 0.6;
const MAX_LIMIT_MM = 1;
const TAU = Math.PI * 2;

function fail(message) {
  const error = new Error(message);
  error.code = 'CONTOUR_FUSION_UNSTABLE';
  throw error;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * sorted.length) - 1];
}

function dimensions(points) {
  return [0, 1].map(axis => {
    const values = points.map(point => point[axis]);
    return Math.max(...values) - Math.min(...values);
  });
}

function polygon(points) {
  if (!Array.isArray(points) || points.length < 8 || points.length > 4096 ||
      !points.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite))) return null;
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const cross = a[0] * b[1] - b[0] * a[1];
    area += cross;
    cx += (a[0] + b[0]) * cross;
    cy += (a[1] + b[1]) * cross;
  }
  const size = dimensions(points);
  if (Math.abs(area) < 1 || size.some(value => value < 1 || value > 150)) return null;
  return {points, center: [cx / (3 * area), cy / (3 * area)]};
}

function radiiAt(points, origin) {
  // A lens outline must be star-shaped about the common origin. Check angular
  // winding as well as intersections so folds between adjacent rays cannot hide.
  const relative = points.map(p => [p[0] - origin[0], p[1] - origin[1]]);
  let winding = 0, direction = 0;
  for (let i = 0; i < relative.length; i++) {
    const a = relative[i], b = relative[(i + 1) % relative.length];
    if (Math.hypot(...a) < 0.01) return null;
    const angle = Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);
    if (Math.abs(angle) < 1e-10) continue;
    if (direction && Math.sign(angle) !== direction) return null;
    direction = Math.sign(angle);
    winding += angle;
  }
  if (Math.abs(Math.abs(winding) - TAU) > 1e-5) return null;
  const radii = [];
  for (let ray = 0; ray < RAYS; ray++) {
    const angle = ray * TAU / RAYS, dx = Math.cos(angle), dy = Math.sin(angle);
    const hits = [];
    for (let i = 0; i < relative.length; i++) {
      const a = relative[i], b = relative[(i + 1) % relative.length];
      const ex = b[0] - a[0], ey = b[1] - a[1], denominator = dx * ey - dy * ex;
      if (Math.abs(denominator) < 1e-10) continue;
      const radius = (a[0] * ey - a[1] * ex) / denominator;
      const along = (a[0] * dy - a[1] * dx) / denominator;
      if (radius > 0 && along >= -1e-9 && along <= 1 + 1e-9 &&
          !hits.some(value => Math.abs(value - radius) < 1e-6)) hits.push(radius);
    }
    if (hits.length !== 1) return null;
    radii.push(hits[0]);
  }
  return radii;
}

function toPoints(radii, origin) {
  return radii.map((radius, i) => {
    const angle = i * TAU / RAYS;
    return [origin[0] + radius * Math.cos(angle), origin[1] + radius * Math.sin(angle)];
  });
}

function resamplingError(points, sampled) {
  // A narrow spike can fall entirely between angular rays. Check the original
  // vertices so resampling cannot silently remove a feature before denoising.
  let maximumSquared = 0;
  for (const point of points) {
    let nearestSquared = Infinity;
    for (let i = 0; i < sampled.length; i++) {
      const a = sampled[i], b = sampled[(i + 1) % sampled.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared ? Math.max(0, Math.min(1,
        ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared)) : 0;
      nearestSquared = Math.min(nearestSquared,
        (point[0] - a[0] - t * dx) ** 2 + (point[1] - a[1] - t * dy) ** 2);
    }
    maximumSquared = Math.max(maximumSquared, nearestSquared);
  }
  return Math.sqrt(maximumSquared);
}

function smooth(radii, origin) {
  // A short symmetric filter removes pixel stair steps. Cap every radial move
  // in millimetres; corners are never replaced with an ellipse or convex hull.
  const weights = [1, 4, 6, 4, 1];
  const shifts = radii.map((value, i) => {
    const average = weights.reduce((sum, weight, offset) =>
      sum + weight * radii[(i + offset - 2 + RAYS) % RAYS], 0) / 16;
    return Math.max(-MAX_SMOOTHING_MM, Math.min(MAX_SMOOTHING_MM, average - value));
  });
  const before = dimensions(toPoints(radii, origin));
  let scale = 1, contour, changes;
  // Scaling smoothing (not the contour) preserves the measured shape's size.
  for (let attempt = 0; attempt < 12; attempt++) {
    contour = toPoints(radii.map((r, i) => r + shifts[i] * scale), origin);
    changes = dimensions(contour).map((size, axis) => size - before[axis]);
    if (changes.every(value => Math.abs(value) <= MAX_DIMENSION_CHANGE_MM + 1e-9)) break;
    scale *= 0.5;
  }
  return {contour, maxSmoothingMm: Math.max(...shifts.map(value => Math.abs(value * scale))),
    widthChangeMm: changes[0], heightChangeMm: changes[1]};
}

/** Fuse distinct observations in a fixed sheet coordinate system; throws on disagreement. */
export function fuseContours(samples, {minFrames = 3} = {}) {
  if (!Number.isInteger(minFrames) || minFrames < 3 || !Array.isArray(samples) || samples.length > 64)
    fail('Invalid contour observations.');
  const ids = new Set(), valid = [];
  samples.forEach((sample, index) => {
    const id = sample?.id ?? index;
    if (ids.has(id)) return;
    ids.add(id);
    const parsed = polygon(sample?.contour);
    if (parsed) valid.push({...parsed, id, index});
  });
  if (valid.length < minFrames) fail('Need more clear lens frames.');
  const origin = [0, 1].map(axis => median(valid.map(frame => frame.center[axis])));
  const frames = valid.flatMap(frame => {
    const radii = radiiAt(frame.points, origin);
    if (!radii) return [];
    const resamplingMm = resamplingError(frame.points, toPoints(radii, origin));
    return resamplingMm <= MAX_RESAMPLING_MM ? [{...frame, radii, resamplingMm}] : [];
  });
  if (frames.length < minFrames) fail('Lens outlines are not consistent.');
  const agreement = frames.map(a => frames.map(b => {
    const differences = a.radii.map((r, i) => Math.abs(r - b.radii[i]));
    const p95 = percentile(differences, 0.95), maximum = Math.max(...differences);
    return {p95, maximum, pass: p95 <= P95_LIMIT_MM && maximum <= MAX_LIMIT_MM};
  }));
  // Find a mutually agreeing majority. A second moving lens cannot be aligned
  // into the first one, and two equally sized competing groups are ambiguous.
  let selected = [], bestSpread = Infinity;
  for (let seed = 0; seed < frames.length; seed++) {
    const candidates = frames.map((_, i) => i).filter(i => i !== seed && agreement[seed][i].pass)
      .sort((a, b) => agreement[seed][a].p95 - agreement[seed][b].p95);
    const group = [seed];
    for (const i of candidates) if (group.every(j => agreement[i][j].pass)) group.push(i);
    const spread = Math.max(...group.flatMap(i => group.map(j => agreement[i][j].p95)));
    if (group.length > selected.length || (group.length === selected.length && spread < bestSpread)) {
      selected = group; bestSpread = spread;
    }
  }
  if (selected.length < minFrames || selected.length <= frames.length / 2)
    fail('Lens moved or its edges disagree. Capture again.');
  const accepted = selected.map(i => frames[i]);
  const fused = Array.from({length: RAYS}, (_, ray) => median(accepted.map(frame => frame.radii[ray])));
  const result = smooth(fused, origin);
  // Repeated frames cannot remove a persistent shadow spur. Flag a narrow
  // radial impulse surviving bounded smoothing instead of inventing an edge
  // across it. The wider median is diagnostic only and never edits the outline.
  const smoothedRadii = result.contour.map(p => Math.hypot(p[0] - origin[0], p[1] - origin[1]));
  const maxUnresolvedRoughnessMm = Math.max(...smoothedRadii.map((radius, i) =>
    Math.abs(radius - median(Array.from({length: 9}, (_, offset) =>
      smoothedRadii[(i + offset - 4 + RAYS) % RAYS])))));
  if (maxUnresolvedRoughnessMm > 0.5) fail('Lens edge has a persistent spike. Adjust the light and capture again.');
  const acceptedIndices = new Set(accepted.map(frame => frame.index));
  const residuals = accepted.flatMap(frame => frame.radii.map((radius, i) => Math.abs(radius - fused[i])));
  return {contour: result.contour, diagnostics: {
    method: 'rectified-radial-median', acceptedFrames: accepted.length,
    rejectedFrames: samples.length - accepted.length, acceptedIds: accepted.map(frame => frame.id),
    rejectedIds: samples.flatMap((frame, i) => acceptedIndices.has(i) ? [] : [frame?.id ?? i]),
    maxSmoothingMm: result.maxSmoothingMm, widthChangeMm: result.widthChangeMm,
    maxResamplingMm: Math.max(...accepted.map(frame => frame.resamplingMm)),
    heightChangeMm: result.heightChangeMm, spreadMm: percentile(residuals, 0.95),
    maxSpreadMm: Math.max(...residuals), pairwiseSpreadMm: bestSpread,
    maxUnresolvedRoughnessMm,
    origin, rays: RAYS,
  }};
}
