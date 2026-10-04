"""Parametric experimental PETG frame kit from independently measured lens outlines."""

from __future__ import annotations

import io
import json
import math
from dataclasses import dataclass
from zipfile import ZIP_DEFLATED, ZipFile

import numpy as np
import trimesh
from shapely.affinity import translate
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import nearest_points, unary_union
from shapely.strtree import STRtree
from temple_brand import apply_temple_brand


OUTLINE_SIMPLIFICATION_MM = 0.05
MIN_OUTLINE_CLEARANCE_MM = 0.2
FRAME_STYLES = ("classic", "bold", "brow")
TEMPLE_PROFILES = {"classic": "slim taper, softened end", "bold": "wide sculpted arm, deep bevel",
                   "brow": "stepped architectural arm, tapered tip"}
RETENTION_STYLES = ("screw", "snap")


def _check_nonlocal_clearance(polygon: Polygon) -> None:
    """Check distinct boundary sections, not distances between dense adjacent samples.

    GEOS minimum_clearance also counts tiny edges along an otherwise sound rim.
    Only chains separated by more than 0.5 mm of boundary arc are nonlocal;
    the 0.2 mm physical separation requirement is unchanged for those sections.
    """
    coords = np.asarray(polygon.exterior.coords)
    lengths = np.linalg.norm(np.diff(coords, axis=0), axis=1)
    arc = np.concatenate(([0.0], np.cumsum(lengths)))
    segments = [LineString(coords[i:i + 2]) for i in range(len(lengths))]
    tree = STRtree(segments)
    for i, segment in enumerate(segments):
        for j in tree.query(segment, predicate="dwithin", distance=MIN_OUTLINE_CLEARANCE_MM):
            if j <= i:
                continue
            gap = min(arc[j] - arc[i + 1], arc[-1] - (arc[j + 1] - arc[i]))
            if gap <= 0.5:
                continue
            if segment.distance(segments[j]) < MIN_OUTLINE_CLEARANCE_MM:
                raise ValueError("Lens outline has a narrow or nearly crossed section")


@dataclass
class Settings:
    left_pd: float
    right_pd: float
    edge_thickness: float
    temple_length: float
    bed_width: float = 220
    bed_depth: float = 220
    left_edge_thickness: float | None = None
    right_edge_thickness: float | None = None
    left_vertical_offset: float = 0
    right_vertical_offset: float = 0
    frame_style: str = "classic"
    retention_style: str = "screw"
    alignment_source: str = "unspecified"
    measurement_source: str = "manual"

    def edge_thicknesses(self) -> tuple[float, float]:
        return (self.edge_thickness if self.left_edge_thickness is None else self.left_edge_thickness,
                self.edge_thickness if self.right_edge_thickness is None else self.right_edge_thickness)


def _polygon(points: list[list[float]], sign: int, pd: float, vertical_offset: float = 0) -> Polygon:
    if not 12 <= len(points) <= 3000:
        raise ValueError("Each lens needs 12–3000 reviewed outline points")
    array = np.asarray(points, dtype=float)
    if array.shape != (len(points), 2) or not np.isfinite(array).all():
        raise ValueError("Lens outline contains invalid coordinates")
    if np.max(np.abs(array)) > 100:
        raise ValueError("Lens outline exceeds the 100 mm coordinate limit")
    array[:, 0] += sign * pd
    array[:, 1] *= -1
    array[:, 1] += vertical_offset
    polygon = Polygon(array)
    if not polygon.is_valid or polygon.area < 300 or polygon.area > 4000:
        raise ValueError("Lens outline must be a simple, plausible closed shape")
    # Test the measured boundary before simplification so cleanup cannot hide a pinch.
    if polygon.minimum_clearance < MIN_OUTLINE_CLEARANCE_MM:
        _check_nonlocal_clearance(polygon)
    # Sparse reviewed contours stay exact. Only oversampled/duplicate chains need cleanup.
    duplicate_sample = np.any(np.linalg.norm(np.diff(np.asarray(polygon.exterior.coords), axis=0), axis=1) < 1e-10)
    simplified = (polygon.simplify(OUTLINE_SIMPLIFICATION_MM, preserve_topology=True)
                  if len(array) > 512 or duplicate_sample else polygon)
    if (not simplified.is_valid or simplified.geom_type != "Polygon" or
            polygon.boundary.hausdorff_distance(simplified.boundary) > OUTLINE_SIMPLIFICATION_MM + 1e-9):
        raise ValueError("Outline cleanup exceeded the 0.05 mm boundary tolerance")
    polygon = simplified
    if polygon.minimum_clearance < MIN_OUTLINE_CLEARANCE_MM:
        _check_nonlocal_clearance(polygon)
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


