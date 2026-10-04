"""Generate a clearly labeled concept shot for the OptiFrame demo."""

import os
import sys
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
import higgsfield_client


def main():
    root = Path(__file__).resolve().parents[2]
    load_dotenv(root / ".env.local", override=False)
    if not os.environ.get("HF_KEY"):
        load_dotenv(root.parent / ".env.local", override=False)
    if ":" not in os.environ.get("HF_KEY", ""):
        print("HF_KEY missing.", file=sys.stderr)
        return 2
    try:
        result = higgsfield_client.subscribe(
            "bytedance/seedance-2.5/text-to-video",
            arguments={
                "prompt": (
                    "Premium industrial-design concept film, one continuous macro camera move around a "
                    "minimal black eyeglass frame on a charcoal background. Two clear prescription lenses "
                    "float forward and settle into the frame openings. Fine machined bevels and a tiny "
                    "subtle brand mark on one temple only. Realistic glass refraction, tasteful studio rim "
                    "lighting, black and silver palette, precise optical-product advertising, no text, "
                    "no people, no extra objects, no logos or labels."
                ),
                "duration": 5,
                "resolution": "720p",
                "aspect_ratio": "16:9",
                "output_format": "mp4",
                "generate_audio": False,
            },
        )
    except Exception as exc:
        print(f"Concept generation did not complete ({type(exc).__name__}).", file=sys.stderr)
        return 1
    if not isinstance(result, dict) or result.get("status") in {"failed", "canceled", "cancelled", "moderated", "rejected"}:
        print("Concept generation failed or was moderated.", file=sys.stderr)
        return 1
    video = result.get("video")
    url = video.get("url") if isinstance(video, dict) else video
    parsed = urlparse(url) if isinstance(url, str) else None
    if not parsed or parsed.scheme != "https" or not parsed.netloc:
        print("No verified video URL.", file=sys.stderr)
        return 1
    print(url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
