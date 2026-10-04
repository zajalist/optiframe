"""Shallow OptiFrame temple engraving traced from the generated Higgsfield logo.

The engraving is real STL geometry. It stays clear of the hinge and leaves the
5 mm stem with at least 4.6 mm of material. No rendering texture is required.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np
import trimesh
from shapely.geometry import Polygon
from shapely.affinity import scale

LOGO_JOB = "6c18b470-6c55-4a60-a8f1-9a846307f09d"
ENGRAVING_DEPTH_MM = 0.4
LOGO_HEIGHT_MM = 2.6
LOGO_CENTRE_Z_MM = -26.5


@lru_cache(maxsize=1)
def logo_polygons() -> tuple[Polygon, ...]:
    data = json.loads((Path(__file__).parent / "branding" / "logo-paths.json").read_text())
    ratio = LOGO_HEIGHT_MM / data["height_mm"]
    polygons = tuple(scale(Polygon(rings[0], rings[1:]), xfact=ratio, yfact=ratio,
                           origin=(0, 0)) for rings in data["polygons"])
    if not polygons or any(not p.is_valid or p.area <= 0 for p in polygons):
        raise ValueError("OptiFrame logo contains invalid paths")
    return polygons


def branding_metadata(mesh: trimesh.Trimesh, side: int, pivot_x: float) -> dict:
    """Select only true engraved floors, never a rectangle or uncut outer surface.

    The face indices refer to the existing mesh face order used by preview JSON.
    Silver is an illustrative infill finish; STL contains the uncoloured recess.
    """
    floor_x = pivot_x + side * (9.5 - ENGRAVING_DEPTH_MM)
    triangles = mesh.triangles
    on_floor = np.all(np.abs(triangles[:, :, 0] - floor_x) < 2e-5, axis=1)
    outward = mesh.face_normals[:, 0] * side > .999
    indices = np.flatnonzero(on_floor & outward)
    expected_area = sum(p.area for p in logo_polygons())
    if not len(indices) or not np.isclose(mesh.area_faces[indices].sum(), expected_area, atol=.01):
        raise ValueError("Temple branding floor metadata does not match engraved artwork")
    points = triangles[indices].reshape(-1, 3)
    bounds = np.stack((points.min(axis=0), points.max(axis=0)))
    return {"faceIndices": indices.tolist(), "centre": np.round(bounds.mean(axis=0), 5).tolist(),
            "bounds": np.round(bounds, 5).tolist(), "finish": "silver-infill-preview"}


def apply_temple_brand(mesh: trimesh.Trimesh, side: int,
                       pivot_x: float, pivot_y: float) -> trimesh.Trimesh:
    """Engrave the original spectacles symbol and wordmark, preserving the envelope.

    Coordinates follow the existing assembly: X lateral, Y vertical, negative Z
    rearward. Side is -1 for the left temple and +1 for the right. Opposite local
    horizontal axes keep the lettering readable from both outside viewpoints.
    This contract expects the current 5 x 5.5 mm straight stem at pivot_x+side*7.
    """
    if side not in (-1, 1) or not np.isfinite([pivot_x, pivot_y]).all():
        raise ValueError("Temple branding needs a valid side and finite hinge position")
    if not mesh.is_watertight or not mesh.is_volume:
        raise ValueError("Temple branding needs a closed positive-volume solid")
    polygons = logo_polygons()
    width = max(p.bounds[2] for p in polygons)
    cutters = []
    # A right-handed transform maps local XY lettering onto the outward YZ face.
    transform = np.array([[0., 0., side, pivot_x + side * (9.5 - ENGRAVING_DEPTH_MM)],
                          [0., 1., 0., pivot_y - LOGO_HEIGHT_MM / 2],
                          [-side, 0., 0., LOGO_CENTRE_Z_MM + side * width / 2],
                          [0., 0., 0., 1.]])
    for polygon in polygons:
        cutter = trimesh.creation.extrude_polygon(polygon, ENGRAVING_DEPTH_MM + .1,
                                                  engine="earcut")
        cutter.apply_transform(transform)
        cutters.append(cutter)
    result = trimesh.boolean.difference([mesh, *cutters], engine="manifold")
    expected_removed = sum(p.area for p in polygons) * ENGRAVING_DEPTH_MM
    # Reject geometry contract drift instead of silently cutting the wrong place.
    if (not result.is_volume or not result.is_watertight or
            len(result.split(only_watertight=False)) != 1 or
            not np.allclose(result.bounds, mesh.bounds, atol=1e-5) or
            not np.isclose(mesh.volume - result.volume, expected_removed, atol=.005)):
        raise ValueError("Temple engraving does not fit the current stem geometry")
    result.metadata["branding"] = branding_metadata(result, side, pivot_x)
    return result
