import json
import os
import unittest
from unittest.mock import patch

import cv2
import numpy as np
from fastapi.testclient import TestClient

from segment import app, ModelBusyError
from test_live_segment import jpeg


class SegmentBurstTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.headers = {'X-OptiFrame-Key': 'burst-test'}
        auth = patch.dict(os.environ, {'OPTIFRAME_ACCESS_TOKEN': 'burst-test'})
        auth.start()
        self.addCleanup(auth.stop)
        refiner = patch('segment.refine_lens_edge', side_effect=lambda image, contour:
                        (contour, {'accepted': True, 'method': 'test-supported-edge'}))
        refiner.start()
        self.addCleanup(refiner.stop)

    def post(self, images=None, boxes=None, headers=None):
        images = images if images is not None else [jpeg()] * 3
        return self.client.post('/api/segment-burst', headers=headers or self.headers,
            files=[('images', (f'frame-{i}.jpg', value, 'image/jpeg')) for i, value in enumerate(images)],
            data={'boxes': json.dumps(boxes if boxes is not None else [[20, 15, 220, 145]] * len(images))})

    @staticmethod
    def mask(photo, box):
        mask = np.zeros(photo.shape[:2], np.uint8)
        cv2.ellipse(mask, (120, 80), (65, 45), 0, 0, 360, 255, -1)
        return mask

    def test_three_and_five_frames_use_shared_predictor_in_upload_order(self):
        for count in (3, 5):
            with self.subTest(count=count), patch('segment.sam_mask', side_effect=self.mask) as predictor:
                widths = [240 + i * 10 for i in range(count)]
                response = self.post(images=[jpeg(width, 160) for width in widths])
                self.assertEqual(response.status_code, 200)
                frames = response.json()['frames']
                self.assertEqual([frame['width'] for frame in frames], widths)
                self.assertEqual(predictor.call_count, count)
                self.assertTrue(all(frame['presence']['detected'] for frame in frames))
                self.assertTrue(all('quality' in frame and len(frame['contour']) > 8 for frame in frames))

    def test_single_and_burst_share_predictor_result_with_refinement_provenance(self):
        with patch('segment.sam_mask', side_effect=self.mask):
            burst = self.post().json()['frames'][0]
            single = self.client.post('/api/live-segment', headers=self.headers,
                files={'image': ('frame.jpg', jpeg(), 'image/jpeg')},
                data={'box': '[20,15,220,145]'}).json()
        self.assertEqual(burst['rawContour'], single['rawContour'])
        self.assertTrue(burst['edgeRefinement']['accepted'])
        self.assertEqual(burst, single)

    def test_unsupported_refinement_does_not_silently_fall_back_to_raw(self):
        with patch('segment.sam_mask', side_effect=self.mask), \
                patch('segment.refine_lens_edge', side_effect=lambda image, contour:
                      (contour, {'accepted':False, 'reason':'weak-edge-evidence'})):
            response = self.post()
        self.assertEqual(response.status_code, 200)
        for frame in response.json()['frames']:
            self.assertIn('error', frame)
            self.assertGreater(len(frame['rawContour']), 8)
            self.assertNotIn('contour', frame)

    def test_refined_contour_is_rechecked_against_original_pixels(self):
        supported = {'detected':True, 'reason':'test'}
        rejected = {'detected':False, 'reason':'no-evidence'}
        with patch('segment.sam_mask', side_effect=self.mask), \
                patch('segment.lens_presence', side_effect=[supported,rejected]*3):
            response = self.post()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(all('error' in frame and 'contour' not in frame for frame in response.json()['frames']))

    def test_invalid_counts_or_boxes_never_run_predictor(self):
        with patch('segment.sam_mask') as predictor:
            for count in (1, 2, 6):
                self.assertEqual(self.post(images=[jpeg()] * count).status_code, 422)
            for boxes in ([], {}, [None] * 3, [[True, 15, 220, 145]] * 3,
                          [[20, 15, 221, 999]] * 3, [[20.5, 15, 220, 145]] * 3):
                self.assertEqual(self.post(boxes=boxes).status_code, 422)
        predictor.assert_not_called()

    def test_invalid_frame_keeps_its_index_without_gpu_work(self):
        with patch('segment.sam_mask', side_effect=self.mask) as predictor:
            result = self.post(images=[jpeg(), b'bad JPEG', jpeg(1601, 100), jpeg()])
        self.assertEqual(result.status_code, 200)
        frames = result.json()['frames']
        self.assertIn('contour', frames[0])
        self.assertIn('decode', frames[1]['error'])
        self.assertIn('1600', frames[2]['error'])
        self.assertIn('contour', frames[3])
        self.assertEqual(predictor.call_count, 2)

    def test_no_lens_is_an_ordered_normal_result(self):
        with patch('segment.sam_mask', side_effect=ValueError('No target')):
            response = self.post()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(all(frame['contour'] == [] and not frame['presence']['detected']
                            for frame in response.json()['frames']))

    def test_busy_rejects_entire_burst_with_retry_after(self):
        with patch('segment.sam_mask', side_effect=ModelBusyError('GPU busy')) as predictor:
            response = self.post()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers['Retry-After'], '1')
        predictor.assert_called_once()

    def test_auth_and_size_limits_block_gpu_work(self):
        with patch('segment.sam_mask') as predictor:
            self.assertEqual(self.post(headers={'X-OptiFrame-Key':'wrong'}).status_code, 401)
            self.assertEqual(self.post(images=[b'x' * 6_000_001, jpeg(), jpeg()]).status_code, 413)
            self.assertEqual(self.post(images=[b'x' * 5_100_000] * 4).status_code, 413)
        predictor.assert_not_called()

    def test_processing_deadline_stops_remaining_frames(self):
        with patch('segment.sam_mask', side_effect=self.mask) as predictor, \
                patch('segment.monotonic', side_effect=[0, 0, 9]):
            response = self.post()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers['Retry-After'], '1')
        predictor.assert_called_once()


if __name__ == '__main__':
    unittest.main()
