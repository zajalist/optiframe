const sub = (a, b) => a.map((v, i) => v - b[i]);
const length = a => Math.hypot(...a);
const unit = a => a.map(v => v / length(a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const middle = (a, b) => a.map((v, i) => (v + b[i]) / 2);
const finitePoint = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);

// Same centre crop as object-fit: cover. Rendering and video are mirrored together.
export function landmarkToView(p, videoWidth, videoHeight, width, height) {
  const scale = Math.max(width / videoWidth, height / videoHeight);
  return [(p.x - .5) * videoWidth * scale, (.5 - p.y) * videoHeight * scale, -p.z * videoWidth * scale];
}

export function opticalAnchors(assembly, leftPd, rightPd) {
  const centres = assembly.opticalCentres || [[-Number(leftPd), 0, 2.15], [Number(rightPd), 0, 2.15]];
  if (centres.length !== 2 || !centres.every(finitePoint)) throw new Error('Frame optical centres are missing. Rebuild the preview.');
  // CAD wearer-left is -X; selfie face coordinates use +X for that eye.
  // Keep depth: the actual temples extend behind the front along negative Z.
  const [left, right] = centres.map(([x, y, z]) => [-x, y, z]);
  const distance = length(sub(left, right));
  if (distance < 30 || distance > 90) throw new Error('Frame pupil distances are invalid.');
  return { left, right, centre: middle(left, right), distance };
}

export function basisAlongEyes(left, right, up) {
  const x = unit(sub(left, right));
  const z0 = cross(x, up);
  if (length(z0) < .001) return null;
  const z = unit(z0), y = unit(cross(z, x));
  return [x, y, z];
}

export function facePose(landmarks, anchors, dimensions) {
  if (!landmarks || landmarks.length < 478 || !dimensions.every(v => Number.isFinite(v) && v > 0)) return null;
  const point = index => landmarkToView(landmarks[index], ...dimensions);
  const left = point(473), right = point(468), forehead = point(10), nose = point(168);
  if (![left, right, forehead, nose].every(finitePoint)) return null;
  const distance = length(sub(left, right));
  if (distance < 24 || distance > Math.max(dimensions[2], dimensions[3]) * .9) return null;
  const targetBasis = basisAlongEyes(left, right, sub(forehead, nose));
  const sourceBasis = basisAlongEyes(anchors.left, anchors.right, [0, 1, 0]);
  if (!targetBasis || !sourceBasis || targetBasis[2][2] < .45) return null;
  return { centre: middle(left, right), scale: distance / anchors.distance, targetBasis, sourceBasis };
}
