"""Geometric tests only: printed hinge retention/fatigue needs physical coupons."""
import unittest

import numpy as np
import trimesh

from frame import Settings, FRAME_STYLES, build_parts, _hinge_bore, _temple
from test_frame import ellipse


class PrintedHingeTests(unittest.TestCase):
    def test_all_styles_have_two_clear_closed_printed_hinges(self):
        for style in FRAME_STYLES:
            with self.subTest(style=style):
                parts, _, notes = build_parts(ellipse(25, 19), ellipse(23, 17),
                    Settings(33, 33, 2.5, 125, frame_style=style, retention_style="snap"))
                self.assertEqual(len([name for name in parts if "snap-pin" in name]), 10)
                self.assertIn("No metal screws or nuts required", notes["hardware"])
                self.assertAlmostEqual(notes["hinge_pin"]["grip_length_mm"], 13.9)
                for side in ("left", "right"):
                    pin = parts[f"{side}-hinge-snap-pin"]
                    self.assertTrue(pin.is_watertight)
                    self.assertEqual(len(pin.split()), 1)
                    self.assertGreater(pin.volume, 0)
                    # Symmetric radial envelope yields the actual shared axis.
                    x = pin.bounds.mean(axis=0)[0]
                    y = pin.bounds[1, 1] - 8.45
                    np.testing.assert_allclose(pin.bounds[:, 2], [.5, 5.5], atol=1e-5)
                    np.testing.assert_allclose(pin.bounds[:, 1], [y-8.5, y+8.45], atol=1e-5)
                    # Nominal bore leaves 0.2 mm radial clearance around shaft.
                    bore_clearance = _hinge_bore(x, y, 3, 13.9, radius=1.65)
                    for name in ("front", f"{side}-temple"):
                        overlap = trimesh.boolean.intersection([pin, parts[name]], engine="manifold")
                        self.assertLess(abs(overlap.volume), 1e-5, f"{style}: {name}/pin")
                        overlap = trimesh.boolean.intersection([bore_clearance, parts[name]], engine="manifold")
                        self.assertLess(abs(overlap.volume), 1e-5, f"{style}: {name}/bore")
                    overlap = trimesh.boolean.intersection([parts["front"], parts[f"{side}-temple"]], engine="manifold")
                    self.assertLess(abs(overlap.volume), 1e-5)
                    # The fork extends ahead of the widened bore with substantial
                    # stock; an old screw fork would leave just 0.3 mm here.
                    self.assertAlmostEqual(parts[f"{side}-temple"].bounds[1, 2], 7, places=5)
                    self.assertGreater(7-(3+1.7), 2)

    def test_screw_temples_keep_the_original_envelope_and_have_no_printed_pins(self):
        for style in FRAME_STYLES:
            for side in (-1, 1):
                original = _temple(side, 125, side*65, 0, style)
                explicit = _temple(side, 125, side*65, 0, style, "screw")
                np.testing.assert_array_equal(original.vertices, explicit.vertices)
                np.testing.assert_array_equal(original.faces, explicit.faces)
                self.assertAlmostEqual(original.bounds[1, 2], 5)
        parts, _, notes = build_parts(ellipse(25, 19), ellipse(23, 17), Settings(33, 33, 2.5, 125))
        self.assertEqual(len(parts), 5)
        self.assertFalse(any("snap-pin" in name for name in parts))
        self.assertIn("two M2 hinge screws", notes["hardware"])


if __name__ == "__main__":
    unittest.main()
