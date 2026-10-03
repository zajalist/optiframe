"""Contour proposals from controlled lens photos; never a certified measurement."""

from __future__ import annotations

import json
import logging
import threading
import base64
import hmac
import os
import math
import tempfile
from io import BytesIO
from pathlib import Path
from zipfile import BadZipFile, ZipFile

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from PIL import Image
from starlette.formparsers import MultiPartException

app = FastAPI(title="OptiFrame contour proposals")
_model = None
_processor = None
_model_lock = threading.Lock()


class CaptureBodyLimit:
    """Bound multipart bytes before Starlette spools phone uploads."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        limits = {"/api/video-frames": VIDEO_MAX_BYTES,
                  "/api/import": 100_000_000,
                  "/api/segment": 48_000_000,
                  "/api/live-segment": 8_000_000}
        if scope["type"] != "http" or scope["path"] not in limits:
            return await self.app(scope, receive, send)
        limit = limits[scope["path"]] + 64_000  # Multipart headers and boundaries.
        detail = ("Video request exceeds 100 MB" if scope["path"] == "/api/video-frames"
                  else "Capture request exceeds upload limit")
        headers = dict(scope.get("headers", []))
        try:
            length = int(headers.get(b"content-length", b"0"))
        except ValueError:
            length = 0
        rejection = Response(detail, status_code=413)
        if length > limit:
            return await rejection(scope, receive, send)
        total = 0
        exceeded = False

        async def bounded_receive():
            nonlocal total, exceeded
            message = await receive()
            total += len(message.get("body", b""))
            if total > limit:
                exceeded = True
                # Starlette closes partial upload files only for parser errors.
                # bounded_send restores 413 after its parser error becomes a 400.
                raise MultiPartException(detail)
            return message

        async def bounded_send(message):
            if exceeded:
                if message["type"] == "http.response.start":
                    message = {**message, "status": 413}
            await send(message)

        await self.app(scope, bounded_receive, bounded_send)


app.add_middleware(CaptureBodyLimit)


@app.middleware("http")
async def protect_phone_api(request: Request, call_next):
    """A short-lived bearer key protects GPU work through a demo tunnel."""
    required = os.environ.get("OPTIFRAME_ACCESS_TOKEN")
    if required and request.url.path.startswith("/api/"):
        supplied = request.headers.get("x-optiframe-key", "")
        if not hmac.compare_digest(supplied, required):
            return Response("Phone test key missing or incorrect", status_code=401)
    return await call_next(request)


def decode(data: bytes) -> np.ndarray:
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Could not decode image")
    if max(image.shape[:2]) > 6000:
        raise ValueError("Image exceeds 6000 pixels on one side")
    return image


def enhance(image: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    lab[:, :, 0] = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(lab[:, :, 0])
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


def difference_mask(image: np.ndarray, empty: np.ndarray) -> np.ndarray:
    if image.shape != empty.shape:
        h, w = image.shape[:2]
        eh, ew = empty.shape[:2]
        if abs((ew / eh) / (w / h) - 1) > 0.01:
            raise ValueError("Empty-sheet photo has a different aspect ratio. Use a matching photo or set a lens box without an empty sheet.")
        empty = cv2.resize(empty, (w, h), interpolation=cv2.INTER_AREA if ew > w else cv2.INTER_LINEAR)
    # Keep proposals in the lens photo's coordinates by aligning the empty view.
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    base = cv2.cvtColor(empty, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    scale = min(1.0, 1000 / max(h, w))
    moving = cv2.resize(base, None, fx=scale, fy=scale)
    fixed = cv2.resize(gray, None, fx=scale, fy=scale)
    warp = np.eye(2, 3, dtype=np.float32)
    try:
        cv2.findTransformECC(fixed, moving, warp, cv2.MOTION_EUCLIDEAN,
                             (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 80, 1e-5),
                             None, 5)
        warp[:, 2] /= scale
        aligned = cv2.warpAffine(empty, warp, (w, h),
                                 flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP,
                                 borderMode=cv2.BORDER_REPLICATE)
    except cv2.error:
        aligned = empty
    delta = cv2.absdiff(enhance(image), enhance(aligned))
    strength = np.max(delta, axis=2)
    strength = cv2.GaussianBlur(strength, (5, 5), 0)
    threshold = max(12, int(np.percentile(strength, 85)))
    mask = np.uint8(strength >= threshold) * 255
    radius = max(3, int(min(h, w) * 0.005) | 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (radius, radius))
    return cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)


def contour_from_mask(mask: np.ndarray) -> list[list[int]]:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return []
    h, w = mask.shape
    center = np.array([w / 2, h / 2])
    plausible = [c for c in contours if 0.002 * w * h < cv2.contourArea(c) < 0.75 * w * h]
    if not plausible:
        return []
    chosen = max(plausible, key=lambda c: cv2.contourArea(c) /
                 (1 + np.linalg.norm(np.mean(c[:, 0, :], axis=0) - center) / max(w, h)))
    chosen = cv2.approxPolyDP(chosen, epsilon=0.0008 * cv2.arcLength(chosen, True), closed=True)
    return chosen[:, 0, :].astype(int).tolist()


def glare_fraction(image: np.ndarray, box: tuple[int, int, int, int]) -> float:
    x0, y0, x1, y1 = box
    roi = image[y0:y1, x0:x1]
    if roi.size == 0:
        return 0.0
    # This is a clipped-pixel warning, not a definitive specular classifier.
    return float(np.mean(np.min(roi, axis=2) >= 250))


def live_quality(image: np.ndarray, contour: list[list[int]],
                 box: tuple[int, int, int, int]) -> dict:
    """Repeatable frame ranking; these image heuristics are not model confidence."""
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    x0, y0, x1, y1 = box
    roi = gray[y0:y1, x0:x1]
    sharpness = float(cv2.Laplacian(roi, cv2.CV_64F).var())
    clipped = glare_fraction(image, box)
    polygon = np.asarray(contour, dtype=np.float32)
    area = abs(float(cv2.contourArea(polygon)))
    box_area = (x1 - x0) * (y1 - y0)
    coverage = area / box_area if box_area else 0.0
    # Favor a clear edge, moderate clipping, and a contour that occupies the prompt.
    sharpness_part = min(1.0, sharpness / 250.0)
    coverage_part = min(1.0, coverage / 0.25) if coverage <= 0.85 else 0.0
    glare_part = max(0.0, 1.0 - clipped / 0.08)
    score = round(sharpness_part * coverage_part * glare_part, 4)
    return {"score": score, "sharpness": round(sharpness, 2),
            "clippedFraction": round(clipped, 5), "coverage": round(coverage, 4)}


def sam_mask(image: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
    import torch

    global _model, _processor
    with _model_lock:
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA is unavailable")
        if _model is None:
            from transformers import Sam2Model, Sam2Processor

            name = "facebook/sam2.1-hiera-small"
            _processor = Sam2Processor.from_pretrained(name)
            _model = Sam2Model.from_pretrained(name).to("cuda").eval()
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        inputs = _processor(images=Image.fromarray(rgb), input_boxes=[[list(box)]],
                            return_tensors="pt").to("cuda")
        with torch.inference_mode():
            result = _model(**inputs)
        masks = _processor.post_process_masks(result.pred_masks.cpu(),
                                               inputs["original_sizes"])[0]
        index = int(result.iou_scores.reshape(-1).argmax().item())
        return (masks.reshape(-1, *masks.shape[-2:])[index].numpy() > 0).astype(np.uint8) * 255


def inspect_capture(data: bytes) -> dict:
    with ZipFile(BytesIO(data)) as archive:
        files = archive.infolist()
        # Sixty native frames can each include original/enhanced JPEG, depth and
        # confidence files, plus the manifest and the sampled point cloud.
        if len(files) > 300 or sum(item.file_size for item in files) > 250_000_000:
            raise ValueError("Capture archive is too large")
        manifest = json.loads(archive.read("manifest.json"))
        if manifest.get("schemaVersion") != 1:
            raise ValueError("Unsupported capture version")
        frames = manifest.get("frames", [])
        lens = [f for f in frames if f.get("kind") == "lens"]
        if not lens:
            raise ValueError("Capture has no lens-on-sheet frame")
        best = max(lens, key=lambda f: f.get("sharpness", 0) /
                   (1 + 10 * f.get("clippedFraction", 0)))
        empty = next((f for f in frames if f.get("kind") == "empty"), None)

        def jpeg(name: str) -> str:
            if name not in archive.namelist() or not name.endswith(".jpg"):
                raise ValueError("Capture references a missing JPEG")
            payload = archive.read(name)
            if len(payload) > 24_000_000:
                raise ValueError("Capture JPEG exceeds 24 MB")
            return "data:image/jpeg;base64," + base64.b64encode(payload).decode("ascii")

        return {
            "side": best["side"], "frameCount": len(frames),
            "image": jpeg(best["original"]),
            "empty": jpeg(empty["original"]) if empty else None,
            "hasDepth": any(f.get("depth") for f in frames),
            "rawCloud": "raw-cloud.ply" in archive.namelist(),
            "measurementStatus": "uncalibrated; confirm sheet scale and contour",
        }


@app.get("/api/health")
def health() -> dict:
    try:
        import torch
    except ImportError:
        return {"cuda": False, "gpu": None, "modelLoaded": _model is not None}
    return {"cuda": torch.cuda.is_available(), "gpu": torch.cuda.get_device_name(0)
            if torch.cuda.is_available() else None, "modelLoaded": _model is not None}


@app.post("/api/import")
def import_capture(capture: UploadFile = File(...)) -> dict:
    data = capture.file.read(100_000_001)
    if len(data) > 100_000_000:
        raise HTTPException(status_code=413, detail="Capture ZIP exceeds 100 MB")
    try:
        return inspect_capture(data)
    except (ValueError, KeyError, OSError, BadZipFile, RuntimeError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


VIDEO_MAX_BYTES = 100_000_000
VIDEO_MAX_SECONDS = 60
VIDEO_MAX_SIDE = 4096
VIDEO_MAX_FRAMES = 7200


def extract_video_frames(path: str) -> dict:
    capture = cv2.VideoCapture(path)
    try:
        if not capture.isOpened():
            raise ValueError("Could not open video. Try a MOV or MP4 with H.264 video.")
        fps = capture.get(cv2.CAP_PROP_FPS)
        count = capture.get(cv2.CAP_PROP_FRAME_COUNT)
        width = capture.get(cv2.CAP_PROP_FRAME_WIDTH)
        height = capture.get(cv2.CAP_PROP_FRAME_HEIGHT)
        if not all(math.isfinite(v) and v > 0 for v in (fps, count, width, height)):
            raise ValueError("Video duration or dimensions could not be read")
        duration = count / fps
        if duration > VIDEO_MAX_SECONDS or count > VIDEO_MAX_FRAMES:
            raise ValueError("Video must be at most 60 seconds and 7200 frames")
        if max(width, height) > VIDEO_MAX_SIDE or width * height > 12_000_000:
            raise ValueError("Video exceeds 4096 pixels per side or 12 megapixels")
        indices = np.unique(np.linspace(0, int(count) - 1, min(6, int(count)), dtype=int))
        frames = []
        for index in indices:
            capture.set(cv2.CAP_PROP_POS_FRAMES, int(index))
            ok, photo = capture.read()
            if not ok:
                continue
            h, w = photo.shape[:2]
            if max(h, w) > VIDEO_MAX_SIDE or h * w > 12_000_000:
                raise ValueError("Decoded video frame exceeds the size limit")
            factor = min(1, 1600 / max(h, w))
            if factor < 1:
                photo = cv2.resize(photo, (round(w * factor), round(h * factor)))
            ok, jpeg = cv2.imencode(".jpg", photo, [cv2.IMWRITE_JPEG_QUALITY, 90])
            if not ok:
                raise ValueError("Could not encode video frame")
            frames.append({"seconds": round(int(index) / fps, 2),
                           "image": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode("ascii")})
        if not frames:
            raise ValueError("No readable frames found in video")
        return {"durationSeconds": round(duration, 2), "frames": frames,
                "measurementStatus": "uncalibrated; choose a photo, then review contour and scale"}
    finally:
        capture.release()


@app.post("/api/video-frames")
def video_frames(video: UploadFile = File(...)) -> dict:
    # OpenCV needs a path. The upload copy is deleted on success and every error.
    try:
        with tempfile.TemporaryDirectory(prefix="optiframe-video-") as directory:
            path = Path(directory) / "upload.mov"
            total = 0
            with path.open("wb") as output:
                while chunk := video.file.read(1024 * 1024):
                    total += len(chunk)
                    if total > VIDEO_MAX_BYTES:
                        raise HTTPException(status_code=413, detail="Video exceeds 100 MB")
                    output.write(chunk)
            return extract_video_frames(str(path))
    except (ValueError, cv2.error) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/segment")
def segment(image: UploadFile = File(...), empty: UploadFile | None = File(None),
            box: str | None = Form(None), use_gpu: bool = Form(True)) -> dict:
    try:
        raw = image.file.read(24_000_001)
        if len(raw) > 24_000_000:
            raise ValueError("Image exceeds 24 MB")
        photo = decode(raw)
        h, w = photo.shape[:2]
        given_box = tuple(int(v) for v in json.loads(box)) if box else None
        if given_box and (len(given_box) != 4 or not (0 <= given_box[0] < given_box[2] <= w)
                          or not (0 <= given_box[1] < given_box[3] <= h)):
            raise ValueError("Box must be [left, top, right, bottom] inside the image")
        candidates = []
        if empty:
            empty_bytes = empty.file.read(24_000_001)
            if len(empty_bytes) > 24_000_000:
                raise ValueError("Empty-sheet image exceeds 24 MB")
            base = decode(empty_bytes)
            rough = contour_from_mask(difference_mask(photo, base))
            if rough:
                candidates.append({"method": "aligned-image-difference", "contour": rough})
                if not given_box:
                    x, y, bw, bh = cv2.boundingRect(np.array(rough, dtype=np.int32))
                    pad = int(0.08 * max(bw, bh))
                    given_box = (max(0, x - pad), max(0, y - pad),
                                 min(w, x + bw + pad), min(h, y + bh + pad))
        if use_gpu and given_box:
            try:
                proposal = contour_from_mask(sam_mask(enhance(photo), given_box))
                if proposal:
                    candidates.append({"method": "sam2.1-hiera-small-cuda", "contour": proposal})
            except Exception:
                logging.exception("SAM2 proposal failed")
                candidates.append({"method": "sam2.1-hiera-small-cuda",
                                   "error": "GPU proposal unavailable; review the photo contour"})
        if not candidates:
            raise ValueError("Provide an empty-sheet image or a box around the lens")
        return {"width": w, "height": h, "candidates": candidates,
                "clippedFraction": glare_fraction(photo, given_box or (0, 0, w, h)),
                "measurementStatus": "proposal-only; scale and contour review required"}
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/live-segment")
def live_segment(image: UploadFile = File(...), box: str = Form(...)) -> dict:
    """Segment one bounded camera frame with the shared SAM2 image predictor."""
    raw = image.file.read(6_000_001)
    if len(raw) > 6_000_000:
        raise HTTPException(status_code=413, detail="Live frame exceeds 6 MB")
    try:
        photo = decode(raw)
        h, w = photo.shape[:2]
        if max(w, h) > 1600 or w * h > 2_600_000:
            raise ValueError("Live frame exceeds 1600 pixels per side or 2.6 megapixels")
        parsed = json.loads(box)
        if not isinstance(parsed, list) or len(parsed) != 4 or any(
                isinstance(v, bool) or not isinstance(v, int) for v in parsed):
            raise ValueError("Box must be four integer coordinates")
        x0, y0, x1, y1 = parsed
        if not (0 <= x0 < x1 <= w and 0 <= y0 < y1 <= h and
                x1 - x0 >= 16 and y1 - y0 >= 16):
            raise ValueError("Box must be at least 16 pixels wide and high inside the image")
        contour = contour_from_mask(sam_mask(enhance(photo), tuple(parsed)))
        if len(contour) < 3:
            raise ValueError("No lens contour found in the box")
        return {"width": w, "height": h, "contour": contour,
                "quality": live_quality(photo, contour, tuple(parsed)),
                "method": "sam2.1-hiera-small-cuda",
                "measurementStatus": "proposal-only; review contour and calibrate sheet scale"}
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        logging.exception("Live SAM2 proposal failed")
        raise HTTPException(status_code=503, detail="GPU segmentation unavailable") from error


@app.post("/api/frame")
def frame(payload: dict) -> Response:
    from frame import Settings, generate

    try:
        settings = Settings(**payload["settings"])
        archive, notes = generate(payload["left"], payload["right"], settings)
        if not notes["bedFit"]:
            raise ValueError("A part exceeds the selected printer bed")
        return Response(archive, media_type="application/zip", headers={
            "Content-Disposition": 'attachment; filename="optiframe-experimental-kit.zip"',
            "X-OptiFrame-Status": "experimental-fit-check-required",
        })
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/frame-preview")
def frame_preview(payload: dict) -> dict:
    from frame import Settings, preview

    try:
        return preview(payload["left"], payload["right"], Settings(**payload["settings"]))
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


app.mount("/", StaticFiles(directory=Path(__file__).resolve().parent.parent / "web", html=True),
          name="web")
