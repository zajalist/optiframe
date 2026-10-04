import unittest

import numpy as np
import trimesh

from frame import FRAME_STYLES, _temple, _hinge_bore, _block
from temple_brand import apply_temple_brand


class TempleStyleTests(unittest.TestCase):
    def test_all_styles_sides_lengths_are_single_branded_solids(self):
        for style in FRAME_STYLES:
            for side in (-1, 1):
                for length in (90, 125, 180):
                    with self.subTest(style=style, side=side, length=length):
                        mesh = _temple(side, length, side*64, 7, style)
                        branded = apply_temple_brand(mesh, side, side*64, 7)
                        self.assertTrue(branded.is_volume)
                        self.assertTrue(branded.is_watertight)
                        self.assertEqual(len(branded.split()), 1)
                        self.assertAlmostEqual(branded.bounds[0, 2], 2-length, places=4)
                        # Common outward plane is retained for printing and the actual engraving.
                        self.assertAlmostEqual(branded.bounds[1 if side > 0 else 0, 0], side*73.5, places=4)
                        self.assertGreater(mesh.volume-branded.volume, 1)

    def test_styles_have_distinct_physical_silhouettes(self):
        meshes = [_temple(1, 125, 64, 0, style) for style in FRAME_STYLES]
        # Slice well behind the common logo stock. Height is genuinely CAD geometry.
        slab = _block((30, 30, .2), (71, 0, -62))
        heights = [trimesh.boolean.intersection([mesh, slab], engine="manifold").extents[1]
                   for mesh in meshes]
        self.assertLess(heights[0], 5.5)
        self.assertAlmostEqual(heights[1], 9, places=3)
        self.assertAlmostEqual(heights[2], 8.5, places=3)
        self.assertEqual(len({round(mesh.volume) for mesh in meshes}), 3)
        for mesh in meshes:
            # Sloped facet normals prove a real bevel, not renderer smoothing.
            normals = np.abs(mesh.face_normals)
            self.assertGreater(np.count_nonzero((normals > .15).sum(axis=1) >= 2), 12)

    def test_hinge_bores_and_fork_gap_stay_clear_for_all_styles(self):
        for style in FRAME_STYLES:
            for side in (-1, 1):
                mesh = _temple(side, 125, side*64, 0, style)
                bore = _hinge_bore(side*64, 0, 3, 18)
                self.assertLess(abs(trimesh.boolean.intersection([mesh, bore], engine="manifold").volume), 1e-5)
                gap = _block((7, 8.8, 9), (side*64, 0, 0))
                self.assertLess(abs(trimesh.boolean.intersection([mesh, gap], engine="manifold").volume), 1e-5)

    def test_unbranded_temple_geometry_is_mirrored_between_sides(self):
        for style in FRAME_STYLES:
            left = _temple(-1, 125, -64, 0, style)
            right = _temple(1, 125, 64, 0, style)
            right.apply_scale([-1, 1, 1])
            overlap = trimesh.boolean.intersection([left, right], engine="manifold")
            self.assertAlmostEqual(left.volume, right.volume, places=3)
            self.assertAlmostEqual(overlap.volume, left.volume, places=3)


if __name__ == "__main__":
    unittest.main()
