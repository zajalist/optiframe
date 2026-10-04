import unittest

import cv2
import numpy as np

from edge_refine import refine_lens_edge


def ellipse():
    angles = np.linspace(0, 2*np.pi, 256, endpoint=False)
    return np.column_stack([160+100*np.cos(angles), 140+75*np.sin(angles)]).astype(np.float32)


class EdgeRefineTests(unittest.TestCase):
    def test_blank_does_not_manufacture_an_edge(self):
        raw = ellipse().tolist()
        refined, info = refine_lens_edge(np.full((280, 320, 3), 220, np.uint8), raw)
        self.assertFalse(info['accepted'])
        self.assertEqual(refined, raw)

    def test_empty_grid_does_not_support_a_lens(self):
        image = np.full((280, 320, 3), 220, np.uint8)
        for x in range(0, 320, 20):
            cv2.line(image, (x, 0), (x, 279), (160, 160, 160), 1)
        for y in range(0, 280, 20):
            cv2.line(image, (0, y), (319, y), (160, 160, 160), 1)
        self.assertFalse(refine_lens_edge(image, ellipse())[1]['accepted'])

    def test_dark_lens_preserves_dimensions(self):
        image = np.full((280, 320, 3), 220, np.uint8)
        cv2.ellipse(image, (160, 140), (100, 75), 0, 0, 360, (30, 30, 30), -1, cv2.LINE_AA)
        refined, info = refine_lens_edge(image, ellipse())
        self.assertTrue(info['accepted'], info)
        self.assertLess(float(np.max(abs(np.ptp(np.asarray(refined), axis=0)-[200, 150]))), 3)

    def test_two_comparable_boundaries_are_rejected_instead_of_chosen_arbitrarily(self):
        image = np.full((280, 320, 3), 220, np.uint8)
        for axes in [(100, 75), (108, 83)]:
            cv2.ellipse(image, (160, 140), axes, 0, 0, 360, (100, 100, 100), 1, cv2.LINE_AA)
        refined, info = refine_lens_edge(image, ellipse())
        self.assertFalse(info['accepted'])
        self.assertEqual(info['reason'], 'competing-edges')
        self.assertEqual(refined, ellipse().tolist())

    def test_soft_offset_cast_shadow_does_not_pull_clean_rim_outward(self):
        image = np.full((280, 320, 3), 220, np.uint8)
        shadow = np.zeros(image.shape[:2], np.uint8)
        cv2.ellipse(shadow, (168, 148), (100, 75), 0, 0, 360, 60, -1)
        shadow = cv2.GaussianBlur(shadow, (0, 0), 5)
        image = np.clip(image.astype(float)-shadow[:, :, None], 0, 255).astype(np.uint8)
        cv2.ellipse(image, (160, 140), (100, 75), 0, 0, 360, (105, 105, 105), 1, cv2.LINE_AA)
        refined, info = refine_lens_edge(image, ellipse())
        self.assertTrue(info['accepted'], info)
        self.assertLess(float(np.max(abs(np.ptp(np.asarray(refined), axis=0)-[200, 150]))), 3)

    def test_broad_corners_are_not_replaced_with_an_ellipse(self):
        image = np.full((300, 340, 3), 220, np.uint8)
        shape = np.array([[70, 65], [240, 65], [275, 95], [265, 200], [230, 235], [95, 225], [60, 180], [55, 95]], np.int32)
        mask = np.zeros(image.shape[:2], np.uint8)
        cv2.fillPoly(mask, [shape], 255)
        image[mask > 0] = 35
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        raw = contours[0].reshape(-1, 2)
        refined, info = refine_lens_edge(image, raw)
        # Either an image-supported local correction or honest rejection is safe.
        if info['accepted']:
            pts = np.asarray(refined)
            self.assertLess(np.linalg.norm(pts-[240, 65], axis=1).min(), 5)
            self.assertLess(np.linalg.norm(pts-[70, 65], axis=1).min(), 5)
        else:
            self.assertEqual(refined, raw.tolist())


if __name__ == '__main__':
    unittest.main()
