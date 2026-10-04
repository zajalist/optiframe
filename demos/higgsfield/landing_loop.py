"""Create a native-4K landing-loop candidate anchored to the current concept image."""

import os
import sys
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
import higgsfield_client

ROOT = Path(__file__).resolve().parents[2]
OUT = Path.home() / "Downloads" / "OptiFrame-Demo"


def main():
    load_dotenv(ROOT / ".env.local", override=False)
    if not os.environ.get("HF_KEY"):
        load_dotenv(ROOT.parent / ".env.local", override=False)
    if ":" not in os.environ.get("HF_KEY", ""):
        print("HF_KEY missing.", file=sys.stderr)
        return 2
    image = OUT / "hero-source.jpg"
    if not image.exists():
        print("Export the current hero source image first.", file=sys.stderr)
        return 2
    try:
        image_url = higgsfield_client.upload_file(str(image))
        result = higgsfield_client.subscribe(
            "bytedance/seedance-2.0/image-to-video",
            arguments={
                "image_url": image_url,
                "prompt": (
                    "Luxury eyewear product photography. Preserve this exact asymmetric black eyeglass "
                    "frame and the two clear lenses in their current positions. Subtle slow camera push "
                    "and a moving studio highlight create crisp optical reflections and delicate rainbow "
                    "refraction. Stable charcoal background. Elegant, restrained commercial loop. "
                    "No object assembly, no reordering of parts, no text, no people."
                ),
                "duration": 5,
                "resolution": "4k",
                "generate_audio": False,
            },
        )
    except Exception as exc:
        print(f"Landing loop generation did not complete ({type(exc).__name__}).", file=sys.stderr)
        return 1
    if not isinstance(result, dict) or result.get("status") in {"failed", "canceled", "cancelled", "moderated", "rejected"}:
        status = result.get("status") if isinstance(result, dict) else type(result).__name__
        print(f"Landing loop generation ended with status {status}.", file=sys.stderr)
        return 1
    video = result.get("video")
    url = video.get("url") if isinstance(video, dict) else video
    parsed = urlparse(url) if isinstance(url, str) else None
    if not parsed or parsed.scheme != "https" or not parsed.netloc:
        print("No verified video URL.", file=sys.stderr)
        return 1
    (OUT / "landing-loop-url.txt").write_text(url + "\n", encoding="utf-8")
    print(url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
