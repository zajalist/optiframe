"""Local latency benchmark; synthetic inputs establish no physical accuracy.

Run: python gpu/benchmark.py --iterations 5
Optional: --image lens.jpg --empty empty.jpg [--box 10 20 300 200 --gpu]
Optional: --video clip.mov or --frame-json reviewed-frame-payload.json
Inputs are read locally. Timings, environment, settings, and input fingerprints
are printed; media contents and local paths are omitted.
The first run is reported separately, including SAM initialization when requested.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import platform
import statistics
import time
from importlib.metadata import version
from pathlib import Path

import cv2
import numpy as np
from fastapi import UploadFile

from segment import decode, extract_video_frames, frame, segment


def fingerprint(data):
    return {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}


def image_metadata(data):
    height, width = decode(data).shape[:2]
    return {**fingerprint(data), "width": width, "height": height}


def measure(operation, iterations):
    timings = []
    for _ in range(iterations + 1):
        start = time.perf_counter()
        operation()
        timings.append((time.perf_counter() - start) * 1000)
    warm = timings[1:]
    return {"first_ms": round(timings[0], 2),
            "warm_median_ms": round(statistics.median(warm), 2),
            "warm_min_ms": round(min(warm), 2),
            "warm_max_ms": round(max(warm), 2), "iterations": iterations}


def ellipse(rx, ry):
    return [[rx * math.cos(i * 2 * math.pi / 96),
             ry * math.sin(i * 2 * math.pi / 96)] for i in range(96)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--iterations", type=int, default=5)
    parser.add_argument("--image", type=Path)
    parser.add_argument("--empty", type=Path)
    parser.add_argument("--box", type=int, nargs=4)
    parser.add_argument("--gpu", action="store_true")
    parser.add_argument("--video", type=Path)
    parser.add_argument("--frame-json", type=Path)
    args = parser.parse_args()
    if args.iterations < 1 or args.iterations > 100:
        parser.error("iterations must be between 1 and 100")
    if args.empty and not args.image:
        parser.error("--empty requires --image")
    if args.image and not args.empty and not (args.gpu and args.box):
        parser.error("--image requires --empty or --gpu with --box")
    if args.gpu and not args.box:
        parser.error("--gpu requires --box")
    if args.image:
        photo_bytes = args.image.read_bytes()
        empty_bytes = args.empty.read_bytes() if args.empty else None
    else:
        empty = np.full((600, 800, 3), 160, np.uint8)
        for x in range(0, 800, 30):
            cv2.line(empty, (x, 0), (x, 599), (90, 90, 90), 2)
        photo = empty.copy()
        cv2.ellipse(photo, (400, 300), (180, 120), 0, 0, 360, (210, 210, 210), -1)
        photo_bytes = cv2.imencode(".jpg", photo)[1].tobytes()
        empty_bytes = cv2.imencode(".jpg", empty)[1].tobytes()

    def run_segment():
        result = segment(UploadFile(io.BytesIO(photo_bytes)),
                         UploadFile(io.BytesIO(empty_bytes)) if empty_bytes else None,
                         json.dumps(args.box) if args.box else None, args.gpu)
        if args.gpu and not any(c.get("method", "").endswith("cuda") and "error" not in c
                                for c in result["candidates"]):
            raise RuntimeError("GPU proposal failed; no GPU latency result can be reported")

    payload = json.loads(args.frame_json.read_text(encoding="utf-8")) if args.frame_json else {
        "left": ellipse(25, 19), "right": ellipse(23, 17),
        "settings": {"left_pd": 32, "right_pd": 31,
                     "edge_thickness": 2.5, "temple_length": 125}}
    report = {
        "scope": "local endpoint computation; excludes network/upload; no physical accuracy claim",
        "inputs": "user media" if args.image else "synthetic 800x600 JPEG pair",
        "frame_inputs": "user outlines" if args.frame_json else "synthetic 96-point ellipses",
        "gpu_requested": args.gpu,
        "segment_inputs": {"image": image_metadata(photo_bytes),
                           "empty": image_metadata(empty_bytes) if empty_bytes else None,
                           "box": args.box},
        "frame_payload": {**fingerprint(json.dumps(payload, sort_keys=True,
                           separators=(",", ":"), allow_nan=False).encode("utf-8")),
                          "digest_encoding": "canonical JSON (sorted keys, compact UTF-8)",
                          "settings": payload["settings"]},
        "environment": {"python": platform.python_version(), "platform": platform.platform(),
                        "packages": {name: version(name) for name in
                                     ("numpy", "opencv-python-headless", "trimesh", "manifold3d")}},
        "segment": measure(run_segment, args.iterations),
        "frame": measure(lambda: frame(payload), args.iterations)}
    if args.gpu:
        import torch

        report["environment"]["packages"].update({name: version(name) for name in
                                                  ("torch", "transformers")})
        report["environment"]["gpu"] = (torch.cuda.get_device_name(0)
                                          if torch.cuda.is_available() else None)
    if args.video:
        report["video_input"] = fingerprint(args.video.read_bytes())
        report["video_frames"] = measure(lambda: extract_video_frames(str(args.video)), args.iterations)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
