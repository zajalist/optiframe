import unittest

import numpy as np
import trimesh

from frame import _temple
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
                    self.assertGreater(removed.bounds[0, 2], -40)
                    self.assertLess(removed.bounds[1, 2], -20)
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

    def test_generated_wordmark_has_open_counters_and_robust_strokes(self):
        polygons = logo_polygons()
        self.assertEqual(len(polygons), 10)  # Nine letters plus the dot of the i.
        self.assertEqual(sum(len(p.interiors) for p in polygons), 4)
        # Erosion at radius .2 mm leaves every letter/dot, a basic feature check
        # for a .4 mm nozzle. Physical slicing and legibility remain unverified.
        self.assertTrue(all(not p.buffer(-.2).is_empty for p in polygons))


if __name__ == "__main__":
    unittest.main()
