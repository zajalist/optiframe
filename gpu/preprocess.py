"""Isolate SAM's lens context without altering pixels used for measurement."""

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class LensCrop:
    image: np.ndarray
    box: tuple[int, int, int, int]
    origin: tuple[int, int]
    source_shape: tuple[int, int]


def isolate_lens(image: np.ndarray, box: tuple[int, int, int, int]) -> LensCrop:
    """Exclude page text and markers outside a padded prompt, at native scale.

    Grid lines through a transparent lens are retained: deleting those lines
    can erase the rim at intersections. Calibration always uses the raw photo.
    """
    h, w = image.shape[:2]
    x0, y0, x1, y1 = box
    if not (0 <= x0 < x1 <= w and 0 <= y0 < y1 <= h):
        raise ValueError('Lens target must be inside the image')
    pad = max(8, round(max(x1 - x0, y1 - y0) * 0.18))
    left, top = max(0, x0 - pad), max(0, y0 - pad)
    right, bottom = min(w, x1 + pad), min(h, y1 + pad)
    return LensCrop(image[top:bottom, left:right].copy(),
                    (x0 - left, y0 - top, x1 - left, y1 - top),
                    (left, top), (h, w))


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
