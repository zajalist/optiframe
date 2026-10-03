# Local GPU contour proposals

The PC has a CUDA-capable RTX 5070 with 12 GB VRAM. `segment.py` uses OpenCV CLAHE and aligned empty/lens photo differences, then optionally runs promptable SAM 2.1 small on CUDA. This produces **candidate contours**, never accepted lens dimensions.

```powershell
python -m unittest discover -s gpu -p 'test_*.py' -v
python -m uvicorn gpu.segment:app --host 127.0.0.1 --port 8000
```

`POST /api/segment` takes multipart `image`, optional `empty`, optional `box` as `[left,top,right,bottom]`, and `use_gpu=true|false`. It returns separate image-difference and SAM candidates plus a clipped-pixel warning. The first GPU request downloads the [SAM 2.1 small checkpoint](https://huggingface.co/facebook/sam2.1-hiera-small) into the user's Hugging Face cache. `GET /api/health` reports CUDA and model status.

Do not expose port 8000 directly to the internet. Put the eventual app behind a named Cloudflare Tunnel and an Access policy on `optiframe.zajalist.com`; keep the server bound to `127.0.0.1`. If CUDA or the model is unavailable, the photo-difference proposal and manual contour editor remain available.
