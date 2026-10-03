import io
import math
import unittest
from zipfile import ZipFile

import trimesh
import numpy as np

from frame import Settings, generate


def ellipse(rx, ry, count=96):
    return [[rx * math.cos(2 * math.pi * i / count),
             ry * math.sin(2 * math.pi * i / count)] for i in range(count)]


def bed_contact_area(mesh):
    """Area of horizontal mesh triangles at the floor, a geometric contact proxy."""
    at_floor = np.all(np.abs(mesh.triangles[:, :, 2]) < 1e-5, axis=1)
    return float(mesh.area_faces[at_floor].sum())


class FrameTests(unittest.TestCase):
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
