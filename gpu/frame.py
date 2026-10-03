"""Parametric experimental PETG frame kit from independently measured lens outlines."""

from __future__ import annotations

import io
import json
import math
from dataclasses import dataclass
from zipfile import ZIP_DEFLATED, ZipFile

import numpy as np
import trimesh
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import unary_union


@dataclass
class Settings:
    left_pd: float
    right_pd: float
    edge_thickness: float
    temple_length: float
    bed_width: float = 220
    bed_depth: float = 220


def _polygon(points: list[list[float]], sign: int, pd: float) -> Polygon:
    if not 12 <= len(points) <= 3000:
        raise ValueError("Each lens needs 12–3000 reviewed outline points")
    array = np.asarray(points, dtype=float)
    if array.shape != (len(points), 2) or not np.isfinite(array).all():
        raise ValueError("Lens outline contains invalid coordinates")
    if np.max(np.abs(array)) > 100:
        raise ValueError("Lens outline exceeds the 100 mm coordinate limit")
    array[:, 0] += sign * pd
    array[:, 1] *= -1
    polygon = Polygon(array)
    if not polygon.is_valid or polygon.area < 300 or polygon.area > 4000:
        raise ValueError("Lens outline must be a simple, plausible closed shape")
    if polygon.minimum_clearance < 0.2:
        raise ValueError("Lens outline has a narrow or nearly crossed section")
    return polygon


def _extrude(shape, height: float, z: float = 0) -> trimesh.Trimesh:
    mesh = trimesh.creation.extrude_polygon(shape, height=height, engine="earcut")
    mesh.apply_translation((0, 0, z))
    return mesh


def _union(meshes: list[trimesh.Trimesh]) -> trimesh.Trimesh:
    return trimesh.boolean.union(meshes, engine="manifold")


def _holes(mesh: trimesh.Trimesh, centres: list[tuple[float, float]], radius: float,
           start_z: float, length: float) -> trimesh.Trimesh:
    cutters = [trimesh.creation.cylinder(radius=radius, height=length, sections=24,
               transform=trimesh.transformations.translation_matrix((x, y, start_z + length / 2)))
               for x, y in centres]
    return trimesh.boolean.difference([mesh, _union(cutters)], engine="manifold")


def _fastener_centres(lens: Polygon) -> list[tuple[float, float]]:
    minx, miny, maxx, maxy = lens.bounds
    target = [((minx + maxx) / 2, miny - 2.7), ((minx + maxx) / 2, maxy + 2.7),
              (minx - 2.7, (miny + maxy) / 2), (maxx + 2.7, (miny + maxy) / 2)]
    return [(float(x), float(y)) for x, y in target]


def _block(extents: tuple[float, float, float], centre: tuple[float, float, float]) -> trimesh.Trimesh:
    mesh = trimesh.creation.box(extents=extents)
    mesh.apply_translation(centre)
    return mesh


def _hinge_bore(x: float, y: float, z: float, length: float) -> trimesh.Trimesh:
    transform = trimesh.transformations.rotation_matrix(math.pi / 2, (1, 0, 0))
    transform[:3, 3] = (x, y, z)
    return trimesh.creation.cylinder(radius=1.1, height=length, sections=32,
                                     transform=transform)


def _temple(side: int, length: float, pivot_x: float, pivot_y: float) -> trimesh.Trimesh:
    """Rearward temple with a two-knuckle fork around the front hinge lug."""
    offset = side * 7
    fork_y = 5.7
    parts = [
        _block((8, 2.5, 14), (pivot_x, pivot_y - fork_y, -4)),
        _block((8, 2.5, 14), (pivot_x, pivot_y + fork_y, -4)),
        _block((10, 14, 5), (pivot_x + offset / 2, pivot_y, -10)),
        _block((5, 5.5, length - 12), (pivot_x + offset, pivot_y, -(length + 12) / 2)),
    ]
    mesh = _union(parts)
    return trimesh.boolean.difference([mesh, _hinge_bore(pivot_x, pivot_y, 1, 18)],
                                      engine="manifold")


