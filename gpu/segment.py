"""Contour proposals from controlled lens photos; never a certified measurement."""

from __future__ import annotations

import json
import logging
import threading
import base64
from io import BytesIO
from pathlib import Path
from zipfile import BadZipFile, ZipFile

import cv2
import numpy as np
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from PIL import Image

app = FastAPI(title="OptiFrame contour proposals")
_model = None
_processor = None
_model_lock = threading.Lock()


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
        raise ValueError("Empty-sheet and lens images must have the same dimensions")
    # Align the printed background. The empty view is the fixed reference.
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    base = cv2.cvtColor(empty, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    scale = min(1.0, 1000 / max(h, w))
    moving = cv2.resize(gray, None, fx=scale, fy=scale)
    fixed = cv2.resize(base, None, fx=scale, fy=scale)
    warp = np.eye(2, 3, dtype=np.float32)
    try:
        cv2.findTransformECC(fixed, moving, warp, cv2.MOTION_EUCLIDEAN,
                             (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 80, 1e-5),
                             None, 5)
        warp[:, 2] /= scale
        aligned = cv2.warpAffine(image, warp, (w, h), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP)
    except cv2.error:
        aligned = image
    delta = cv2.absdiff(enhance(aligned), enhance(empty))
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


def sam_mask(image: np.ndarray, box: tuple[int, int, int, int]) -> np.ndarray:
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
        if len(files) > 100 or sum(item.file_size for item in files) > 250_000_000:
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
def frame_preview(payload: dict) -> Response:
    from frame import Settings, generate

    try:
        archive_bytes, notes = generate(payload["left"], payload["right"],
                                         Settings(**payload["settings"]))
        if not notes["bedFit"]:
            raise ValueError("A part exceeds the selected printer bed")
        with ZipFile(BytesIO(archive_bytes)) as archive:
            return Response(archive.read("front.stl"), media_type="model/stl")
    except (KeyError, TypeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


app.mount("/", StaticFiles(directory=Path(__file__).resolve().parent.parent / "web", html=True),
          name="web")
