import unittest

import cv2
import numpy as np

from preprocess import isolate_lens, restore_lens_mask, restore_best_lens_mask, detect_sheet


class LensPreprocessTests(unittest.TestCase):
    def test_known_sheet_limits_wide_prompt_but_preserves_pixels(self):
        source = np.full((480, 640, 3), 220, np.uint8)
        corners = [(120, 120), (520, 120), (520, 400), (120, 400)]
        for x in range(120, 521, 20):
            cv2.line(source, (x, 120), (x, 400), (150, 150, 150), 1)
        for x, y in corners:
            cv2.rectangle(source, (x - 12, y - 12), (x + 12, y + 12), (20, 20, 20), -1)
            cv2.circle(source, (x, y), 3, (230, 230, 230), -1)
        original = source.copy()
        sheet = detect_sheet(source)
        self.assertIsNotNone(sheet)
        crop = isolate_lens(source, (80, 90, 560, 430))
        self.assertLess(crop.box[2] - crop.box[0], 300)
        self.assertLess(crop.box[3] - crop.box[1], 240)
        left, top = crop.origin
        np.testing.assert_array_equal(crop.image, source[top:top + crop.image.shape[0], left:left + crop.image.shape[1]])
        np.testing.assert_array_equal(source, original)

    def test_solid_dark_squares_are_not_calibration_markers(self):
        source = np.full((480, 640, 3), 220, np.uint8)
        for x, y in [(120, 120), (520, 120), (520, 400), (120, 400)]:
            cv2.rectangle(source, (x - 12, y - 12), (x + 12, y + 12), (20, 20, 20), -1)
        self.assertIsNone(detect_sheet(source))

    def test_crowded_marker_pattern_is_not_arbitrarily_used_as_sheet(self):
        source = np.full((1000, 1200, 3), 220, np.uint8)
        for x in range(100, 1001, 200):
            for y in range(100, 701, 200):
                cv2.rectangle(source, (x - 12, y - 12), (x + 12, y + 12), (20, 20, 20), -1)
                cv2.circle(source, (x, y), 3, (230, 230, 230), -1)
        self.assertIsNone(detect_sheet(source))

    def test_grid_spur_is_rejected_instead_of_smoothed_into_lens(self):
        crop = isolate_lens(np.zeros((400, 600, 3), np.uint8), (160, 100, 440, 300))
        mask = np.zeros(crop.image.shape[:2], np.uint8)
        cv2.ellipse(mask, (190, 150), (90, 60), 0, 0, 360, 255, -1)
        cv2.rectangle(mask, (185, 30), (195, 100), 255, -1)
        with self.assertRaisesRegex(ValueError, 'irregular'):
            restore_lens_mask(mask, crop)

    def test_isolates_text_and_maps_edge_back_without_scaling(self):
        source = np.full((400, 700, 3), 210, np.uint8)
        cv2.putText(source, 'PRINTED PAGE', (15, 40), cv2.FONT_HERSHEY_SIMPLEX,
                    1, (0, 0, 0), 2)
        original = source.copy()
        crop = isolate_lens(source, (380, 150, 580, 290))
        self.assertEqual(crop.origin, (344, 114))
        self.assertEqual(crop.box, (36, 36, 236, 176))
        self.assertTrue(np.all(crop.image == 210))
        mask = np.zeros(crop.image.shape[:2], np.uint8)
        cv2.ellipse(mask, (136, 106), (80, 50), 0, 0, 360, 255, -1)
        restored = restore_lens_mask(mask, crop)
        ys, xs = np.nonzero(restored)
        self.assertEqual((xs.min(), xs.max(), ys.min(), ys.max()), (400, 560, 170, 270))
        self.assertTrue(np.array_equal(source, original))

    def test_rejects_crop_rectangle_instead_of_making_a_fake_lens(self):
        crop = isolate_lens(np.zeros((300, 400, 3), np.uint8), (100, 80, 300, 220))
        with self.assertRaisesRegex(ValueError, 'boundary'):
            restore_lens_mask(np.ones(crop.image.shape[:2], np.uint8), crop)

    def test_ignores_disconnected_print_and_keeps_target_component(self):
        crop = isolate_lens(np.zeros((400, 600, 3), np.uint8), (200, 140, 400, 260))
        mask = np.zeros(crop.image.shape[:2], np.uint8)
        cv2.rectangle(mask, (0, 0), (20, 190), 255, -1)
        cv2.ellipse(mask, (136, 96), (60, 40), 0, 0, 360, 255, -1)
        restored = restore_lens_mask(mask, crop)
        self.assertEqual(restored[200, 300], 255)
        self.assertEqual(restored[150, 170], 0)

    def test_clamps_crop_at_image_boundary_without_changing_coordinates(self):
        source = np.zeros((100, 150, 3), np.uint8)
        crop = isolate_lens(source, (4, 5, 64, 75))
        self.assertEqual(crop.origin, (0, 0))
        self.assertEqual(crop.box, (4, 5, 64, 75))
        self.assertFalse(np.shares_memory(crop.image, source))

    def test_wrong_mask_size_and_missing_target_are_rejected(self):
        crop = isolate_lens(np.zeros((100, 150, 3), np.uint8), (40, 25, 100, 75))
        with self.assertRaisesRegex(ValueError, 'size'):
            restore_lens_mask(np.zeros((10, 10), np.uint8), crop)
        with self.assertRaisesRegex(ValueError, 'target'):
            restore_lens_mask(np.zeros(crop.image.shape[:2], np.uint8), crop)

    def test_skips_high_confidence_background_in_favor_of_closed_lens(self):
        crop = isolate_lens(np.zeros((300, 400, 3), np.uint8), (100, 80, 300, 220))
        background = np.ones(crop.image.shape[:2], np.uint8)
        lens = np.zeros_like(background)
        cv2.ellipse(lens, (136, 106), (70, 45), 0, 0, 360, 255, -1)
        restored = restore_best_lens_mask(np.stack([background, lens]), np.array([.99, .8]), crop)
        self.assertEqual(restored[150, 200], 255)
        self.assertEqual(restored[50, 80], 0)


if __name__ == '__main__':
    unittest.main()
