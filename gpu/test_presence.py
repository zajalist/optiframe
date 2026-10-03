import unittest
from unittest.mock import patch

import cv2
import numpy as np
from fastapi.testclient import TestClient

from presence import lens_presence
from segment import app, contour_from_mask, live_quality


def scene():
    image = np.full((480, 640, 3), 215, np.uint8)
    for x in range(120, 521, 20):
        cv2.line(image, (x, 120), (x, 400), (150, 150, 150), 1)
    for y in range(120, 401, 20):
        cv2.line(image, (120, y), (520, y), (150, 150, 150), 1)
    for x, y in [(120, 120), (520, 120), (520, 400), (120, 400)]:
        cv2.rectangle(image, (x-12, y-12), (x+12, y+12), (20, 20, 20), -1)
        cv2.circle(image, (x, y), 3, (230, 230, 230), -1)
    cv2.putText(image, 'OPTIFRAME', (120, 80), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 0), 2)
    return image


def oval():
    mask = np.zeros((480, 640), np.uint8)
    cv2.ellipse(mask, (320, 260), (110, 85), 0, 0, 360, 255, -1)
    return mask, contour_from_mask(mask)


class PresenceTests(unittest.TestCase):
    def test_empty_grid_and_blank_do_not_support_hallucinated_lens(self):
        _, contour = oval()
        for image in [scene(), np.full((480, 640, 3), 215, np.uint8)]:
            with self.subTest(grid=bool(image.var())):
                self.assertFalse(lens_presence(image, contour)['detected'])

    def test_grid_rectangle_and_text_fragment_are_not_lenses(self):
        image = scene()
        for contour in [[[120,120],[520,120],[520,400],[120,400]],
                        [[200,200],[210,200],[210,210],[200,210]],
                        [[100,100],[300,100],[300,120],[100,120]]]:
            self.assertFalse(lens_presence(image, contour)['detected'])

    def test_thin_transparent_rim_on_grid_and_dark_lens_remain_supported(self):
        mask, contour = oval()
        for thickness in (2, -1):
            image = scene()
            cv2.ellipse(image, (320,260), (110,85), 0, 0,360,(80,80,80),thickness)
            before = image.copy()
            result = lens_presence(image, contour)
            self.assertTrue(result['detected'], result)
            np.testing.assert_array_equal(image, before)

    def test_partial_edge_does_not_trigger_capture(self):
        _, contour = oval()
        image = np.full((480, 640, 3), 215, np.uint8)
        cv2.ellipse(image, (320,260),(110,85),0,0,150,(60,60,60),2)
        self.assertFalse(lens_presence(image, contour)['detected'])

    def test_white_paper_visible_through_lens_does_not_block_supported_edge(self):
        mask, contour = oval()
        # Clear glass over white paper has bright pixels both inside and out.
        image = np.full((480, 640, 3), 255, np.uint8)
        cv2.ellipse(image, (320,260), (110,85), 0,0,360,(80,80,80),2)
        self.assertTrue(lens_presence(image, contour)['detected'])
        quality = live_quality(image, contour, (160,140,480,380))
        self.assertGreater(quality['clippedFraction'], .9)
        self.assertGreaterEqual(quality['score'], .3)
        self.assertGreaterEqual(quality['sharpness'], 35)
        encoded = cv2.imencode('.jpg', image)[1].tobytes()
        with patch.dict('os.environ', {'OPTIFRAME_ACCESS_TOKEN': ''}), patch('segment.sam_mask', return_value=mask):
            response = TestClient(app).post('/api/live-segment', files={'image':('white.jpg',encoded,'image/jpeg')},
                                           data={'box':'[160,140,480,380]'})
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['presence']['detected'])
        self.assertGreaterEqual(response.json()['quality']['score'], .3)

    def test_no_lens_live_is_quiet_empty_photo_is_rejected(self):
        mask, _ = oval()
        image = cv2.imencode('.jpg', scene())[1].tobytes()
        client = TestClient(app)
        with patch.dict('os.environ', {'OPTIFRAME_ACCESS_TOKEN': ''}), patch('segment.sam_mask', return_value=mask):
            live = client.post('/api/live-segment', files={'image':('empty.jpg',image,'image/jpeg')},
                               data={'box':'[160, 140, 480, 380]'})
            self.assertEqual(live.status_code, 200)
            self.assertEqual(live.json()['contour'], [])
            self.assertFalse(live.json()['presence']['detected'])
            self.assertEqual(live.json()['quality']['score'], 0)
            photo = client.post('/api/segment', files={'image':('empty.jpg',image,'image/jpeg')},
                                data={'box':'[160, 140, 480, 380]'})
            self.assertEqual(photo.status_code, 422)

    def test_predictor_target_failure_is_normal_absence(self):
        image = cv2.imencode('.jpg', scene())[1].tobytes()
        with patch.dict('os.environ', {'OPTIFRAME_ACCESS_TOKEN': ''}), patch('segment.sam_mask', side_effect=ValueError('No closed edge')):
            response = TestClient(app).post('/api/live-segment', files={'image':('empty.jpg',image,'image/jpeg')},
                                           data={'box':'[160, 140, 480, 380]'})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['presence']['detected'])


if __name__ == '__main__':
    unittest.main()
