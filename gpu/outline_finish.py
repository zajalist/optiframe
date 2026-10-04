"""Small, bounded CAD boundary finishing; this does not improve measurement accuracy.

The measured polygon is never repaired or rescaled. Periodic arc-length filtering
reduces pixel stair steps before extrusion, with a certified 0.08 mm maximum
boundary displacement. Unsafe candidates leave the original polygon unchanged.
"""
from __future__ import annotations

import math

import numpy as np
from scipy.ndimage import gaussian_filter1d
import shapely
from shapely.geometry import LineString, Polygon
from shapely.strtree import STRtree

MAX_BOUNDARY_SHIFT_MM = 0.08
MAX_DIMENSION_SHIFT_MM = 0.1
MIN_NONLOCAL_CLEARANCE_MM = 0.2
_CERTIFICATE_SPACING_MM = 0.04
_RESAMPLE_SPACING_MM = 0.12


def _check_clearance(polygon: Polygon) -> None:
    """Reject narrow features before filtering, ignoring adjacent dense samples."""
    if polygon.minimum_clearance >= MIN_NONLOCAL_CLEARANCE_MM:
        return
    coords = np.asarray(polygon.exterior.coords)
    lengths = np.linalg.norm(np.diff(coords, axis=0), axis=1)
    arc = np.r_[0.0, np.cumsum(lengths)]
    segments = [LineString(coords[i:i + 2]) for i in range(len(lengths))]
    tree = STRtree(segments)
    for i, segment in enumerate(segments):
        for j in tree.query(segment, predicate="dwithin", distance=MIN_NONLOCAL_CLEARANCE_MM):
            if j <= i:
                continue
            gap = min(arc[j] - arc[i + 1], arc[-1] - (arc[j + 1] - arc[i]))
            if gap > 0.5 and segment.distance(segments[j]) < MIN_NONLOCAL_CLEARANCE_MM:
                raise ValueError("Lens outline has a narrow or nearly crossed section")


def _uniform_samples(polygon: Polygon) -> np.ndarray:
    coords = np.asarray(polygon.exterior.coords)
    lengths = np.linalg.norm(np.diff(coords, axis=0), axis=1)
    # Duplicate samples carry no geometric information and break interpolation.
    coords = coords[:-1][lengths > 1e-12]
    closed = np.vstack([coords, coords[0]])
    arc = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(closed, axis=0), axis=1))]
    count = max(64, min(3000, math.ceil(arc[-1] / _RESAMPLE_SPACING_MM)))
    at = np.linspace(0, arc[-1], count, endpoint=False)
    return np.column_stack([np.interp(at, arc, closed[:, axis]) for axis in range(2)])


def boundary_distance_upper_bound(first: Polygon, second: Polygon) -> float:
    """Upper bound on continuous symmetric Hausdorff distance in millimetres.

    Distance to a closed set is 1-Lipschitz. Every point along each subdivided
    segment is within half its length of a tested endpoint. Adding this margin
    bounds untested segment interiors too; vertex-only Hausdorff is insufficient.
    """
    upper = 0.0
    for source, target in ((first, second), (second, first)):
        coords = np.asarray(source.exterior.segmentize(_CERTIFICATE_SPACING_MM).coords)
        distances = shapely.distance(shapely.points(coords), target.exterior)
        margin = np.linalg.norm(np.diff(coords, axis=0), axis=1).max() / 2
        upper = max(upper, float(distances.max() + margin))
    return upper


def finish_outline(polygon: Polygon) -> Polygon:
    """Return a smooth printable boundary only when all geometric limits hold.

    Width/height change is limited to 0.1 mm, area change to 0.5%, and nonlocal
    separation remains >=0.2 mm. Invalid/self-crossing or pinched input raises;
    filtering cannot silently heal it. Returns the input object if no bounded
    candidate is possible. Call on the original measured polygon, before any
    independent simplification, so tolerance budgets cannot accumulate.
    """
    if (not isinstance(polygon, Polygon) or polygon.is_empty or
            len(polygon.interiors) or not polygon.is_valid or polygon.area <= 0 or
            not np.isfinite(np.asarray(polygon.exterior.coords)).all()):
        raise ValueError("Outline finishing requires a valid simple closed polygon")
    _check_clearance(polygon)
    points = _uniform_samples(polygon)
    spacing = polygon.length / len(points)
    original_size = np.subtract(polygon.bounds[2:], polygon.bounds[:2])
    for sigma_mm in (0.5, 0.3, 0.18, 0.1, 0.06):
        smooth = gaussian_filter1d(points, sigma_mm / spacing, axis=0, mode="wrap")
        # Remove numerically redundant chords before CAD booleans/STL float32
        # serialization. Certification below includes this in the SAME budget.
        candidate = Polygon(smooth).simplify(0.003, preserve_topology=True)
        if not candidate.is_valid or candidate.exterior.is_ccw != polygon.exterior.is_ccw:
            continue
        size = np.subtract(candidate.bounds[2:], candidate.bounds[:2])
        if (np.max(np.abs(size - original_size)) > MAX_DIMENSION_SHIFT_MM or
                abs(candidate.area / polygon.area - 1) > 0.005):
            continue
        # Cheap rejection precedes the continuous-boundary certificate.
        if polygon.exterior.hausdorff_distance(candidate.exterior) > MAX_BOUNDARY_SHIFT_MM:
            continue
        if boundary_distance_upper_bound(polygon, candidate) > MAX_BOUNDARY_SHIFT_MM:
            continue
        try:
            _check_clearance(candidate)
        except ValueError:
            continue
        return candidate
    return polygon
