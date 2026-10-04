"""Image-supported contour refinement; a proposal, not a metric accuracy claim.

The local search requires an existing near-convex lens mask. Long printed lines
are suppressed only in the edge-scoring image; the original photo is preserved.
"""
from __future__ import annotations

import cv2
import numpy as np


def _smooth_periodic(values, sigma):
    radius = int(np.ceil(3 * sigma))
    kernel = np.exp(-np.arange(-radius, radius + 1, dtype=float) ** 2 / (2 * sigma ** 2))
    kernel /= kernel.sum()
    return sum(weight * np.roll(values, shift, axis=0)
               for weight, shift in zip(kernel, range(-radius, radius + 1)))


def _distance_to_loop(points, loop):
    ends = np.roll(loop, -1, axis=0)
    vectors = ends-loop
    lengths = np.sum(vectors*vectors, axis=1)
    fractions = np.sum((points[:, None]-loop[None, :])*vectors[None, :], axis=2)/np.maximum(lengths, 1e-12)
    nearest = loop[None, :]+np.clip(fractions, 0, 1)[..., None]*vectors[None, :]
    return np.linalg.norm(points[:, None]-nearest, axis=2).min(axis=1)


def refine_lens_edge(image_rgb, contour, max_shift_px=12.0):
    """Return (contour, diagnostics), retaining input on unsupported proposals.

    max_shift_px bounds search relative to the denoised initial radial contour,
    NOT absolute measurement error or Hausdorff distance from the raw mask.
    Caller must retain raw results and apply calibration/multiframe checks.
    """
    raw = np.asarray(contour, dtype=np.float32)
    unchanged = raw.tolist()
    def reject(reason):
        return unchanged, {'accepted': False, 'reason': reason}
    if raw.ndim != 2 or raw.shape[1:] != (2,) or len(raw) < 16 or not np.isfinite(raw).all():
        return reject('invalid-contour')
    area = abs(cv2.contourArea(raw))
    hull = abs(cv2.contourArea(cv2.convexHull(raw)))
    if area < 100 or hull <= 0 or area / hull < .85:
        return reject('unsupported-shape')
    image = np.asarray(image_rgb, dtype=np.uint8)
    if image.ndim != 3 or image.shape[2] != 3:
        return reject('invalid-image')
    # Crop bounds CPU work and excludes surrounding text from line detection.
    margin = int(np.ceil(max_shift_px)) + 20
    lo = np.maximum(np.floor(raw.min(axis=0)).astype(int)-margin, [0, 0])
    hi = np.minimum(np.ceil(raw.max(axis=0)).astype(int)+margin+1, [image.shape[1], image.shape[0]])
    if np.any(hi <= lo):
        return reject('outside-image')
    local = raw - lo
    gray = cv2.cvtColor(image[lo[1]:hi[1], lo[0]:hi[0]], cv2.COLOR_RGB2GRAY)
    span = np.ptp(local, axis=0)
    if min(span) < 40:
        return reject('too-small')
    # A grid line spans much farther than one local curve segment.
    length = max(35, int(min(span) * .4))
    ink = cv2.subtract(cv2.GaussianBlur(gray, (0, 0), 7), gray)
    grid = np.zeros_like(gray)
    signed = gray.astype(np.int16)
    thin_horizontal = (np.roll(signed, 3, axis=0)-signed > 3) & (np.roll(signed, -3, axis=0)-signed > 3)
    thin_vertical = (np.roll(signed, 3, axis=1)-signed > 3) & (np.roll(signed, -3, axis=1)-signed > 3)
    for shape in [(length, 1), (1, length)]:
        grid = np.maximum(grid, cv2.morphologyEx(ink, cv2.MORPH_OPEN, np.ones(shape, np.uint8)))
    # Both sides must brighten: a dark filled lens rim is a step, not a grid line.
    grid = cv2.dilate(((grid > 4) & (thin_horizontal | thin_vertical)).astype(np.uint8), np.ones((3, 3), np.uint8))
    scoring = cv2.inpaint(gray, grid, 3, cv2.INPAINT_TELEA).astype(np.float32) / 255
    scoring = cv2.GaussianBlur(scoring, (0, 0), .8)
    gx = cv2.Scharr(scoring, cv2.CV_32F, 1, 0) / 32
    gy = cv2.Scharr(scoring, cv2.CV_32F, 0, 1) / 32
    centre = local.mean(axis=0)
    count = 256
    angles = np.arange(count) * 2 * np.pi / count
    theta = np.arctan2(local[:, 1]-centre[1], local[:, 0]-centre[0]) % (2*np.pi)
    radii = np.linalg.norm(local-centre, axis=1)
    order = np.argsort(theta)
    base = _smooth_periodic(np.interp(angles, theta[order], radii[order], period=2*np.pi), 3)
    offsets = np.arange(-max_shift_px, max_shift_px+.01, .5)
    rr = base[:, None] + offsets
    xx = (centre[0]+rr*np.cos(angles[:, None])).astype(np.float32)
    yy = (centre[1]+rr*np.sin(angles[:, None])).astype(np.float32)
    edge = abs(cv2.remap(gx, xx, yy, cv2.INTER_LINEAR)*np.cos(angles[:, None])
               + cv2.remap(gy, xx, yy, cv2.INTER_LINEAR)*np.sin(angles[:, None]))
    unary = -30*edge + .002*offsets**2
    pair = .3*(offsets[:, None]-offsets[None, :])**2
    cost = unary[0].copy()
    back = []
    for index in range(1, 3*count):
        candidates = cost[:, None]+pair
        parents = candidates.argmin(axis=0)
        back.append(parents)
        cost = candidates[parents, np.arange(len(offsets))]+unary[index % count]
    path = [int(cost.argmin())]
    for parents in back[::-1]:
        path.append(int(parents[path[-1]]))
    path = np.asarray(path[::-1])[count:2*count]
    rr = base+offsets[path]
    new = _smooth_periodic(np.column_stack([centre[0]+rr*np.cos(angles), centre[1]+rr*np.sin(angles)]), 1)
    # Inpainted pixels guide continuity but are never positive evidence.
    original = cv2.GaussianBlur(gray.astype(np.float32)/255, (0, 0), .8)
    ox = cv2.Scharr(original, cv2.CV_32F, 1, 0)/32
    oy = cv2.Scharr(original, cv2.CV_32F, 0, 1)/32
    nx = new[:, 0].astype(np.float32).reshape(-1, 1)
    ny = new[:, 1].astype(np.float32).reshape(-1, 1)
    support = abs(cv2.remap(ox, nx, ny, cv2.INTER_LINEAR).ravel()*np.cos(angles)
                  + cv2.remap(oy, nx, ny, cv2.INTER_LINEAR).ravel()*np.sin(angles))
    occluded = cv2.remap(grid, nx, ny, cv2.INTER_NEAREST).ravel() > 0
    original_profile = abs(cv2.remap(ox, xx, yy, cv2.INTER_LINEAR)*np.cos(angles[:, None])
                           + cv2.remap(oy, xx, yy, cv2.INTER_LINEAR)*np.sin(angles[:, None]))
    profile_masked = cv2.remap(grid, xx, yy, cv2.INTER_NEAREST) > 0
    separated = abs(offsets[None, :]-offsets[path, None]) >= 5
    competing = np.max(np.where(separated & ~profile_masked, original_profile, 0), axis=1)
    ambiguous_fraction = float(np.mean((competing >= np.maximum(.01, support*.8)) & ~occluded))
    if ambiguous_fraction > .35:
        return unchanged, {'accepted': False, 'reason': 'competing-edges',
                           'ambiguousEdgeFraction': ambiguous_fraction}
    evidence = (support >= .008) & ~occluded
    supported = sum(float(np.mean(sector)) >= .35 for sector in np.array_split(evidence, 8))
    visible = support[~occluded]
    if supported < 7 or len(visible) < count*.45 or float(np.median(visible)) < .01:
        return reject('weak-edge-evidence')
    if np.mean((path == 0) | (path == len(offsets)-1)) > .05:
        return reject('search-band-exhausted')
    new += lo
    to_raw = _distance_to_loop(new, raw)
    from_raw = _distance_to_loop(raw, new)
    diagnostics = {'accepted': True, 'supportedSectors': supported,
                   'ambiguousEdgeFraction': ambiguous_fraction,
                   'maskedFraction': float(np.mean(occluded)), 'edgeSupportFraction': float(np.mean(evidence)),
                   'maxCorrectionPx': float(max(to_raw.max(), from_raw.max())),
                   'meanCorrectionPx': float(to_raw.mean()), 'correctionMetric': 'sampled-point-to-segment',
                   'searchBandPx': float(max_shift_px), 'method': 'local-image-edge-dp'}
    return new.tolist(), diagnostics
