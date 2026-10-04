import unittest
import numpy as np
import trimesh
from frame import Settings, build_parts
from test_frame import ellipse


class BridgeTransitionTests(unittest.TestCase):
    def test_bridge_reaches_rim_depth_without_a_recessed_step(self):
        parts, _, _ = build_parts(ellipse(25, 19), ellipse(23, 17), Settings(33, 33, 2.5, 125))
        # The bridge centre is between the lenses, at Y=17-8=9 mm.
        probe = trimesh.creation.box(extents=[1, 1, .2])
        probe.apply_translation([0, 9, 4.5])
        overlap = trimesh.boolean.intersection([parts['front'], probe], engine='manifold')
        self.assertAlmostEqual(overlap.volume, .2, places=4)

    def test_unequal_depth_bridge_stays_clear_of_lenses_and_retainers(self):
        for style in ('classic', 'bold', 'brow'):
            with self.subTest(style=style):
                parts, lenses, _ = build_parts(ellipse(25,19), ellipse(23,17),
                    Settings(33,33,2.5,125,left_edge_thickness=1,right_edge_thickness=6,frame_style=style))
                front=parts['front']
                self.assertTrue(front.is_watertight)
                self.assertEqual(len(front.split()),1)
                for name in ('left-retainer','right-retainer'):
                    overlap=trimesh.boolean.intersection([front,parts[name]],engine='manifold')
                    self.assertLess(abs(overlap.volume),1e-5)
                for lens,depth in zip(lenses,(1,6)):
                    solid=trimesh.creation.extrude_polygon(lens,height=depth,engine='earcut')
                    solid.apply_translation([0,0,2.15])
                    overlap=trimesh.boolean.intersection([front,solid],engine='manifold')
                    self.assertLess(abs(overlap.volume),1e-5)


if __name__ == '__main__':
    unittest.main()
