import unittest
from unittest.mock import patch

import numpy as np
from shapely.geometry import Polygon

from outline_finish import (MAX_BOUNDARY_SHIFT_MM, boundary_distance_upper_bound,
                            finish_outline)


def noisy_ellipse(seed=17, count=600):
    t = np.linspace(0, 2 * np.pi, count, endpoint=False)
    noise = np.random.default_rng(seed).uniform(-0.035, 0.035, count)
    return Polygon(np.column_stack([(25 + noise) * np.cos(t), (18 + noise) * np.sin(t)]))


def tangent_roughness(polygon):
    # Equal physical sample spacing makes input/output sampling density irrelevant.
    line = polygon.exterior
    points = np.array([line.interpolate(at).coords[0]
                       for at in np.linspace(0, line.length, 720, endpoint=False)])
    vectors = np.roll(points, -1, axis=0) - points
    following = np.roll(vectors, -1, axis=0)
    turns = np.arctan2(vectors[:, 0]*following[:, 1] - vectors[:, 1]*following[:, 0],
                      np.sum(vectors*following, axis=1))
    return float(np.mean(turns ** 2))


class OutlineFinishTests(unittest.TestCase):
    def assert_bounded(self, original, result):
        self.assertTrue(result.is_valid)
        self.assertEqual(len(result.interiors), 0)
        self.assertLessEqual(boundary_distance_upper_bound(original, result), MAX_BOUNDARY_SHIFT_MM)
        before = np.subtract(original.bounds[2:], original.bounds[:2])
        after = np.subtract(result.bounds[2:], result.bounds[:2])
        self.assertLessEqual(float(np.max(np.abs(after - before))), 0.1)
        self.assertLessEqual(abs(result.area / original.area - 1), 0.005)

    def test_seeded_pixel_jitter_reduced_without_changing_measured_scale(self):
        for seed in (17, 41, 93):
            with self.subTest(seed=seed):
                original = noisy_ellipse(seed)
                raw = original.wkb
                result = finish_outline(original)
                self.assert_bounded(original, result)
                self.assertLess(tangent_roughness(result), tangent_roughness(original) * 0.35)
                self.assertEqual(original.wkb, raw)
                self.assertGreater(len(result.exterior.coords), 96)

    def test_asymmetric_outline_and_sharp_corners_stay_bounded(self):
        original = Polygon([(-24, -16), (15, -17), (26, -10), (23, 15),
                            (7, 20), (-23, 13)])
        result = finish_outline(original)
        self.assert_bounded(original, result)
        self.assertEqual(result.exterior.is_ccw, original.exterior.is_ccw)
        # No ellipse fitting, hull replacement, centring or rescaling.
        self.assertGreater(result.bounds[3], 19.9)
        self.assertLess(result.bounds[0], -23.9)

    def test_clockwise_and_translated_inputs_preserve_placement(self):
        original = Polygon(np.asarray(noisy_ellipse().exterior.coords)[::-1] + [31, -4])
        result = finish_outline(original)
        self.assert_bounded(original, result)
        self.assertFalse(result.exterior.is_ccw)
        self.assertLess(result.centroid.distance(original.centroid), 0.02)

    def test_invalid_crossing_and_holes_are_never_repaired(self):
        for polygon in (Polygon([(0, 0), (20, 20), (0, 20), (20, 0)]),
                        Polygon([(0, 0), (30, 0), (30, 30), (0, 30)],
                                holes=[[(5, 5), (8, 5), (8, 8), (5, 8)]])):
            with self.assertRaises(ValueError):
                finish_outline(polygon)

    def test_narrow_physical_notch_rejected_before_smoothing(self):
        polygon = Polygon([(0, 0), (40, 0), (40, 30), (20.05, 30),
                           (20.05, 18), (19.95, 18), (19.95, 30), (0, 30)])
        self.assertTrue(polygon.is_valid)
        with self.assertRaisesRegex(ValueError, 'narrow'):
            finish_outline(polygon)

    def test_duplicate_vertices_do_not_break_periodic_interpolation(self):
        coords = list(noisy_ellipse().exterior.coords)
        coords.insert(10, coords[10])
        original = Polygon(coords)
        self.assert_bounded(original, finish_outline(original))

    def test_failed_certificate_returns_exact_original(self):
        original = noisy_ellipse()
        with patch('outline_finish.boundary_distance_upper_bound', return_value=1):
            self.assertIs(finish_outline(original), original)

    def test_certificate_includes_segment_interiors(self):
        first = Polygon([(0, 0), (50, 0), (50, 30), (0, 30)])
        second = Polygon([(0, 0.06), (50, 0.06), (50, 30.06), (0, 30.06)])
        bound = boundary_distance_upper_bound(first, second)
        self.assertGreaterEqual(bound, 0.06)
        self.assertLess(bound, 0.081)


if __name__ == '__main__':
    unittest.main()
