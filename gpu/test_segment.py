import unittest
import json
import asyncio
from io import BytesIO
from zipfile import ZipFile

import cv2
import numpy as np

from segment import CaptureBodyLimit, contour_from_mask, difference_mask, enhance, inspect_capture


class SegmentTests(unittest.TestCase):
    def test_upload_limit_rejects_large_capture_before_parser_runs(self):
        called = []
        async def downstream(scope, receive, send):
            called.append(True)
            await send({'type': 'http.response.start', 'status': 200, 'headers': []})
            await send({'type': 'http.response.body', 'body': b'ok'})
        async def run(path):
            responses = []
            async def send(message):
                responses.append(message)
            scope = {'type': 'http', 'path': path,
                     'headers': [(b'content-length', b'100064001')]}
            await CaptureBodyLimit(downstream)(scope, lambda: None, send)
            return responses[0]['status']
        self.assertEqual(asyncio.run(run('/api/import')), 413)
        self.assertEqual(asyncio.run(run('/api/video-frames')), 413)
        self.assertFalse(called)

    def test_full_native_capture_entry_count_imports(self):
        image = cv2.imencode('.jpg', np.zeros((12, 12, 3), np.uint8))[1].tobytes()
        frames = []
        stream = BytesIO()
        with ZipFile(stream, 'w') as archive:
            for index in range(60):
                prefix = f'frame-{index:03d}'
                original = f'{prefix}-original.jpg'
                frames.append({'kind': 'lens', 'side': 'left', 'original': original,
                               'depth': f'{prefix}-depth.bin', 'sharpness': 1})
                archive.writestr(original, image)
                archive.writestr(f'{prefix}-enhanced.jpg', image)
                archive.writestr(f'{prefix}-depth.bin', b'\x00')
                archive.writestr(f'{prefix}-confidence.bin', b'\x01')
            archive.writestr('manifest.json', json.dumps({'schemaVersion': 1, 'frames': frames}))
            archive.writestr('raw-cloud.ply', 'ply\n')
        result = inspect_capture(stream.getvalue())
        self.assertEqual(result['frameCount'], 60)
        self.assertTrue(result['hasDepth'])
        self.assertTrue(result['rawCloud'])

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

    def test_translated_sheet_contour_stays_in_lens_photo_coordinates(self):
        rng = np.random.default_rng(42)
        empty = np.full((360, 480, 3), 180, np.uint8)
        # Distinct printed marks allow ECC to recover the camera translation.
        for _ in range(120):
            center = tuple(int(v) for v in rng.integers([50, 50], [430, 310]))
            cv2.circle(empty, center, int(rng.integers(8, 16)), (70, 70, 70), -1)
        photo = cv2.warpAffine(empty, np.float32([[1, 0, 10], [0, 1, -8]]),
                               (480, 360), borderValue=(180, 180, 180))
        cv2.ellipse(photo, (270, 170), (45, 30), 0, 0, 360, (220, 220, 220), -1)
        for resolution in (1, 2):
            with self.subTest(empty_resolution=resolution):
                reference = cv2.resize(empty, (480 * resolution, 360 * resolution),
                                       interpolation=cv2.INTER_NEAREST)
                mask = difference_mask(photo, reference)
                self.assertEqual(mask.shape, photo.shape[:2])
                contour = contour_from_mask(mask)
                self.assertGreater(len(contour), 8)
                x, y, width, height = cv2.boundingRect(np.array(contour, dtype=np.int32))
                self.assertAlmostEqual(x + (width - 1) / 2, 270, delta=2)
                self.assertAlmostEqual(y + (height - 1) / 2, 170, delta=2)
                self.assertAlmostEqual(width, 91, delta=4)
                self.assertAlmostEqual(height, 61, delta=4)


if __name__ == "__main__":
    unittest.main()