def generate(left: list[list[float]], right: list[list[float]], settings: Settings) -> tuple[bytes, dict]:
    if not (20 <= settings.left_pd <= 40 and 20 <= settings.right_pd <= 40):
        raise ValueError("Monocular pupil distances must each be 20–40 mm")
    if not 1.0 <= settings.edge_thickness <= 6.0:
        raise ValueError("Measured lens edge thickness must be 1–6 mm")
    if not 90 <= settings.temple_length <= 180:
        raise ValueError("Temple length must be 90–180 mm")
    lens_l = _polygon(left, -1, settings.left_pd)
    lens_r = _polygon(right, 1, settings.right_pd)
    if lens_l.bounds[2] + 2 > lens_r.bounds[0]:
        raise ValueError("The measured lenses overlap at these pupil distances")

    lenses = [lens_l, lens_r]
    centres = [_fastener_centres(lens) for lens in lenses]
    front_z = 2.0
    seat_z = settings.edge_thickness + 0.3
    outer = [lens.buffer(5.3, join_style=1) for lens in lenses]
    inner = [lens.buffer(-0.7, join_style=1) for lens in lenses]
    if any(p.is_empty for p in inner):
        raise ValueError("Lens contour is too narrow for the retaining lip")
    rim_shapes = [o.difference(i) for o, i in zip(outer, inner)]
    for group, rim in zip(centres, rim_shapes):
        if any(not rim.contains(Point(x, y).buffer(1.15)) for x, y in group):
            raise ValueError("A lens has insufficient material around an M2 fastener")

    # The bridge joins the upper inner edges and leaves the nose opening clear.
    left_inner = lens_l.bounds[2]
    right_inner = lens_r.bounds[0]
    bridge_y = min(lens_l.bounds[3], lens_r.bounds[3]) - 8
    bridge = LineString([(left_inner + 3, bridge_y),
                         (right_inner - 3, bridge_y)]).buffer(2.6, cap_style=1)
    tabs = []
    for side, outer_lens in [(-1, lens_l), (1, lens_r)]:
        minx, miny, maxx, maxy = outer_lens.bounds
        x = (minx - 5.3) if side < 0 else (maxx + 5.3)
        y = (miny + maxy) / 2
        tabs.append(box(x - 4, y - 4, x + 4, y + 4))
    face_shape = unary_union(rim_shapes + [bridge] + tabs)
    if face_shape.geom_type != "Polygon":
        raise ValueError("Frame bridge or hinge tabs did not connect to both rims")
    face = _extrude(face_shape, front_z)

    # An outer rail surrounds the lens edge. The rear retainers press against its back.
    rails = [_extrude(o.difference(lens.buffer(0.2)), seat_z, front_z)
             for o, lens in zip(outer, lenses)]
    hinge_centres = []
    hinge_lugs = []
    for tab in tabs:
        minx, miny, maxx, maxy = tab.bounds
        x, y = (minx + maxx) / 2, (miny + maxy) / 2
        hinge_centres.append((x, y))
        hinge_lugs.append(_block((8, 8, 6), (x, y, 1)))
    face = _union([face] + rails + hinge_lugs)
    all_centres = centres[0] + centres[1]
    face = _holes(face, all_centres, 1.1, -0.5, front_z + seat_z + 1)
    for x, y in hinge_centres:
        face = trimesh.boolean.difference([face, _hinge_bore(x, y, 1, 9)],
                                          engine="manifold")

    retainers = []
    for rim, group in zip(rim_shapes, centres):
        retainer = _extrude(rim, 1.8)
        retainers.append(_holes(retainer, group, 1.1, -0.5, 2.8))

    temples = [
        _temple(-1, settings.temple_length, *hinge_centres[0]),
        _temple(1, settings.temple_length, *hinge_centres[1]),
    ]
    parts = {"front": face, "left-retainer": retainers[0], "right-retainer": retainers[1],
             "left-temple": temples[0], "right-temple": temples[1]}
    for name, mesh in parts.items():
        if not mesh.is_watertight or mesh.volume <= 0:
            raise RuntimeError(f"{name} mesh failed watertight validation")

    # Separate closed STL parts are easier to orient and slice than one overlapping scene.
    notes = {
        "status": "experimental; lens fit and hinge strength require physical validation",
        "units": "millimetres", "parts": list(parts),
        "hardware": "Eight M2 through fasteners for lens retainers; two M2 hinge screws and matching nuts. Check actual screw length and clearance.",
        "lens_edge_thickness_mm": settings.edge_thickness,
        "warning": "Measure lens power and optical centres with an eye care professional. Test a lens fit coupon and verify slicer dimensions before use.",
        "bedFit": all(sorted(mesh.extents, reverse=True)[0] <= max(settings.bed_width, settings.bed_depth)
                      and sorted(mesh.extents, reverse=True)[1] <= min(settings.bed_width, settings.bed_depth)
                      for mesh in parts.values()),
    }
    stream = io.BytesIO()
    with ZipFile(stream, "w", ZIP_DEFLATED) as archive:
        for name, mesh in parts.items():
            archive.writestr(f"{name}.stl", mesh.export(file_type="stl"))
        archive.writestr("README.json", json.dumps(notes, indent=2))
    return stream.getvalue(), notes
