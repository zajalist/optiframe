import io
import math
import json
import unittest
from pathlib import Path
from zipfile import ZipFile

import trimesh
import numpy as np

from shapely.geometry import Point, Polygon
from frame import (Settings, generate, preview, build_parts, _polygon, _outer_profile,
                   OUTLINE_SIMPLIFICATION_MM, FRAME_STYLES)


def ellipse(rx, ry, count=96):
    return [[rx * math.cos(2 * math.pi * i / count),
             ry * math.sin(2 * math.pi * i / count)] for i in range(count)]


def bed_contact_area(mesh):
    """Area of horizontal mesh triangles at the floor, a geometric contact proxy."""
    at_floor = np.all(np.abs(mesh.triangles[:, :, 2]) < 1e-5, axis=1)
    return float(mesh.area_faces[at_floor].sum())


class FrameTests(unittest.TestCase):
    def test_snap_kit_has_real_split_pins_and_independent_thickness_grips(self):
        settings = Settings(33, 33, 2.5, 125, left_edge_thickness=1,
                            right_edge_thickness=6, retention_style="snap")
        parts, _, notes = build_parts(ellipse(25, 19), ellipse(23, 17), settings)
        self.assertEqual(len(parts), 13)
        self.assertEqual(notes["retention_style"], "snap")
        self.assertAlmostEqual(notes["snap_pin"]["grip_length_mm"]["left"], 5.1)
        self.assertAlmostEqual(notes["snap_pin"]["grip_length_mm"]["right"], 10.1)
        self.assertIn("not physically validated", notes["status"])
        for side, grip in (("left", 5.1), ("right", 10.1)):
            pin = parts[f"{side}-snap-pin-1"]
            self.assertTrue(pin.is_watertight)
            self.assertEqual(len(pin.split()), 1)
            self.assertAlmostEqual(pin.bounds[0, 2], -1.5, places=5)
            self.assertAlmostEqual(pin.bounds[1, 2], grip+1.55, places=5)
            # At the front bore plane the two legs are separated, while their
            # common root behind the retainer keeps the printable pin connected.
            xy = pin.bounds.mean(axis=0)[:2]
            for z, components in ((0, 2), (grip-.5, 1)):
                slab = trimesh.creation.box(extents=[10, 10, .2])
                slab.apply_translation([*xy, z])
                section = trimesh.boolean.intersection([pin, slab], engine="manifold")
                self.assertEqual(len(section.split()), components)
            self.assertGreater(notes["snap_pin"]["barb_diameter_mm"], notes["snap_pin"]["bore_diameter_mm"])
            self.assertLess(notes["snap_pin"]["shaft_diameter_mm"], notes["snap_pin"]["bore_diameter_mm"])
        names = list(parts)
        for i, first in enumerate(names):
            for second in names[i+1:]:
                overlap = trimesh.boolean.intersection([parts[first], parts[second]], engine="manifold")
                self.assertLess(abs(overlap.volume), 1e-5, f"snap {first}/{second}")

    def test_snap_preview_export_and_head_down_plate_match_for_each_style(self):
        for style in FRAME_STYLES:
            settings = Settings(33, 33, 2.5, 125, frame_style=style, retention_style="snap")
            result = preview(ellipse(25, 19), ellipse(23, 17), settings)
            self.assertEqual(result["retentionStyle"], "snap")
            meshes = {p["name"]: trimesh.Trimesh(vertices=p["vertices"], faces=p["faces"])
                      for p in result["meshes"] if p["kind"] == "printed"}
            archive, notes = generate(ellipse(25, 19), ellipse(23, 17), settings)
            with ZipFile(io.BytesIO(archive)) as files:
                self.assertEqual(len([n for n in files.namelist() if n.endswith(".stl")]), 14)
                for name, expected in meshes.items():
                    actual = trimesh.load(io.BytesIO(files.read(name+".stl")), file_type="stl")
                    self.assertTrue(actual.is_watertight, name)
                    np.testing.assert_allclose(actual.bounds, expected.bounds, atol=1e-4)
                plate = trimesh.load(io.BytesIO(files.read("plate.stl")), file_type="stl")
            pieces = list(plate.split())
            self.assertEqual(len(pieces), 13)
            for piece in pieces:
                self.assertAlmostEqual(piece.bounds[0, 2], 0, places=5)
                self.assertGreater(bed_contact_area(piece), 15)
                self.assertLessEqual(piece.bounds[1, 0], 220+1e-5)
                self.assertLessEqual(piece.bounds[1, 1], 220+1e-5)
            for i, first in enumerate(pieces):
                for second in pieces[i+1:]:
                    gap = np.maximum(first.bounds[0, :2]-second.bounds[1, :2],
                                     second.bounds[0, :2]-first.bounds[1, :2])
                    self.assertGreaterEqual(max(gap), 6-1e-5)

    def test_snap_rejects_bad_retention_and_undersized_bed_without_bypassing_geometry(self):
        with self.assertRaisesRegex(ValueError, "Retention style"):
            build_parts(ellipse(25, 19), ellipse(23, 17), Settings(33, 33, 2.5, 125, retention_style="glue"))
        with self.assertRaisesRegex(ValueError, "full 13-part kit"):
            generate(ellipse(25, 19), ellipse(23, 17), Settings(33, 33, 2.5, 125, 150, 70, retention_style="snap"))
        with self.assertRaisesRegex(ValueError, "outer rims.*clearance"):
            build_parts(ellipse(25, 19), ellipse(23, 17), Settings(27, 27, 2.5, 125, retention_style="snap"))

    def test_snap_pin_positions_follow_real_asymmetric_rim_stock(self):
        payload = json.loads((Path(__file__).parent / "fixtures" / "scanned-lens-outlines.json").read_text())
        settings = Settings(**dict(payload["settings"], retention_style="snap"))
        parts, lenses, _ = build_parts(payload["left"], payload["right"], settings)
        for side, lens in zip(("left", "right"), lenses):
            rim = _outer_profile(lens, settings.frame_style).difference(lens.buffer(-.7))
            for index in range(1, 5):
                pin = parts[f"{side}-snap-pin-{index}"]
                centre = pin.bounds.mean(axis=0)[:2]
                self.assertTrue(rim.contains(Point(centre).buffer(2.5)))
                self.assertGreaterEqual(Point(centre).distance(lens), 2.10)
                for assembly_part in ("front", side+"-retainer"):
                    overlap = trimesh.boolean.intersection([pin, parts[assembly_part]], engine="manifold")
                    self.assertLess(abs(overlap.volume), 1e-5)

    def test_style_profiles_add_material_without_changing_lens_openings(self):
        lens = _polygon(ellipse(25, 19), -1, 33)
        base = lens.buffer(5.3, join_style=1)
        self.assertTrue(_outer_profile(lens, "classic").equals_exact(base, 0))
        for style in FRAME_STYLES:
            outer = _outer_profile(lens, style)
            self.assertTrue(outer.is_valid)
            self.assertLess(base.difference(outer).area, 1e-8)
            # The styled ring's only opening remains the exact measured lip.
            lip = lens.buffer(-.7, join_style=1)
            ring = outer.difference(lip)
            self.assertEqual(len(ring.interiors), 1)
            self.assertLess(Polygon(ring.interiors[0]).symmetric_difference(lip).area, 1e-8)
        brow = _outer_profile(lens, "brow")
        np.testing.assert_allclose(brow.bounds[:3], base.bounds[:3])
        self.assertAlmostEqual(brow.bounds[3] - base.bounds[3], 2)
        self.assertGreater(_outer_profile(lens, "bold").area, base.area)

    def test_all_styles_export_preview_geometry_with_clear_lens_seats_and_hinges(self):
        left, right = ellipse(25, 19), ellipse(23, 17)
        volumes = []
        for style in FRAME_STYLES:
            with self.subTest(style=style):
                settings = Settings(33, 33, 2.5, 125, frame_style=style)
                result = preview(left, right, settings)
                self.assertEqual(result["frameStyle"], style)
                self.assertEqual(result["opticalCentres"], [[-33, 0, 2.15], [33, 0, 2.15]])
                meshes = {part["name"]: trimesh.Trimesh(vertices=part["vertices"], faces=part["faces"])
                          for part in result["meshes"]}
                np.testing.assert_allclose(meshes["left-lens"].bounds,
                                           [[-58, -19, 2.15], [-8, 19, 4.65]])
                data, notes = generate(left, right, settings)
                self.assertEqual(notes["frame_style"], style)
                with ZipFile(io.BytesIO(data)) as archive:
                    for name in notes["parts"]:
                        mesh = trimesh.load(io.BytesIO(archive.read(name + ".stl")), file_type="stl")
                        self.assertTrue(mesh.is_watertight, name)
                        self.assertGreater(mesh.volume, 0, name)
                        np.testing.assert_allclose(mesh.bounds, meshes[name].bounds, atol=1e-4)
                        self.assertAlmostEqual(mesh.volume, meshes[name].volume, delta=.02)
                        # Use validated STL solids for assembly collision tests;
                        # lightweight preview coordinates are rounded to 5 places.
                        meshes[name] = mesh
                volumes.append(meshes["front"].volume)
                names = list(meshes)
                for i, first in enumerate(names):
                    for second in names[i + 1:]:
                        overlap = trimesh.boolean.intersection([meshes[first], meshes[second]], engine="manifold")
                        self.assertLess(abs(overlap.volume), 1e-5, f"{style}: {first}/{second}")
        self.assertGreater(volumes[1], volumes[0])
        self.assertGreater(volumes[2], volumes[0])

    def test_unknown_style_and_too_close_bold_rims_are_rejected(self):
        for style in ("unknown", "Classic", None):
            with self.subTest(style=style), self.assertRaisesRegex(ValueError, "Frame style"):
                build_parts(ellipse(25, 19), ellipse(23, 17), Settings(32, 31, 2.5, 125, frame_style=style))
        # Enlarging the outer silhouette must not bypass the inter-rim clearance gate.
        build_parts(ellipse(25, 19), ellipse(23, 17), Settings(30, 30, 2.5, 125))
        with self.assertRaisesRegex(ValueError, "outer rims.*clearance"):
            build_parts(ellipse(25, 19), ellipse(23, 17), Settings(30, 30, 2.5, 125, frame_style="bold"))

    def test_dense_adjacent_samples_are_not_a_narrow_lens(self):
        points = ellipse(25, 19, 2000)
        points.insert(35, points[35][:])
        self.assertLess(Polygon(points).minimum_clearance, 0.2)
        polygon = _polygon(points, 1, 0)
        original = Polygon([[x, -y] for x, y in points])
        self.assertTrue(polygon.is_valid)
        self.assertLessEqual(original.boundary.hausdorff_distance(polygon.boundary),
                             OUTLINE_SIMPLIFICATION_MM + 1e-9)

    def test_true_narrow_neck_and_crossed_edges_remain_rejected(self):
        neck = [[-25,-15],[-5,-15],[-5,-.05],[5,-.05],[5,-15],[25,-15],
                [25,15],[5,15],[5,.05],[-5,.05],[-5,15],[-25,15]]
        with self.assertRaisesRegex(ValueError, "narrow or nearly crossed"):
            _polygon(neck, 1, 0)
        crossed = ellipse(25, 19)
        crossed[0], crossed[48] = crossed[48], crossed[0]
        with self.assertRaisesRegex(ValueError, "simple, plausible"):
            _polygon(crossed, 1, 0)

    def test_real_scanned_lens_outlines_generate_preview_and_closed_print_kit(self):
        payload = json.loads((Path(__file__).parent / 'fixtures' / 'scanned-lens-outlines.json').read_text())
        settings = Settings(**payload['settings'])
        result = preview(payload['left'], payload['right'], settings)
        self.assertEqual(len(result['meshes']), 7)
        archive, notes = generate(payload['left'], payload['right'], settings)
        self.assertEqual(notes['outline_cleanup_max_boundary_deviation_mm'], .05)
        with ZipFile(io.BytesIO(archive)) as files:
            self.assertEqual(len([name for name in files.namelist() if name.endswith('.stl')]), 6)
            for name in files.namelist():
                if name.endswith('.stl'):
                    mesh = trimesh.load(io.BytesIO(files.read(name)), file_type='stl')
                    self.assertTrue(mesh.is_watertight, name)
                    self.assertGreater(mesh.volume, 0, name)

    def test_independent_edge_thickness_and_optical_centre_height(self):
        settings = Settings(32, 31, 2.5, 125, left_edge_thickness=1.4,
                            right_edge_thickness=4.2, left_vertical_offset=3,
                            right_vertical_offset=-2)
        left, right = ellipse(25, 19), ellipse(23, 17)
        assembly = preview(left, right, settings)
        meshes = {part["name"]: trimesh.Trimesh(vertices=part["vertices"], faces=part["faces"])
                  for part in assembly["meshes"]}
        np.testing.assert_allclose(meshes["left-lens"].bounds,
                                   [[-57, -16, 2.15], [-7, 22, 3.55]], atol=1e-4)
        np.testing.assert_allclose(meshes["right-lens"].bounds,
                                   [[8, -19, 2.15], [54, 15, 6.35]], atol=1e-4)
        self.assertEqual(assembly["opticalCentres"], [[-32, 3, 2.15], [31, -2, 2.15]])
        data, notes = generate(left, right, settings)
        self.assertEqual(notes["lens_edge_thickness_mm"], {"left": 1.4, "right": 4.2})
        self.assertEqual(notes["optical_centre_vertical_offset_mm"], {"left": 3, "right": -2})
        with ZipFile(io.BytesIO(data)) as archive:
            printed = {name: trimesh.load(io.BytesIO(archive.read(name + ".stl")), file_type="stl")
                       for name in notes["parts"]}
            for side, thickness in (("left", 1.4), ("right", 4.2)):
                retainer = printed[side + "-retainer"]
                self.assertAlmostEqual(retainer.bounds[0, 2], 2.3 + thickness, places=5)
                np.testing.assert_allclose(retainer.bounds, meshes[side + "-retainer"].bounds, atol=1e-4)
            face = printed["front"]
            self.assertAlmostEqual(face.bounds[1, 2], 2.3 + 4.2, places=4)
            for index, first in enumerate(printed):
                for second in list(printed)[index + 1:]:
                    intersection = trimesh.boolean.intersection(
                        [printed[first], printed[second]], engine="manifold")
                    self.assertLess(abs(intersection.volume), 1e-5, f"{first}/{second}")

    def test_rejects_invalid_independent_fitting_values(self):
        for changes, expected in (
            ({"left_edge_thickness": float("nan")}, "edge thickness"),
            ({"right_edge_thickness": 6.1}, "edge thickness"),
            ({"left_vertical_offset": float("inf")}, "vertical offset"),
            ({"right_vertical_offset": -10.1}, "vertical offset"),
        ):
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, expected):
                preview(ellipse(25, 19), ellipse(23, 17), Settings(32, 31, 2.5, 125, **changes))

    def test_preview_matches_assembly_export_and_independent_lens_positions(self):
        settings = Settings(32, 31, 2.5, 125)
        left, right = ellipse(25, 19), ellipse(23, 17)
        result = preview(left, right, settings)
        meshes = {part["name"]: trimesh.Trimesh(vertices=part["vertices"], faces=part["faces"])
                  for part in result["meshes"]}
        self.assertEqual(len(meshes), 7)
        archive_bytes, notes = generate(left, right, settings)
        with ZipFile(io.BytesIO(archive_bytes)) as archive:
            for name in notes["parts"]:
                exported = trimesh.load(io.BytesIO(archive.read(name + ".stl")), file_type="stl")
                np.testing.assert_allclose(meshes[name].bounds, exported.bounds, atol=1e-4)
                self.assertAlmostEqual(meshes[name].volume, exported.volume, delta=0.02)
        np.testing.assert_allclose(meshes["left-lens"].bounds, [[-57, -19, 2.15], [-7, 19, 4.65]])
        np.testing.assert_allclose(meshes["right-lens"].bounds, [[8, -17, 2.15], [54, 17, 4.65]])
        self.assertEqual(result["opticalCentres"], [[-32, 0, 2.15], [31, 0, 2.15]])
        # Preview remains available to inspect an assembly before choosing a larger bed.
        self.assertEqual(len(preview(left, right, Settings(32, 31, 2.5, 125, 150, 70))["meshes"]), 7)

    def test_asymmetric_kit_has_watertight_parts(self):
        archive_bytes, notes = generate(ellipse(25, 19), ellipse(23, 17),
                                        Settings(32, 31, 2.5, 125))
        self.assertTrue(notes["bedFit"])
        with ZipFile(io.BytesIO(archive_bytes)) as archive:
            for part in notes["parts"]:
                mesh = trimesh.load(io.BytesIO(archive.read(f"{part}.stl")), file_type="stl")
                self.assertTrue(mesh.is_watertight, part)
                self.assertGreater(mesh.volume, 0, part)

    def test_plate_contains_five_flat_separated_parts_inside_bed(self):
        settings = Settings(32, 31, 2.5, 125, 220, 180)
        archive_bytes, notes = generate(ellipse(25, 19), ellipse(23, 17), settings)
        with ZipFile(io.BytesIO(archive_bytes)) as archive:
            plate_bytes = archive.read("plate.stl")
            # Binary STL: 80-byte header, triangle count, 50 bytes per triangle.
            triangles = int.from_bytes(plate_bytes[80:84], "little")
            self.assertEqual(len(plate_bytes), 84 + 50 * triangles)
            plate = trimesh.load(io.BytesIO(plate_bytes), file_type="stl")
            components = list(plate.split(only_watertight=False))
            self.assertEqual(len(components), 5)
            originals = [trimesh.load(io.BytesIO(archive.read(f"{name}.stl")), file_type="stl")
                         for name in notes["parts"]]
        self.assertTrue(notes["bedFit"])
        self.assertTrue(plate.is_watertight)
        np.testing.assert_allclose(sorted(mesh.volume for mesh in components),
                                   sorted(mesh.volume for mesh in originals), rtol=1e-5)
        for mesh in components:
            self.assertTrue(mesh.is_watertight)
            self.assertGreater(mesh.volume, 0)
            self.assertAlmostEqual(mesh.bounds[0, 2], 0, places=5)
            self.assertGreaterEqual(mesh.bounds[0, 0], -1e-5)
            self.assertGreaterEqual(mesh.bounds[0, 1], -1e-5)
            self.assertLessEqual(mesh.bounds[1, 0], settings.bed_width + 1e-5)
            self.assertLessEqual(mesh.bounds[1, 1], settings.bed_depth + 1e-5)
            self.assertLessEqual(mesh.extents[2], 14.01)
            self.assertGreater(bed_contact_area(mesh), 300)
        for i, first in enumerate(components):
            for second in components[i + 1:]:
                # At least one projected axis must have the requested clear gap.
                clearances = np.maximum(first.bounds[0, :2] - second.bounds[1, :2],
                                        second.bounds[0, :2] - first.bounds[1, :2])
                self.assertGreaterEqual(max(clearances), 6 - 1e-5)

    def test_thin_lens_plate_still_has_broad_contact(self):
        data, _ = generate(ellipse(25, 19), ellipse(23, 17), Settings(32, 31, 1, 125))
        with ZipFile(io.BytesIO(data)) as archive:
            plate = trimesh.load(io.BytesIO(archive.read("plate.stl")), file_type="stl")
        components = plate.split(only_watertight=False)
        self.assertEqual(len(components), 5)
        for mesh in components:
            self.assertGreater(bed_contact_area(mesh), 300)
            self.assertAlmostEqual(mesh.bounds[0, 2], 0, places=5)

    def test_assembly_hinge_bores_share_raised_axis(self):
        data, _ = generate(ellipse(25, 19), ellipse(23, 17), Settings(32, 31, 2.5, 125))
        with ZipFile(io.BytesIO(data)) as archive:
            front = trimesh.load(io.BytesIO(archive.read("front.stl")), file_type="stl")
            self.assertAlmostEqual(front.bounds[0, 2], 0, places=5)
            for name, pivot_x in (("left-temple", -32 - 25 - 5.3 - 8),
                                  ("right-temple", 31 + 23 + 5.3 + 8)):
                temple = trimesh.load(io.BytesIO(archive.read(f"{name}.stl")), file_type="stl")
                for mesh in (front, temple):
                    radial = np.hypot(mesh.vertices[:, 0] - pivot_x, mesh.vertices[:, 2] - 3)
                    bore_vertices = mesh.vertices[np.abs(radial - 1.1) < 1e-4]
                    self.assertGreaterEqual(len(bore_vertices), 32)
                    self.assertAlmostEqual(bore_vertices[:, 2].min(), 1.9, places=4)
                    self.assertAlmostEqual(bore_vertices[:, 2].max(), 4.1, places=4)

    def test_assembled_parts_do_not_intersect(self):
        for left_radii, right_radii, settings in (
                ((25, 19), (23, 17), Settings(32, 31, 2.5, 125)),
                ((23, 17), (25, 19), Settings(31, 32, 1, 90)),
                ((22, 20), (24, 16), Settings(30, 33, 6, 180))):
            with self.subTest(settings=settings):
                data, notes = generate(ellipse(*left_radii), ellipse(*right_radii), settings)
                with ZipFile(io.BytesIO(data)) as archive:
                    meshes = {name: trimesh.load(io.BytesIO(archive.read(f"{name}.stl")),
                                                file_type="stl") for name in notes["parts"]}
                names = list(meshes)
                for i, first in enumerate(names):
                    for second in names[i + 1:]:
                        intersection = trimesh.boolean.intersection(
                            [meshes[first], meshes[second]], engine="manifold")
                        self.assertLess(abs(intersection.volume), 1e-5, f"{first}/{second}")
                for name in ("left-retainer", "right-retainer"):
                    self.assertAlmostEqual(meshes[name].bounds[0, 2],
                                           2 + settings.edge_thickness + 0.3, places=5)

    def test_full_kit_rejects_bed_that_only_fits_individual_parts(self):
        with self.assertRaisesRegex(ValueError, "full five-part kit.*6 mm separation"):
            generate(ellipse(25, 19), ellipse(23, 17), Settings(32, 31, 2.5, 125, 150, 70))

    def test_invalid_bed_dimensions_are_rejected(self):
        for width in (0, -1, float("nan"), float("inf")):
            with self.subTest(width=width), self.assertRaisesRegex(ValueError, "finite positive"):
                generate(ellipse(25, 19), ellipse(23, 17), Settings(32, 31, 2.5, 125, width, 220))

    def test_overlapping_lenses_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "overlap"):
            generate(ellipse(27, 20), ellipse(27, 20), Settings(24, 24, 2, 125))

    def test_overlapping_outer_rims_are_rejected_even_when_lenses_clear(self):
        with self.assertRaisesRegex(ValueError, "outer rims and rear retainers overlap"):
            generate(ellipse(25, 19), ellipse(23, 17), Settings(27, 27, 2.5, 125))


if __name__ == "__main__":
    unittest.main()
