"""Conservative image evidence for a SAM proposal, not a lens classifier.

SAM can confidently outline blank paper or a grid cell. Auto capture therefore
requires a closed, non-rectangular proposal with a visible boundary distributed
around its perimeter. The test never moves or manufactures measurement points.
"""

import cv2
import numpy as np


def absent(reason="no-closed-edge"):
    return {"detected": False, "reason": reason, "evidence": {}}


def lens_presence(image, contour):
    if len(contour) < 5:
        return absent("no-closed-edge")
    points = np.asarray(contour, np.float32).reshape(-1, 2)
    if not np.isfinite(points).all():
        return absent("no-closed-edge")
    area = abs(cv2.contourArea(points))
    perimeter = cv2.arcLength(points, True)
    hull = cv2.contourArea(cv2.convexHull(points))
    polygon = cv2.approxPolyDP(points, .012 * perimeter, True)
    x, y, width, height = cv2.boundingRect(points)
    evidence = {"shapeVertices": len(polygon), "solidity": round(area / max(hull, 1), 3)}
    # An isolated cell, page rectangle or text fragment is not a supported lens.
    if (area < 200 or min(width, height) < 24 or max(width, height) / min(width, height) > 2.5
            or len(polygon) < 6 or area / max(hull, 1) < .9):
        return {"detected": False, "reason": "background-shape", "evidence": evidence}
    # Work locally at a bounded resolution. Normal-direction gradients reject
    # most grid crossings: a crossing is not evidence for a continuous rim.
    pad = 12
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1, y1 = min(image.shape[1], x + width + pad), min(image.shape[0], y + height + pad)
    scale = min(1., 420 / max(x1 - x0, y1 - y0))
    roi = image[y0:y1, x0:x1]
    if scale < 1:
        roi = cv2.resize(roi, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    gray = cv2.GaussianBlur(cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY), (3, 3), .7)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3) / 8
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3) / 8
    local = (points - [x0, y0]) * scale
    closed = np.vstack([local, local[:1]])
    cumulative = np.r_[0, np.cumsum(np.linalg.norm(np.diff(closed, axis=0), axis=1))]
    distances = np.linspace(0, cumulative[-1], 256, endpoint=False)
    sampled = np.column_stack([np.interp(distances, cumulative, closed[:, axis]) for axis in (0, 1)])
    tangent = np.roll(sampled, -3, axis=0) - np.roll(sampled, 3, axis=0)
    normal = np.column_stack([-tangent[:, 1], tangent[:, 0]])
    normal /= np.maximum(np.linalg.norm(normal, axis=1)[:, None], 1e-6)
    support = np.zeros(256, bool)
    for offset in np.linspace(-3, 3, 7):
        sample = sampled + normal * offset
        mx = sample[:, 0].astype(np.float32).reshape(1, -1)
        my = sample[:, 1].astype(np.float32).reshape(1, -1)
        dx = cv2.remap(gx, mx, my, cv2.INTER_LINEAR).ravel()
        dy = cv2.remap(gy, mx, my, cv2.INTER_LINEAR).ravel()
        strength = np.hypot(dx, dy)
        aligned = np.abs(dx * normal[:, 0] + dy * normal[:, 1])
        support |= (strength >= 4.) & (aligned >= strength * .72)
    fraction = float(support.mean())
    sectors = int(np.count_nonzero(support.reshape(8, 32).mean(axis=1) >= .45))
    evidence.update(edgeSupport=round(fraction, 3), sectorsSupported=sectors)
    detected = fraction >= .64 and sectors >= 7
    return {"detected": detected, "reason": "edge-supported" if detected else "insufficient-edge-evidence",
            "evidence": evidence}
