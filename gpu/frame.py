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
    # Match the front's raised hinge axis while retaining the fork's relative shape.
    mesh.apply_translation((0, 0, 2))
    return trimesh.boolean.difference([mesh, _hinge_bore(pivot_x, pivot_y, 3, 18)],
                                      engine="manifold")


def _build_plate(parts: dict[str, trimesh.Trimesh], width: float,
                 depth: float) -> trimesh.Trimesh:
    """Place closed parts on Z=0 using separated XY bounding rectangles."""
    if not np.isfinite([width, depth]).all() or width <= 0 or depth <= 0:
        raise ValueError("Printer bed width and depth must be finite positive millimetres")
    gap = 6.0
    flat = {}
    for name, original in parts.items():
        mesh = original.copy()
        if name.endswith("temple"):
            # The outward stem face extends furthest in X and gives broad contact.
            angle = math.pi / 2 if name.startswith("right") else -math.pi / 2
            mesh.apply_transform(trimesh.transformations.rotation_matrix(angle, (0, 1, 0)))
        mesh.apply_translation(-mesh.bounds[0])
        flat[name] = mesh
    # Larger rectangles first; backtrack over orthogonal orientations and positions
    # adjacent to already placed rectangles. No geometry is scaled or merged.
    names = sorted(flat, key=lambda name: -np.prod(flat[name].extents[:2]))

    def place(index, rectangles, meshes):
        if index == len(names):
            return meshes
        base = flat[names[index]]
        for angle in (0, math.pi / 2):
            mesh = base.copy()
            mesh.apply_transform(trimesh.transformations.rotation_matrix(angle, (0, 0, 1)))
            mesh.apply_translation(-mesh.bounds[0])
            w, d = mesh.extents[:2]
            xs = sorted({0.0, *(r[2] + gap for r in rectangles)})
            ys = sorted({0.0, *(r[3] + gap for r in rectangles)})
            for y in ys:
                for x in xs:
                    if x + w > width + 1e-8 or y + d > depth + 1e-8:
                        continue
                    rect = (x, y, x + w, y + d)
                    if any(not (rect[2] + gap <= r[0] + 1e-8 or
                                r[2] + gap <= rect[0] + 1e-8 or
                                rect[3] + gap <= r[1] + 1e-8 or
                                r[3] + gap <= rect[1] + 1e-8) for r in rectangles):
                        continue
                    placed = mesh.copy()
                    placed.apply_translation((x, y, 0))
                    result = place(index + 1, rectangles + [rect], meshes + [placed])
                    if result is not None:
                        return result
        return None

    packed = place(0, [], [])
    if packed is None:
        raise ValueError(f"Cannot pack the full five-part kit on a {width:g} × {depth:g} mm "
                         "printer bed with 6 mm separation; select a larger bed")
    return trimesh.util.concatenate(packed)


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
    if outer[0].distance(outer[1]) < 0.2:
        raise ValueError("The outer rims and rear retainers overlap or have less than 0.2 mm clearance at these pupil distances")
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
    hinge_centres = []
    for side, outer_lens in [(-1, lens_l), (1, lens_r)]:
        minx, miny, maxx, maxy = outer_lens.bounds
        rim_edge = (minx - 5.3) if side < 0 else (maxx + 5.3)
        # Keep the fork's inner X face 4 mm beyond the outermost rim edge.
        x = rim_edge + side * 8
        y = (miny + maxy) / 2
        tab_x = sorted((rim_edge - side * 2, x + side * 4))
        tabs.append(box(tab_x[0], y - 4, tab_x[1], y + 4))
        hinge_centres.append((x, y))
    face_shape = unary_union(rim_shapes + [bridge] + tabs)
    if face_shape.geom_type != "Polygon":
        raise ValueError("Frame bridge or hinge tabs did not connect to both rims")
    face = _extrude(face_shape, front_z)

    # An outer rail surrounds the lens edge. The rear retainers press against its back.
    rails = [_extrude(o.difference(lens.buffer(0.2)), seat_z, front_z)
             for o, lens in zip(outer, lenses)]
    hinge_lugs = []
    for x, y in hinge_centres:
        hinge_lugs.append(_block((8, 8, 6), (x, y, 3)))
    face = _union([face] + rails + hinge_lugs)
    all_centres = centres[0] + centres[1]
    face = _holes(face, all_centres, 1.1, -0.5, front_z + seat_z + 1)
    for x, y in hinge_centres:
        face = trimesh.boolean.difference([face, _hinge_bore(x, y, 3, 9)],
                                          engine="manifold")

    retainers = []
    for rim, group in zip(rim_shapes, centres):
        retainer = _extrude(rim, 1.8, front_z + seat_z)
        retainers.append(_holes(retainer, group, 1.1, front_z + seat_z - 0.5, 2.8))

    temples = [
        _temple(-1, settings.temple_length, *hinge_centres[0]),
        _temple(1, settings.temple_length, *hinge_centres[1]),
    ]
    parts = {"front": face, "left-retainer": retainers[0], "right-retainer": retainers[1],
             "left-temple": temples[0], "right-temple": temples[1]}
    for name, mesh in parts.items():
        if not mesh.is_watertight or mesh.volume <= 0:
            raise RuntimeError(f"{name} mesh failed watertight validation")

    plate = _build_plate(parts, settings.bed_width, settings.bed_depth)
    notes = {
        "status": "experimental; lens fit and hinge strength require physical validation",
        "units": "millimetres", "parts": list(parts),
        "hardware": "Eight M2 through fasteners for lens retainers; two M2 hinge screws and matching nuts. Check actual screw length and clearance.",
        "lens_edge_thickness_mm": settings.edge_thickness,
        "warning": "Measure lens power and optical centres with an eye care professional. Test a lens fit coupon and verify slicer dimensions before use.",
        "bedFit": True,
        "build_plate": "plate.stl",
        "bed_mm": [settings.bed_width, settings.bed_depth],
        "part_separation_mm": 6,
        "assembly": "Individual STLs share assembly coordinates: retainers begin at the rear lens-seat plane; hinge axes lie 8 mm beyond outer rim bounds at Z=3 mm.",
        "supports": "Review temple fork/block overhangs and horizontal hinge bores in the slicer; support-free printing is not validated.",
    }
    stream = io.BytesIO()
    with ZipFile(stream, "w", ZIP_DEFLATED) as archive:
        for name, mesh in parts.items():
            archive.writestr(f"{name}.stl", mesh.export(file_type="stl"))
        archive.writestr("plate.stl", plate.export(file_type="stl"))
        archive.writestr("README.json", json.dumps(notes, indent=2))
    return stream.getvalue(), notes
