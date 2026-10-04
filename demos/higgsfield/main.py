"""Server-side Seedance 2.5 smoke test. Run from the repository root."""

import os
import sys
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
import higgsfield_client


MODEL = "bytedance/seedance-2.5/text-to-video"


def main() -> int:
    project = Path(__file__).resolve().parents[2]
    load_dotenv(project / ".env.local", override=False)
    if not os.environ.get("HF_KEY"):
        # Also support the parent workspace file if the editor opened there.
        load_dotenv(project.parent / ".env.local", override=False)
    key = os.environ.get("HF_KEY", "")
    if not key or ":" not in key or key.startswith("your-"):
        print("HF_KEY is missing. Set it in the ignored .env.local file.", file=sys.stderr)
        return 2

    try:
        result = higgsfield_client.subscribe(
            MODEL,
            arguments={
                "prompt": "A cinematic scene at sunset",
                "duration": 5,
                "resolution": "720p",
                "aspect_ratio": "16:9",
                "output_format": "mp4",
                "generate_audio": False,
            },
        )
    except Exception as exc:
        # SDK exceptions can include request details; never print them beside credentials.
        print(f"Generation did not complete ({type(exc).__name__}).", file=sys.stderr)
        return 1

    if not isinstance(result, dict):
        print("Unexpected response; no verified video URL.", file=sys.stderr)
        return 1
    status = str(result.get("status", "")).lower()
    if status in {"failed", "canceled", "cancelled", "moderated", "rejected"}:
        print(f"Generation ended with status: {status}.", file=sys.stderr)
        return 1
    video = result.get("video")
    url = video.get("url") if isinstance(video, dict) else video
    parsed = urlparse(url) if isinstance(url, str) else None
    if not parsed or parsed.scheme != "https" or not parsed.netloc:
        print("No verified video URL in response.", file=sys.stderr)
        return 1
    print(url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
