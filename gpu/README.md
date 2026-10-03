# Local GPU service and printable frame prototype

The PC has a CUDA-capable RTX 5070 with 12 GB VRAM. `segment.py` uses OpenCV CLAHE and aligned empty/lens photo differences, then optionally runs promptable SAM 2.1 small on CUDA. This produces **candidate contours**, never accepted lens dimensions.

```powershell
python -m unittest discover -s gpu -p 'test_*.py' -v
python -m uvicorn segment:app --app-dir gpu --host 127.0.0.1 --port 8765
```

Open <http://127.0.0.1:8765> on the same machine. `POST /api/import` reads an iPhone capture ZIP and selects the sharpest low-glare lens view. `POST /api/segment` takes multipart `image`, optional `empty`, optional `box` as `[left,top,right,bottom]`, and `use_gpu=true|false`. It returns separate image-difference and SAM candidates plus a clipped-pixel warning. The first GPU request downloads the [SAM 2.1 small checkpoint](https://huggingface.co/facebook/sam2.1-hiera-small) into the user's Hugging Face cache. `GET /api/health` reports CUDA and model status.

`POST /api/frame-preview` accepts independently reviewed left/right contours in millimetres relative to their marked optical centres and returns the front as binary STL. `POST /api/frame` returns a ZIP of five watertight STL parts: front, two lens retainers and two hinged temples. The service checks outline validity, lens overlap, M2 hole wall clearance, mesh closure and printer bed dimensions. The kit is **experimental**. It needs a real fit coupon, screw clearance check, print orientation and wearer fit check before use. It does not infer prescription or lens thickness from images.

Do not expose the service port directly to the internet. Put the eventual app behind a named Cloudflare Tunnel and an Access policy on `optiframe.zajalist.com`; keep the server bound to `127.0.0.1`. If CUDA or the model is unavailable, the photo-difference proposal and manual contour editor remain available.
