import unittest

import numpy as np
import trimesh

from frame import _temple, FRAME_STYLES, Settings, preview, build_parts
from test_frame import ellipse
from temple_brand import (apply_temple_brand, logo_polygons, ENGRAVING_DEPTH_MM,
                          LOGO_HEIGHT_MM)


class TempleBrandTests(unittest.TestCase):
    def test_both_sides_and_lengths_preserve_solid_envelope(self):
        expected = sum(p.area for p in logo_polygons()) * ENGRAVING_DEPTH_MM
        for side in (-1, 1):
            for length in (90, 125, 180):
                with self.subTest(side=side, length=length):
                    pivot_x, pivot_y = side * 64.25, 7.2
                    original = _temple(side, length, pivot_x, pivot_y)
                    branded = apply_temple_brand(original, side, pivot_x, pivot_y)
                    self.assertTrue(branded.is_volume)
                    self.assertTrue(branded.is_watertight)
                    self.assertEqual(len(branded.split()), 1)
                    np.testing.assert_allclose(branded.bounds, original.bounds, atol=1e-5)
                    self.assertAlmostEqual(original.volume - branded.volume, expected, delta=.005)
                    removed = trimesh.boolean.difference([original, branded], engine="manifold")
                    # Entire engraving stays behind the hinge and on the outside wall.
                    self.assertGreater(removed.bounds[0, 2], -42)
                    self.assertLess(removed.bounds[1, 2], -10)
                    self.assertAlmostEqual(removed.extents[0], .4, delta=1e-5)
                    self.assertLessEqual(removed.extents[1], LOGO_HEIGHT_MM + 1e-5)
                    outer_x = pivot_x + side * 9.5
                    self.assertAlmostEqual(removed.bounds[1 if side > 0 else 0, 0], outer_x, delta=1e-5)

    def test_wrong_geometry_is_rejected_without_modifying_original(self):
        original = _temple(1, 125, 64, 0)
        vertices = original.vertices.copy()
        with self.assertRaisesRegex(ValueError, "does not fit"):
            apply_temple_brand(original, 1, 80, 0)
        np.testing.assert_array_equal(original.vertices, vertices)
        for side in (0, 2):
            with self.assertRaisesRegex(ValueError, "valid side"):
                apply_temple_brand(original, side, 64, 0)

    def test_generated_wordmark_has_open_counters_and_finite_small_features(self):
        polygons = logo_polygons()
        self.assertEqual(len(polygons), 11)  # Nine letters, i dot, original spectacles symbol.
        self.assertEqual(sum(len(p.interiors) for p in polygons), 6)
        # At this discreet scale some strokes are below a 0.4 mm nozzle width.
        # The geometry remains present, but actual print legibility needs validation.
        self.assertTrue(all(not p.buffer(-.15).is_empty for p in polygons))
        self.assertAlmostEqual(max(p.bounds[3] for p in polygons), 2.6, places=5)
        self.assertAlmostEqual(max(p.bounds[2] for p in polygons), 21.535525, places=4)

    def test_actual_assembly_brands_only_wearer_left_for_every_style_and_retention(self):
        for style in FRAME_STYLES:
            for retention in ("screw", "snap"):
                settings = Settings(33, 33, 2.5, 125, frame_style=style, retention_style=retention)
                parts, _, notes = build_parts(ellipse(25, 19), ellipse(23, 17), settings)
                self.assertIn("branding", parts["left-temple"].metadata)
                self.assertNotIn("branding", parts["right-temple"].metadata)
                self.assertIn("right temple plain", notes["temple_branding"])
                result = preview(ellipse(25, 19), ellipse(23, 17), settings)
                self.assertEqual([m["name"] for m in result["meshes"] if "branding" in m], ["left-temple"])

    def test_preview_finish_selects_only_actual_engraved_floor_all_styles_sides(self):
        for style in FRAME_STYLES:
            for side in (-1, 1):
                mesh = apply_temple_brand(_temple(side, 125, side*64, 7, style), side, side*64, 7)
                metadata = mesh.metadata["branding"]
                indices = metadata["faceIndices"]
                triangles = mesh.triangles[indices]
                self.assertTrue(len(indices) > 20)
                self.assertEqual(metadata["finish"], "silver-infill-preview")
                self.assertAlmostEqual(mesh.area_faces[indices].sum(), sum(p.area for p in logo_polygons()), delta=.01)
                np.testing.assert_allclose(triangles[:, :, 0], side*(64+9.1), atol=2e-5)
                self.assertTrue(np.all(mesh.face_normals[indices, 0]*side > .999))
                self.assertAlmostEqual(metadata["centre"][2], -26.5, places=4)
                # The two uncut lens interiors in the symbol remain outside the selected finish.
                self.assertEqual(len(logo_polygons()[-1].interiors), 2)


if __name__ == "__main__":
    unittest.main()
