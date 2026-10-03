import unittest

import cv2
import numpy as np

from segment import contour_from_mask, difference_mask, enhance


class SegmentTests(unittest.TestCase):
    def test_detects_changed_lens_region(self):
        empty = np.full((300, 400, 3), 160, np.uint8)
        for x in range(0, 400, 15):
            cv2.line(empty, (x, 0), (x, 299), (90, 90, 90), 2)
        photo = empty.copy()
        cv2.ellipse(photo, (200, 150), (90, 60), 0, 0, 360, (210, 210, 210), -1)
        contour = contour_from_mask(difference_mask(photo, empty))
        self.assertGreater(len(contour), 8)
        self.assertLess(min(p[0] for p in contour), 130)
        self.assertGreater(max(p[0] for p in contour), 270)

    def test_enhancement_preserves_image_shape(self):
        image = np.zeros((20, 30, 3), np.uint8)
        self.assertEqual(enhance(image).shape, image.shape)


if __name__ == "__main__":
    unittest.main()
