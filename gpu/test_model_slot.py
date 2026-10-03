import time
import os
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient

import segment
from test_live_segment import jpeg


class ModelSlotTests(unittest.TestCase):
    def test_busy_worker_has_bounded_wait_and_does_not_release_owner(self):
        with segment.model_slot():
            started = time.monotonic()
            with self.assertRaises(segment.ModelBusyError):
                with segment.model_slot():
                    self.fail('a second request acquired the occupied worker')
            self.assertLess(time.monotonic() - started, 1)
            self.assertTrue(segment._model_lock.locked())
        self.assertFalse(segment._model_lock.locked())

    def test_failure_releases_worker_and_records_completion(self):
        with self.assertRaises(ValueError):
            with segment.model_slot():
                raise ValueError('inference failed')
        self.assertFalse(segment._model_lock.locked())
        self.assertIsNone(segment._model_started_at)
        self.assertGreaterEqual(segment._last_inference_ms, 0)


class BusyEndpointTests(unittest.TestCase):
    def test_busy_live_worker_returns_retryable_response(self):
        with patch.dict(os.environ, {'OPTIFRAME_ACCESS_TOKEN':'slot-test'}), \
                patch('segment.sam_mask', side_effect=segment.ModelBusyError('GPU busy. Retrying…')):
            response = TestClient(segment.app).post('/api/live-segment',
                headers={'X-OptiFrame-Key':'slot-test'}, files={'image':('lens.jpg',jpeg(),'image/jpeg')},
                data={'box':'[20,15,220,145]'})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers['Retry-After'], '1')
        self.assertIn('GPU busy', response.json()['detail'])
