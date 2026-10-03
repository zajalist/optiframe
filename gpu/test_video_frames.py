import asyncio
import base64
import json
import os
import tempfile
import unittest
import subprocess
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
from fastapi.testclient import TestClient

from segment import app, difference_mask


class VideoFramesTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.auth = patch.dict(os.environ, {"OPTIFRAME_ACCESS_TOKEN": "video-test"})
        self.auth.start()
        self.addCleanup(self.auth.stop)

    def upload(self, data):
        return self.client.post("/api/video-frames", headers={"X-OptiFrame-Key": "video-test"},
                                files={"video": ("clip.mov", data, "video/quicktime")})

    def test_samples_jpegs_and_removes_temporary_upload(self):
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / "clip.avi")
            writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"MJPG"), 10, (80, 60))
            self.assertTrue(writer.isOpened())
            for index in range(20):
                writer.write(np.full((60, 80, 3), index * 10, np.uint8))
            writer.release()
            before = set(Path(tempfile.gettempdir()).glob("optiframe-video-*"))
            response = self.upload(Path(path).read_bytes())
            self.assertEqual(response.status_code, 200, response.text)
            frames = response.json()["frames"]
            self.assertEqual(len(frames), 6)
            self.assertEqual(frames[0]["seconds"], 0)
            self.assertEqual(frames[-1]["seconds"], 1.9)
            for frame in frames:
                jpeg = base64.b64decode(frame["image"].split(",")[1])
                self.assertEqual(cv2.imdecode(np.frombuffer(jpeg, np.uint8), 1).shape, (60, 80, 3))
            self.assertEqual(set(Path(tempfile.gettempdir()).glob("optiframe-video-*")), before)

    def test_rejects_unauthorized_invalid_and_oversized_uploads(self):
        response = self.client.post("/api/video-frames", files={"video": ("clip.mov", b"bad")})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.upload(b"invalid video").status_code, 422)
        with patch("segment.VIDEO_MAX_BYTES", 8):
            self.assertEqual(self.upload(b"ninebytes").status_code, 413)

    def test_duration_and_dimensions_are_bounded(self):
        for metadata in ((30, 1830, 80, 60), (30, 30, 5000, 60)):
            with patch("segment.cv2.VideoCapture") as capture:
                capture.return_value.isOpened.return_value = True
                capture.return_value.get.side_effect = metadata
                self.assertEqual(self.upload(b"clip").status_code, 422)
                capture.return_value.release.assert_called_once()

    def test_body_limit_precedes_multipart_parsing(self):
        with patch("segment.VIDEO_MAX_BYTES", 8), patch("segment.extract_video_frames") as extract:
            self.assertEqual(self.upload(b"x" * 65_000).status_code, 413)
            extract.assert_not_called()
            response = self.client.post("/api/video-frames", headers={"X-OptiFrame-Key": "video-test",
                                        "Content-Type": "multipart/form-data; boundary=clip"},
                                        content=iter([b"x" * 40_000, b"x" * 40_000]))
            self.assertEqual(response.status_code, 413)
            extract.assert_not_called()

    def test_empty_sheet_resizes_only_with_matching_aspect(self):
        photo = np.full((60, 80, 3), 140, np.uint8)
        empty = np.full((120, 160, 3), 140, np.uint8)
        self.assertEqual(difference_mask(photo, empty).shape, (60, 80))
        with self.assertRaisesRegex(ValueError, "different aspect ratio"):
            difference_mask(photo, np.zeros((120, 120, 3), np.uint8))

    def test_streaming_body_limit_closes_partial_multipart_upload(self):
        chunks = [
            (b'--clip\r\nContent-Disposition: form-data; name="video"; '
             b'filename="clip.mov"\r\nContent-Type: video/quicktime\r\n\r\n'
             + b"x" * 40_000),
            b"x" * 40_000 + b"\r\n--clip--\r\n",
        ]
        files = []
        messages = []
        spool = tempfile.SpooledTemporaryFile

        def tracked_spool(*args, **kwargs):
            file = spool(*args, **kwargs)
            files.append(file)
            return file

        async def request():
            remaining = iter(chunks)

            async def receive():
                chunk = next(remaining, None)
                if chunk is None:
                    await asyncio.Event().wait()
                return {"type": "http.request", "body": chunk,
                        "more_body": chunk is chunks[0]}

            async def send(message):
                messages.append(message)

            await app({"type": "http", "asgi": {"version": "3.0"},
                       "http_version": "1.1", "method": "POST", "scheme": "http",
                       "path": "/api/video-frames", "raw_path": b"/api/video-frames",
                       "query_string": b"", "root_path": "",
                       "headers": [(b"content-type", b"multipart/form-data; boundary=clip"),
                                   (b"x-optiframe-key", b"video-test")],
                       "client": ("127.0.0.1", 1234), "server": ("test", 80)},
                      receive, send)

        with patch("segment.VIDEO_MAX_BYTES", 8), \
                patch("starlette.formparsers.SpooledTemporaryFile", tracked_spool), \
                patch("segment.extract_video_frames") as extract:
            asyncio.run(request())
            extract.assert_not_called()
        self.assertEqual(len(files), 1)
        self.assertTrue(files[0].closed)
        start = next(message for message in messages if message["type"] == "http.response.start")
        self.assertEqual(start["status"], 413)
        body = b"".join(message.get("body", b"") for message in messages
                        if message["type"] == "http.response.body")
        self.assertEqual(json.loads(body), {"detail": "Video request exceeds 100 MB"})

    def test_browser_ignores_stale_photo_and_proposal(self):
        script = r'''
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve}; };
const oldBitmap = deferred(), proposal = deferred();
const closed = [];
const bitmap = id => ({width:80,height:60,close(){closed.push(id);},id});
const context = {document:{querySelectorAll:()=>[]},location:{hash:''},URLSearchParams,
  FormData, fetch:()=>proposal.promise, createImageBitmap:async file=>file==='old'?oldBitmap.promise:bitmap(file)};
vm.createContext(context);
vm.runInContext(fs.readFileSync('web/calibration.js','utf8').replace(/^export .*;$/m, ''), context);
vm.runInContext(fs.readFileSync('web/app.js','utf8').replace(/^import .*;$/m, '').split('const [leftPanel, rightPanel]')[0]+';globalThis.Panel=LensPanel', context);
const panel = Object.create(context.Panel.prototype);
Object.assign(panel,{photoVersion:0,proposalRequest:0,photoLoading:false,canvas:{},select:{replaceChildren(){}},
  placeholder:{},scaleStatus:{},markerStatus:{},centreStatus:{},status:{},el:{querySelector:()=>({checked:false})},render(){}});
(async()=>{
  const first=panel.loadPhoto('old'); await Promise.resolve();
  assert.equal(await panel.loadPhoto('new'),true); oldBitmap.resolve(bitmap('old')); await first;
  assert.equal(panel.bitmap.id,'new'); assert(closed.includes('old'));
  panel.photo=new Blob(['photo']); panel.empty=new Blob(['empty']); panel.proposals=[];
  const pending=panel.propose();
  assert.equal(await panel.loadPhoto('newer'),true);
  proposal.resolve({ok:true,headers:{get:()=> 'application/json'},json:async()=>({width:80,height:60,candidates:[{contour:[[0,0],[1,0],[1,1]]}]})});
  await pending; assert.equal(panel.bitmap.id,'newer'); assert.equal(panel.points.length,0); assert.equal(panel.proposals.length,0);
})().catch(error=>{console.error(error);process.exitCode=1});
'''
        root = Path(__file__).resolve().parent.parent
        result = subprocess.run(["node", "-"], input=script, text=True, capture_output=True, cwd=root)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
