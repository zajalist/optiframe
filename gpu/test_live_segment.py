import json
import os
import unittest
from unittest.mock import patch

import cv2
import numpy as np
from fastapi.testclient import TestClient

from segment import app, live_quality


def jpeg(width=240, height=160):
    image = np.full((height, width, 3), 125, np.uint8)
    cv2.rectangle(image, (40, 30), (190, 130), (200, 200, 200), 2)
    return cv2.imencode('.jpg', image)[1].tobytes()


class LiveSegmentTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.headers = {'X-OptiFrame-Key': 'live-test'}
        self.auth = patch.dict(os.environ, {'OPTIFRAME_ACCESS_TOKEN': 'live-test'})
        self.auth.start()
        self.addCleanup(self.auth.stop)

    def post(self, image=None, box=None, headers=None):
        return self.client.post('/api/live-segment', headers=headers or self.headers,
            files={'image': ('frame.jpg', image or jpeg(), 'image/jpeg')},
            data={'box': json.dumps(box if box is not None else [20, 15, 220, 145])})

    def test_uses_shared_predictor_and_returns_contour_quality(self):
        mask = np.zeros((160, 240), np.uint8)
        cv2.ellipse(mask, (120, 80), (65, 45), 0, 0, 360, 255, -1)
        with patch('segment.sam_mask', return_value=mask) as predictor:
            response = self.post()
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual((result['width'], result['height']), (240, 160))
        self.assertGreater(len(result['contour']), 8)
        self.assertGreaterEqual(result['quality']['score'], 0)
        self.assertLessEqual(result['quality']['score'], 1)
        self.assertIn('proposal-only', result['measurementStatus'])
        predictor.assert_called_once()

    def test_invalid_box_and_oversize_frame_are_rejected(self):
        with patch('segment.sam_mask') as predictor:
            self.assertEqual(self.post(box=[0, 0, 10, 10]).status_code, 422)
            self.assertEqual(self.post(image=jpeg(1601, 100)).status_code, 422)
            self.assertEqual(self.post(image=b'bad').status_code, 422)
        predictor.assert_not_called()

    def test_large_upload_is_bounded_before_predictor(self):
        with patch('segment.sam_mask') as predictor:
            response = self.post(image=b'x' * 6_000_001)
        self.assertEqual(response.status_code, 413)
        predictor.assert_not_called()

    def test_auth_and_gpu_unavailable(self):
        self.assertEqual(self.post(headers={'X-OptiFrame-Key': 'wrong'}).status_code, 401)
        with patch('segment.sam_mask', side_effect=RuntimeError('CUDA unavailable')), \
                patch('segment.logging.exception'):
            response = self.post()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['detail'], 'GPU segmentation unavailable')

    def test_quality_is_deterministic_and_penalizes_glare(self):
        image = np.full((100, 100, 3), 120, np.uint8)
        contour = [[20, 20], [80, 20], [80, 80], [20, 80]]
        box = (10, 10, 90, 90)
        clear = live_quality(image, contour, box)
        self.assertEqual(clear, live_quality(image, contour, box))
        image[:] = 255
        self.assertEqual(live_quality(image, contour, box)['score'], 0)


if __name__ == '__main__':
    unittest.main()
