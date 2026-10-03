"""Isolate SAM's lens context without altering pixels used for measurement."""

from dataclasses import dataclass
from itertools import combinations

import cv2
import numpy as np


@dataclass(frozen=True)
class LensCrop:
    image: np.ndarray
    box: tuple[int, int, int, int]
    origin: tuple[int, int]
    source_shape: tuple[int, int]
    sheet: np.ndarray | None = None


def detect_sheet(image: np.ndarray) -> np.ndarray | None:
    """Recognise the known white-centred square markers, conservatively.

    This is an exclusion cue for SAM, never a substitute for calibration.
    No grid or rim pixels are erased.
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    step = max(1, int(np.ceil(max(gray.shape) / 1100)))
    small = gray[::step, ::step]
    dark = cv2.erode(np.uint8(small < 110), np.ones((3, 3), np.uint8))
    _, _, stats, _ = cv2.connectedComponentsWithStats(dark, 8)
    candidates = []

    def sample(x, y):
        return gray[min(gray.shape[0] - 1, max(0, round(y))),
                    min(gray.shape[1] - 1, max(0, round(x)))]

    for x, y, w, h, area in stats[1:]:
        side = (w + h) / 2
        if not (4 <= side <= min(small.shape) * .14 and .65 <= w / h <= 1.55
                and area / (w * h) >= .42):
            continue
        cx, cy = (x + w / 2) * step, (y + h / 2) * step
        radius = max(1, min(side * step * .12, 3))
        if max(sample(cx + dx * radius, cy + dy * radius)
               for dx in (-1, 0, 1) for dy in (-1, 0, 1)) < 125:
            continue
        radius = max(1.5, side * step * .23)
        ring = sum(sample(cx + radius * np.cos(n * np.pi / 4),
                          cy + radius * np.sin(n * np.pi / 4)) < 125 for n in range(8))
        if ring >= 5:
            candidates.append((cx, cy, side * step, ring))
    # Bound combinatorial work on patterned scenes, and reject ambiguity.
    if len(candidates) > 12:
        return None
    pool = candidates
    best, best_score = None, .75
    second_score = float('inf')
    for group in combinations(pool, 4):
        points = np.array([p[:2] for p in group], np.float32)
        sizes = np.array([p[2] for p in group])
        if sizes.max() / sizes.min() > 1.9:
            continue
        center = points.mean(axis=0)
        points = points[np.argsort(np.arctan2(points[:, 1] - center[1], points[:, 0] - center[0]))]
        if not cv2.isContourConvex(points):
            continue
        edges = np.linalg.norm(np.roll(points, -1, axis=0) - points, axis=1)
        opposite = max(edges[0] / edges[2], edges[2] / edges[0],
                       edges[1] / edges[3], edges[3] / edges[1])
        if edges.min() < sizes.max() * 7 or edges.max() / edges.min() > 2.2 or opposite > 1.55:
            continue
        ratio = (edges[0] + edges[2]) / (edges[1] + edges[3])
        if ratio < 1:
            points = np.roll(points, -1, axis=0)
            edges = np.roll(edges, -1)
            ratio = 1 / ratio
        if not (1.18 <= ratio <= 1.85 and 9 <= (edges[0] + edges[2]) / (2 * sizes.mean()) <= 27
                and 6 <= (edges[1] + edges[3]) / (2 * sizes.mean()) <= 20):
            continue
        score = abs(np.log(ratio / (100 / 70))) * 2 + np.log(opposite) + np.log(sizes.max() / sizes.min())
        score += sum((8 - p[3]) * .03 for p in group)
        if score < best_score:
            second_score = best_score if best is not None else second_score
            best, best_score = points, score
        else:
            second_score = min(second_score, score)
    return best if second_score - best_score > .05 else None


def isolate_lens(image: np.ndarray, box: tuple[int, int, int, int]) -> LensCrop:
    """Exclude page text and markers outside a padded prompt, at native scale.

    Grid lines through a transparent lens are retained: deleting those lines
    can erase the rim at intersections. Calibration always uses the raw photo.
    """
    h, w = image.shape[:2]
    x0, y0, x1, y1 = box
    if not (0 <= x0 < x1 <= w and 0 <= y0 < y1 <= h):
        raise ValueError('Lens target must be inside the image')
    sheet = detect_sheet(image)
    center = ((x0 + x1) / 2, (y0 + y1) / 2)
    if sheet is not None and cv2.pointPolygonTest(sheet, center, False) >= 0:
        # A broad default target can include the whole grid. Bound only the SAM
        # prompt; padded original context still allows the full rim to emerge.
        span = np.ptp(sheet, axis=0)
        half_width = min((x1 - x0) / 2, float(span[0]) * .35)
        half_height = min((y1 - y0) / 2, float(span[1]) * .39)
        x0, x1 = max(0, round(center[0] - half_width)), min(w, round(center[0] + half_width))
        y0, y1 = max(0, round(center[1] - half_height)), min(h, round(center[1] + half_height))
    pad = max(8, round(max(x1 - x0, y1 - y0) * 0.18))
    left, top = max(0, x0 - pad), max(0, y0 - pad)
    right, bottom = min(w, x1 + pad), min(h, y1 + pad)
    return LensCrop(image[top:bottom, left:right].copy(),
                    (x0 - left, y0 - top, x1 - left, y1 - top),
                    (left, top), (h, w), sheet)


def restore_lens_mask(mask: np.ndarray, crop: LensCrop) -> np.ndarray:
    """Keep the component at the target; reject truncated predictions.

    Mapping is integer translation only. Cropping or clipping a predicted
    boundary would manufacture an edge, so boundary contact fails explicitly.
    """
    if mask.shape != crop.image.shape[:2]:
        raise ValueError('Predictor returned an incorrect lens crop size')
    binary = np.uint8(mask > 0) * 255
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    x0, y0, x1, y1 = crop.box
    center = ((x0 + x1) / 2, (y0 + y1) / 2)
    candidates = [c for c in contours if cv2.contourArea(c) >= 16 and
                  cv2.pointPolygonTest(c, center, False) >= 0]
    if not candidates:
        raise ValueError('No closed lens edge at the target. Center the lens and retry.')
    chosen = max(candidates, key=cv2.contourArea)
    hull_area = cv2.contourArea(cv2.convexHull(chosen))
    if hull_area and cv2.contourArea(chosen) / hull_area < .9:
        raise ValueError('The lens edge includes an irregular background region. Center the lens and retry.')
    if crop.sheet is not None and cv2.contourArea(chosen) >= .8 * cv2.contourArea(crop.sheet):
        raise ValueError('The printed sheet was selected. Center the lens and retry.')
    x, y, w, h = cv2.boundingRect(chosen)
    ch, cw = binary.shape
    if x <= 1 or y <= 1 or x + w >= cw - 1 or y + h >= ch - 1:
        raise ValueError('Lens edge reaches the capture boundary. Move back slightly and retry.')
    restored = np.zeros(crop.source_shape, dtype=np.uint8)
    offset = np.array(crop.origin, dtype=np.int32)
    cv2.drawContours(restored, [chosen + offset], -1, 255, cv2.FILLED)
    return restored


def restore_best_lens_mask(masks: np.ndarray, scores: np.ndarray, crop: LensCrop) -> np.ndarray:
    failure = None
    for index in np.argsort(scores)[::-1]:
        try:
            return restore_lens_mask(masks[index], crop)
        except ValueError as error:
            failure = error
    raise ValueError(str(failure or 'No lens edge found at the target'))
