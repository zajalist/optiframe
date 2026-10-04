"""Experimental integral lens clips; dimensions are coupon starting values only."""
import numpy as np
import trimesh
from shapely import affinity
from shapely.geometry import LineString, Point, box
from shapely.ops import nearest_points

SPRING_LENGTH = 9.0
SPRING_WIDTH = 1.2
SPRING_HEIGHT = 1.4
UNDER_CLEARANCE = .6
EDGE_OVERLAP = .6


def _extrude(shape, height, z):
    mesh = trimesh.creation.extrude_polygon(shape, height, engine="earcut")
    mesh.apply_translation((0, 0, z))
    return mesh


def _clip(boundary, lens, start, rear_z):
    points = [boundary.interpolate((start+s) % boundary.length).coords[0]
              for s in np.linspace(0, SPRING_LENGTH, 10)]
    beam_shape = LineString(points).buffer(SPRING_WIDTH/2, cap_style=1, quad_segs=8)
    anchor_shape = Point(points[0]).buffer(1.1, quad_segs=8)
    tip = np.asarray(points[-1])
    edge = np.asarray(nearest_points(Point(tip), lens.boundary)[1].coords[0])
    normal = tip-edge
    normal /= np.linalg.norm(normal)
    tangent = np.array([-normal[1], normal[0]])
    # Rounded contact footprint with exactly 0.6 mm inward edge overlap.
    lower = box(-.3, -.9, 2.0, .9).buffer(.3, quad_segs=8)
    lower = affinity.affine_transform(lower, [normal[0], tangent[0], normal[1], tangent[1], *edge])
    upper = Point(tip).buffer(.6, quad_segs=8)
    vertices = [[x, y, rear_z+UNDER_CLEARANCE] for x, y in lower.exterior.coords[:-1]]
    vertices += [[x, y, rear_z+UNDER_CLEARANCE+SPRING_HEIGHT] for x, y in upper.exterior.coords[:-1]]
    nose = trimesh.convex.convex_hull(np.asarray(vertices))
    beam = _extrude(beam_shape, SPRING_HEIGHT, rear_z+UNDER_CLEARANCE)
    anchor = _extrude(anchor_shape, UNDER_CLEARANCE+SPRING_HEIGHT+.25, rear_z-.25)
    free = trimesh.boolean.union([beam, nose], engine="manifold")
    return trimesh.boolean.union([free, anchor], engine="manifold"), free, anchor_shape, beam_shape, lower


def add_lens_clips(face, lens, outer, rear_z):
    """Attach four independent spring roots; reject obstructed spring paths."""
    boundary = lens.buffer(1.7).exterior
    chosen = []
    paths = list(face.metadata.get("directClipPaths", []))
    for quadrant in range(4):
        accepted = None
        for shift in (0, .025, -.025, .05, -.05, .075, -.075):
            start = boundary.length*((quadrant+.5)/4+shift)
            clip, free, anchor, beam, nose = _clip(boundary, lens, start, rear_z)
            if not outer.contains(anchor.buffer(.15)) or not outer.contains(beam):
                continue
            if anchor.intersects(lens.buffer(.2)):
                continue
            overlap = trimesh.boolean.intersection([free, face], engine="manifold")
            if not overlap.is_empty and abs(overlap.volume) > 1e-5:
                continue
            if any(not trimesh.boolean.intersection([clip, other], engine="manifold").is_empty for other in chosen):
                continue
            # Verify actual under-arm clearance rather than drawing cosmetic slots.
            accepted = clip
            slot_point = boundary.interpolate((start+SPRING_LENGTH*.55) % boundary.length).coords[0]
            break
        if accepted is None:
            raise ValueError("Direct clips cannot maintain four clear spring paths on this lens; choose another retention mode")
        chosen.append(accepted)
        paths.append({"slot_point": list(slot_point), "rear_z": rear_z})
    result = trimesh.boolean.union([face, *chosen], engine="manifold")
    if not result.is_watertight or len(result.split()) != 1:
        raise ValueError("Direct clip roots did not connect to the frame")
    result.metadata["directClipPaths"] = paths
    return result


def clip_fit_coupon(thickness):
    """Separate small curved rim coupon with one identical spring and front lip."""
    lens = Point(0, 0).buffer(22, quad_segs=32)
    boundary = lens.buffer(1.7).exterior
    rear = 2+float(thickness)+.3
    clip, _, anchor, beam, nose = _clip(boundary, lens, 0, rear)
    region = anchor.union(beam).union(nose).buffer(2.2).envelope
    outer = lens.buffer(5.3).intersection(region)
    base = _extrude(outer.difference(lens.buffer(-.7)), 2, 0)
    rail = _extrude(outer.difference(lens.buffer(.2)), thickness+.3, 2)
    result = trimesh.boolean.union([base, rail, clip], engine="manifold")
    result.apply_translation(-result.bounds[0])
    if not result.is_watertight or len(result.split()) != 1:
        raise ValueError("Direct clip coupon is not a connected solid")
    return result


def clip_notes():
    return {"clips_per_lens": 4, "spring_length_mm": SPRING_LENGTH,
            "spring_width_mm": SPRING_WIDTH, "spring_height_mm": SPRING_HEIGHT,
            "under_arm_clearance_mm": UNDER_CLEARANCE, "edge_overlap_mm": EDGE_OVERLAP,
            "validation": "Geometry checked only; insertion force, creep, fatigue, lens damage and retention require physical testing"}
