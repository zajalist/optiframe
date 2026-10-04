"""Generate native-4K OptiFrame campaign b-roll. Billable SDK calls."""

import os
import sys
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
import higgsfield_client

ROOT = Path(__file__).resolve().parents[2]
OUT = Path.home() / "Downloads" / "OptiFrame-Demo"

SHOTS = {
    "prism": (
        "One continuous premium eyewear campaign shot, near-black editorial set. An elegant, slim black "
        "spectacle frame with two clear existing lenses floats in space. The camera dives through a lens; "
        "a controlled white light beam refracts into delicate spectral color, chromatic caustics and fine "
        "volumetric god rays. The lenses separate from the frame for a moment, then align precisely. "
        "Photoreal optical glass, deep blacks, crisp machined bevels, restrained rainbow refraction, "
        "cinematic macro photography, sharp focus, physically plausible reflections. No typography, no "
        "people, no extra glasses, no hallucinated interface, no music."
    ),
    "reveal": (
        "Luxury product launch film, 16:9, black-on-black studio. Extreme macro of a slim dark eyeglass "
        "temple and hinge, a single tiny silver brand detail on one temple. A moving slit of white light "
        "reveals the bevel. Camera orbit accelerates around the complete frame as clear lenses throw "
        "subtle prismatic caustics over a charcoal floor; volumetric rays pass through the lenses. "
        "End on a clean frontal hero view. High-end precision industrial design, convincing glass "
        "refraction, editorial fashion advertising, no text, no people, no second product, no music."
    ),
}


def main():
    root = ROOT
    load_dotenv(root / ".env.local", override=False)
    if not os.environ.get("HF_KEY"):
        load_dotenv(root.parent / ".env.local", override=False)
    if ":" not in os.environ.get("HF_KEY", ""):
        print("HF_KEY missing.", file=sys.stderr)
        return 2
    OUT.mkdir(parents=True, exist_ok=True)
    for name, prompt in SHOTS.items():
        try:
            result = higgsfield_client.subscribe(
                "bytedance/seedance-2.0/text-to-video",
                arguments={"prompt": prompt, "duration": 5, "resolution": "4k",
                           "aspect_ratio": "16:9", "generate_audio": False},
            )
        except Exception as exc:
            print(f"{name}: generation did not complete ({type(exc).__name__}).", file=sys.stderr)
            return 1
        if not isinstance(result, dict) or result.get("status") in {"failed", "canceled", "cancelled", "moderated", "rejected"}:
            print(f"{name}: request failed or was moderated.", file=sys.stderr)
            return 1
        video = result.get("video")
        url = video.get("url") if isinstance(video, dict) else video
        parsed = urlparse(url) if isinstance(url, str) else None
        if not parsed or parsed.scheme != "https" or not parsed.netloc:
            print(f"{name}: no verified video URL.", file=sys.stderr)
            return 1
        (OUT / f"{name}-url.txt").write_text(url + "\n", encoding="utf-8")
        print(f"{name}: {url}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