def _outer_profile(lens: Polygon, style: str) -> Polygon:
    """Style only adds material outside the original rim; never reshape a lens seat."""
    if style not in FRAME_STYLES:
        raise ValueError("Frame style must be classic, bold or brow")
    base = lens.buffer(6.5 if style == "bold" else 5.3, join_style=1)
    if style == "brow":
        # Assembly Y points upward. The overlapping translated rim gives a
        # continuous upper accent without removing fastener or retention stock.
        return base.union(translate(base, yoff=2.0))
    return base


def _block(extents: tuple[float, float, float], centre: tuple[float, float, float]) -> trimesh.Trimesh:
    mesh = trimesh.creation.box(extents=extents)
    mesh.apply_translation(centre)
    return mesh


def _snap_pin(x: float, y: float, rear_z: float) -> trimesh.Trimesh:
    """Experimental split push pin: head at rear, two flexible barbs ahead of front.

    A 3.0 mm shaft slides in a 3.4 mm bore. The 3.8 mm split barb must compress
    during insertion, then catches the front face with 0.15 mm axial clearance.
    The two legs stay connected by the unsplit root under the 5 mm head.
    """
    head_bottom = rear_z + .15
    shaft_bottom = -.35
    shaft = trimesh.creation.cylinder(radius=1.5, height=head_bottom-shaft_bottom+.1,
                                     sections=32)
    shaft.apply_translation((x, y, (head_bottom+shaft_bottom+.1)/2))
    head = trimesh.creation.cylinder(radius=2.5, height=1.4, sections=32)
    head.apply_translation((x, y, head_bottom+.7))
    # Revolved profile makes a tapered lead-in and a flat retention shoulder.
    barb = trimesh.creation.revolve(np.array([[0, -1.5], [1.1, -1.5],
        [1.9, -.35], [1.9, -.15], [0, -.15]]), sections=32)
    barb.apply_translation((x, y, 0))
    pin = _union([shaft, head, barb])
    split_top = head_bottom-1.8
    slit = _block((.7, 6, split_top+2), (x, y, (split_top-2)/2))
    pin = trimesh.boolean.difference([pin, slit], engine="manifold")
    if len(pin.split(only_watertight=False)) != 1:
        raise RuntimeError("Snap pin legs disconnected from their head")
    return pin


def _hinge_bore(x: float, y: float, z: float, length: float) -> trimesh.Trimesh:
    transform = trimesh.transformations.rotation_matrix(math.pi / 2, (1, 0, 0))
    transform[:3, 3] = (x, y, z)
    return trimesh.creation.cylinder(radius=1.1, height=length, sections=32,
                                     transform=transform)


def _beveled_block(extents, centre, bevel=.3) -> trimesh.Trimesh:
    """Convex chamfered block; bevel removes stock without enlarging mating envelopes."""
    half = np.asarray(extents, dtype=float) / 2
    points = []
    for signs in np.ndindex(2, 2, 2):
        sign = np.asarray(signs) * 2 - 1
        for axis in range(3):
            point = half - bevel
            point[axis] = half[axis]
            points.append(point * sign + centre)
    return trimesh.convex.convex_hull(np.asarray(points))


