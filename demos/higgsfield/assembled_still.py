"""Create a 4K image-anchored landing hero with an assembled frame."""

import os
import sys
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import urlopen

from dotenv import load_dotenv
import higgsfield_client


ROOT = Path(__file__).resolve().parents[2]
OUT = Path.home() / "Downloads" / "OptiFrame-Demo"


def main() -> int:
    load_dotenv(ROOT / ".env.local", override=False)
    if not os.environ.get("HF_KEY"):
        load_dotenv(ROOT.parent / ".env.local", override=False)
    if ":" not in os.environ.get("HF_KEY", ""):
        print("HF_KEY is unavailable.", file=sys.stderr)
        return 2

    source = OUT / "hero-source.jpg"
    if not source.exists():
        print("The current hero image is unavailable.", file=sys.stderr)
        return 2
    try:
        source_url = higgsfield_client.upload_file(str(source))
        result = higgsfield_client.subscribe(
            "marketing-studio/image/sunburst",
            arguments={
                "image_urls": [source_url],
                "prompt": (
                    "Edit this exact OptiFrame eyewear concept into a physically assembled luxury product "
                    "photograph. Preserve its distinct asymmetry: the lens on the image left is rounded "
                    "and softly teardrop-shaped; the lens on the image right is wider and rectangular. "
                    "Keep each original lens shape and size relationship. Seat both clear lenses inside "
                    "their respective black frame openings, with no floating lens, misaligned glass, "
                    "detached temple, or loose screw. Both temples attach cleanly to hinges and recede "
                    "behind the frame. One tiny subtle OptiFrame mark may appear on only one temple. "
                    "Make bevels crisp and professional, the black polymer smooth, the glass realistically "
                    "transparent with restrained optical reflections. Premium cinematic studio lighting: "
                    "fine silver edge highlights, one delicate spectral refraction and soft god ray, "
                    "deep charcoal backdrop and floor. Frame occupies the right two thirds, with generous "
                    "clean dark negative space on the left for website text. No typography, watermark, "
                    "people, extra lens, extra frame, diagram, grid, or invented component."
                ),
                "quality": "max",
                "moderation": "auto",
                "resolution": "4k",
                "aspect_ratio": "16:9",
                "enhance_prompt": False,
            },
        )
    except Exception as exc:
        print(f"Hero edit did not complete ({type(exc).__name__}).", file=sys.stderr)
        return 1
    if not isinstance(result, dict) or result.get("status") in {"failed", "canceled", "cancelled", "moderated", "rejected"}:
        print("Hero edit failed or was moderated.", file=sys.stderr)
        return 1
    files = result.get("images")
    first = files[0] if isinstance(files, list) and files else result.get("image")
    url = first.get("url") if isinstance(first, dict) else first
    parsed = urlparse(url) if isinstance(url, str) else None
    if not parsed or parsed.scheme != "https" or not parsed.netloc:
        print("Hero edit returned no verified image URL.", file=sys.stderr)
        return 1
    OUT.mkdir(parents=True, exist_ok=True)
    with urlopen(url, timeout=60) as response:
        (OUT / "hero-assembled-4k.png").write_bytes(response.read())
    (OUT / "hero-assembled-url.txt").write_text(url + "\n", encoding="utf-8")
    print(OUT / "hero-assembled-4k.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