def _temple_arm(stations, centre_x, centre_y, side) -> trimesh.Trimesh:
    """Loft closed chamfered XY sections along rearward Z, with no hollow shell."""
    vertices = []
    for z, width, height, drop, bevel in stations:
        x, y = width / 2, height / 2
        ring = [(-x+bevel, -y), (x-bevel, -y), (x, -y+bevel), (x, y-bevel),
                (x-bevel, y), (-x+bevel, y), (-x, y-bevel), (-x, -y+bevel)]
        # A common outward plane preserves broad build-plate contact while the
        # inside tapers; bevels/height/drop provide the visible sculpted profile.
        section_x = centre_x + side * (5-width)/2
        vertices.extend((section_x+px, centre_y+drop+py, z) for px, py in ring)
    faces = []
    for section in range(len(stations)-1):
        a, b = section*8, (section+1)*8
        for i in range(8):
            j = (i+1) % 8
            faces.extend([(a+i, b+i, b+j), (a+i, b+j, a+j)])
    for i in range(1, 7):
        faces.append((0, i, i+1))
        end = (len(stations)-1)*8
        faces.append((end, end+i+1, end+i))
    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=True)
    mesh.fix_normals()
    return mesh


def _temple(side: int, length: float, pivot_x: float, pivot_y: float,
            style: str = "classic") -> trimesh.Trimesh:
    """Shared hinge and logo stock with three genuinely different beveled arms."""
    if style not in FRAME_STYLES:
        raise ValueError("Frame style must be classic, bold or brow")
    offset = side * 7
    fork_y = 5.7
    # The common -12..-44 stock keeps the entire 18.44 x 3.5 mm engraving flat.
    stations = [(-12, 5, 5.5, 0, .4), (-44, 5, 5.5, 0, .4)]
    if style == "classic":
        stations += [(-length*.63, 4.2, 5.0, -.2, .55),
                     (-length+10, 3.8, 4.8, -1.6, .7),
                     (-length+1, 3.8, 4.8, -3.0, .8),
                     (-length, 2.8, 3.8, -3.0, .7)]
    elif style == "bold":
        stations += [(-50, 7, 9, -.1, 1.0),
                     (-length*.73, 7, 9, -.1, 1.0),
                     (-length+8, 5, 7, -1.5, 1.0),
                     (-length+1, 5, 7, -3.5, 1.0),
                     (-length, 3.8, 5.8, -3.5, .9)]
    else:
        stations += [(-50, 5, 8.5, 1.5, .65),
                     (-length*.65, 5, 8.5, 1.5, .65),
                     (-length*.65-4, 4.6, 5.5, 0, .65),
                     (-length+8, 4.2, 5.5, -2.0, .7),
                     (-length+1, 4.2, 5.5, -3.0, .8),
                     (-length, 3.2, 4.5, -3.0, .75)]
    parts = [
        _beveled_block((8, 2.5, 14), (pivot_x, pivot_y - fork_y, -4)),
        _beveled_block((8, 2.5, 14), (pivot_x, pivot_y + fork_y, -4)),
        _beveled_block((10, 14, 5), (pivot_x + offset / 2, pivot_y, -10)),
        _temple_arm(stations, pivot_x + offset, pivot_y, side),
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
        elif "snap-pin" in name:
            # The full flat head sits on the bed; tips face upward.
            mesh.apply_transform(trimesh.transformations.rotation_matrix(math.pi, (1, 0, 0)))
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
        kit = "five-part" if len(parts) == 5 else f"{len(parts)}-part"
        raise ValueError(f"Cannot pack the full {kit} kit on a {width:g} × {depth:g} mm "
                         "printer bed with 6 mm separation; select a larger bed")
    return trimesh.util.concatenate(packed)


def build_parts(left: list[list[float]], right: list[list[float]], settings: Settings):
    if settings.alignment_source not in ("unspecified", "provider-marked", "illustrative"):
        raise ValueError("Unknown lens alignment source")
    if settings.measurement_source not in ("manual", "browser-iris-estimate", "arkit-eye-transform-estimate"):
        raise ValueError("Unknown face measurement source")
    """Build printable solids in their shared assembly coordinates."""
    if settings.frame_style not in FRAME_STYLES:
        raise ValueError("Frame style must be classic, bold or brow")
    if settings.retention_style not in RETENTION_STYLES:
        raise ValueError("Retention style must be screw or snap")
    if not (np.isfinite([settings.left_pd, settings.right_pd]).all() and
            20 <= settings.left_pd <= 40 and 20 <= settings.right_pd <= 40):
        raise ValueError("Monocular pupil distances must each be 20–40 mm")
    edge_thicknesses = settings.edge_thicknesses()
    if not (np.isfinite(edge_thicknesses).all() and
            all(1.0 <= thickness <= 6.0 for thickness in edge_thicknesses)):
        raise ValueError("Each measured lens edge thickness must be 1–6 mm")
    offsets = (settings.left_vertical_offset, settings.right_vertical_offset)
    if not (np.isfinite(offsets).all() and all(-10 <= offset <= 10 for offset in offsets)):
        raise ValueError("Each optical-centre vertical offset must be −10 to 10 mm")
    if not np.isfinite(settings.temple_length) or not 90 <= settings.temple_length <= 180:
        raise ValueError("Temple length must be 90–180 mm")
    lens_l = _polygon(left, -1, settings.left_pd, settings.left_vertical_offset)
    lens_r = _polygon(right, 1, settings.right_pd, settings.right_vertical_offset)
    if lens_l.bounds[2] + 2 > lens_r.bounds[0]:
        raise ValueError("The measured lenses overlap at these pupil distances")

    lenses = [lens_l, lens_r]
    centres = [_fastener_centres(lens) for lens in lenses]
    front_z = 2.0
    seat_z = [thickness + 0.3 for thickness in edge_thicknesses]
    outer = [_outer_profile(lens, settings.frame_style) for lens in lenses]
    if outer[0].distance(outer[1]) < 0.2:
        raise ValueError("The outer rims and rear retainers overlap or have less than 0.2 mm clearance at these pupil distances")
    inner = [lens.buffer(-0.7, join_style=1) for lens in lenses]
    if any(p.is_empty for p in inner):
        raise ValueError("Lens contour is too narrow for the retaining lip")
    rim_shapes = [o.difference(i) for o, i in zip(outer, inner)]
    bore_radius = 1.7 if settings.retention_style == "snap" else 1.1
    if settings.retention_style == "snap":
        # Real asymmetric contours do not necessarily meet their bounding-box
        # midpoints. Move pin centres to nearby verified head-supporting stock.
        snap_centres = []
        for rim, lens, targets in zip(rim_shapes, lenses, centres):
            # A 1.7 mm bore needs 0.2 mm rail wall beyond the 0.2 mm lens gap.
            safe = rim.buffer(-2.56).difference(lens.buffer(2.11))
            if safe.is_empty:
                raise ValueError("A lens has insufficient material around a snap-pin head")
            group = [tuple(nearest_points(Point(x, y), safe)[1].coords[0]) for x, y in targets]
            if any(Point(a).distance(Point(b)) < 5.2 for i, a in enumerate(group) for b in group[i+1:]):
                raise ValueError("Snap-pin heads cannot maintain their required clearance")
            snap_centres.append(group)
        centres = snap_centres
    for group, rim in zip(centres, rim_shapes):
        clearance_radius = 2.55 if settings.retention_style == "snap" else 1.15
        if any(not rim.contains(Point(x, y).buffer(clearance_radius)) for x, y in group):
            fitting = "a snap-pin head" if settings.retention_style == "snap" else "an M2 fastener"
            raise ValueError(f"A lens has insufficient material around {fitting}")

    # The bridge joins the upper inner edges and leaves the nose opening clear.
    left_inner = lens_l.bounds[2]
    right_inner = lens_r.bounds[0]
    bridge_y = min(lens_l.bounds[3], lens_r.bounds[3]) - 8
    bridge = LineString([(left_inner + 3, bridge_y),
                         (right_inner - 3, bridge_y)]).buffer(2.6, cap_style=1)
    tabs = []
    hinge_centres = []
    for side, outer_lens, profile in [(-1, lens_l, outer[0]), (1, lens_r, outer[1])]:
        minx, miny, maxx, maxy = outer_lens.bounds
        # Preserve legacy classic coordinates exactly; bold moves the hinge
        # outward by its added stock, retaining the same fork clearance.
        rim_edge = (minx - 5.3) if side < 0 else (maxx + 5.3)
        if settings.frame_style != "classic":
            rim_edge = profile.bounds[0] if side < 0 else profile.bounds[2]
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
    rails = [_extrude(o.difference(lens.buffer(0.2)), seat, front_z)
             for o, lens, seat in zip(outer, lenses, seat_z)]
    hinge_lugs = []
    for x, y in hinge_centres:
        hinge_lugs.append(_block((8, 8, 6), (x, y, 3)))
    face = _union([face] + rails + hinge_lugs)
    all_centres = centres[0] + centres[1]
    face = _holes(face, all_centres, bore_radius, -0.5, front_z + max(seat_z) + 1)
    for x, y in hinge_centres:
        face = trimesh.boolean.difference([face, _hinge_bore(x, y, 3, 9)],
                                          engine="manifold")

    retainers = []
    for rim, group, seat in zip(rim_shapes, centres, seat_z):
        retainer = _extrude(rim, 1.8, front_z + seat)
        retainers.append(_holes(retainer, group, bore_radius, front_z + seat - 0.5, 2.8))

    temples = [
        apply_temple_brand(_temple(-1, settings.temple_length, *hinge_centres[0], settings.frame_style), -1, *hinge_centres[0]),
        apply_temple_brand(_temple(1, settings.temple_length, *hinge_centres[1], settings.frame_style), 1, *hinge_centres[1]),
    ]
    parts = {"front": face, "left-retainer": retainers[0], "right-retainer": retainers[1],
             "left-temple": temples[0], "right-temple": temples[1]}
    if settings.retention_style == "snap":
        for side, group, seat in zip(("left", "right"), centres, seat_z):
            for index, (x, y) in enumerate(group, 1):
                parts[f"{side}-snap-pin-{index}"] = _snap_pin(x, y, front_z+seat+1.8)
    for name, mesh in parts.items():
        if not mesh.is_watertight or mesh.volume <= 0:
            raise RuntimeError(f"{name} mesh failed watertight validation")

    notes = {
        "status": "experimental; lens fit and hinge strength require physical validation",
        "units": "millimetres", "parts": list(parts),
        "frame_style": settings.frame_style,
        "temple_style": settings.frame_style,
        "temple_profile": TEMPLE_PROFILES[settings.frame_style],
        "retention_style": settings.retention_style,
        "temple_branding": "OptiFrame wordmark, engraved 0.4 mm into each outward temple face",
        "outline_cleanup_max_boundary_deviation_mm": OUTLINE_SIMPLIFICATION_MM,
        "hardware": "Eight M2 through fasteners for lens retainers; two M2 hinge screws and matching nuts. Check actual screw length and clearance.",
        "lens_edge_thickness_mm": {"left": edge_thicknesses[0], "right": edge_thicknesses[1]},
        "optical_centre_vertical_offset_mm": {"left": offsets[0], "right": offsets[1]},
        "warning": "Measure lens power and optical centres with an eye care professional. Test a lens fit coupon and verify slicer dimensions before use.",
        "bedFit": True,
        "build_plate": "plate.stl",
        "bed_mm": [settings.bed_width, settings.bed_depth],
        "part_separation_mm": 6,
        "assembly": "Individual STLs share assembly coordinates: retainers begin at the rear lens-seat plane; hinge axes lie 8 mm beyond outer rim bounds at Z=3 mm.",
        "supports": "Review temple fork/block overhangs and horizontal hinge bores in the slicer; support-free printing is not validated.",
    }
    if settings.retention_style == "snap":
        notes.update({
            "status": "experimental snap-pin print test; insertion force, retention, fatigue and lens fit are not physically validated",
            "hardware": "Eight printed split snap pins included; two M2 hinge screws and matching nuts still required.",
            "snap_pin": {"shaft_diameter_mm": 3.0, "bore_diameter_mm": 3.4,
                         "barb_diameter_mm": 3.8, "head_diameter_mm": 5.0,
                         "split_width_mm": .7, "axial_clearance_per_end_mm": .15,
                         "grip_length_mm": {"left": front_z+seat_z[0]+1.8,
                                            "right": front_z+seat_z[1]+1.8}},
            "assembly": "Seat each lens, place its matching rear ring, then insert its four thickness-matched split pins from the rear until the barbs clear the front face. Never force a lens. Pin removal requires compressing both barbs from the front; accessibility and repeated removal are not validated.",
            "supports": "Plate places pins head-down. PETG is a starting material for coupons only: thin split legs, barb overhangs and layer adhesion require slicer review and destructive retention tests. Review temple and hinge supports too.",
            "warning": "Experimental snap mechanism, not a validated wearable product. First print one pin plus a same-thickness bore coupon and test insertion, pullout and fatigue without a lens. Do not rely on these dimensions for brittle resin or PLA. Lens power and optical centres still require an eye care professional.",
        })
    notes["alignment_source"] = settings.alignment_source
    notes["measurement_source"] = settings.measurement_source
    notes["measurements_require_verification"] = True
    notes["measurement_warning"] = ("Uncalibrated iris-size estimate; review confirmation does not verify millimetric accuracy. Prototype fit only."
        if settings.measurement_source == "browser-iris-estimate" else
        "ARKit eye-transform estimate, not clinical pupil centres. Prototype fit only."
        if settings.measurement_source == "arkit-eye-transform-estimate" else
        "Operator-entered measurements; physical accuracy has not been independently verified.")
    notes["alignment_warning"] = ("Approximate geometric alignment for a prototype only; optical centres and orientation must be marked and verified before wearer fitting."
        if settings.alignment_source != "provider-marked" else
        "Provider marks supplied by the operator; their accuracy has not been independently verified.")
    return parts, lenses, notes


def preview(left: list[list[float]], right: list[list[float]], settings: Settings) -> dict:
    """Assembly only: skip print-bed packing, compression and STL round trips."""
    parts, lenses, _ = build_parts(left, right, settings)

    def mesh_data(name, mesh, kind):
        return {"name": name, "kind": kind,
                "vertices": np.round(mesh.vertices, 5).tolist(), "faces": mesh.faces.tolist()}

    meshes = [mesh_data(name, mesh, "printed") for name, mesh in parts.items()]
    for side, lens, thickness in zip(("left", "right"), lenses, settings.edge_thicknesses()):
        meshes.append(mesh_data(side + "-lens", _extrude(lens, thickness, 2.15), "lens"))
    return {"schemaVersion": 1, "units": "millimetres", "meshes": meshes,
            "frameStyle": settings.frame_style,
            "templeStyle": settings.frame_style,
            "templeProfile": TEMPLE_PROFILES[settings.frame_style],
            "retentionStyle": settings.retention_style,
            "alignmentSource": settings.alignment_source,
            "measurementSource": settings.measurement_source,
            "measurementsRequireVerification": True,
            "opticalCentres": [[-settings.left_pd, settings.left_vertical_offset, 2.15],
                               [settings.right_pd, settings.right_vertical_offset, 2.15]],
            "lensRepresentation": "Flat outlines with measured edge thickness; optical curvature is not measured",
            "bedFit": "Not checked in preview; checked during STL export"}


def generate(left: list[list[float]], right: list[list[float]], settings: Settings) -> tuple[bytes, dict]:
    parts, _, notes = build_parts(left, right, settings)
    plate = _build_plate(parts, settings.bed_width, settings.bed_depth)
    stream = io.BytesIO()
    with ZipFile(stream, "w", ZIP_DEFLATED) as archive:
        for name, mesh in parts.items():
            archive.writestr(f"{name}.stl", _validated_stl(mesh, name))
        archive.writestr("plate.stl", _validated_stl(plate, "plate"))
        archive.writestr("README.json", json.dumps(notes, indent=2))
    return stream.getvalue(), notes


def _validated_stl(mesh: trimesh.Trimesh, name: str) -> bytes:
    """Validate the float32 geometry that STL actually stores, including packed parts."""
    output = mesh.copy()
    rounded = output.vertices.astype(np.float32).astype(np.float64)
    if np.max(np.abs(rounded - output.vertices)) > 0.0001:
        raise RuntimeError(f"{name} STL exceeds coordinate precision tolerance")
    output.vertices = rounded
    # Boolean intersections can create slivers that collapse on float32 export.
    # Remove only those duplicate/degenerate triangles, never fill or smooth holes.
    output.merge_vertices(digits_vertex=7)
    output.update_faces(output.nondegenerate_faces())
    output.update_faces(output.unique_faces())
    output.remove_unreferenced_vertices()
    data = output.export(file_type="stl")
    decoded = trimesh.load(io.BytesIO(data), file_type="stl")
    if not decoded.is_watertight or decoded.volume <= 0:
        raise RuntimeError(f"{name} serialized STL failed watertight validation")
    return data
