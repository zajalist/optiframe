"""Create billable Higgsfield 4K shots for the screen-free product film."""

import os
import sys
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import urlopen

from dotenv import load_dotenv
import higgsfield_client


ROOT = Path(__file__).resolve().parents[2]
OUT = Path.home() / "Downloads" / "OptiFrame-Demo"

SHOTS = (
    (
        "optical",
        "kling-video/v3.0/4k/text-to-video",
        "One continuous luxury optical motion-design shot on a near-black studio stage. "
        "Two clear, asymmetrical prescription lens blanks float in space. A razor-thin white light "
        "passes through their thickness, refracting into a restrained rainbow caustic and delicate "
        "volumetric rays. Their edges glow briefly, then real sculpted graphite-black bevels grow "
        "around the physical glass, aligning into a believable spectacle front. Very sharp macro "
        "cinematography, physically plausible refraction, deep shadow, no flat diagrams. No screen, "
        "phone, app interface, floating text, infographic, hands, people, music, or extra glasses.",
    ),
    (
        "seat",
        "kling-video/v3.0/4k/image-to-video",
        "Preserve the exact slim black OptiFrame glasses from the input product image. One continuous "
        "cinematic macro camera move. The two existing clear lenses rise only a few millimetres out "
        "of their rims and gently seat into the frame in a physically believable motion. A fine "
        "white light traces the glass edges; a restrained spectrum bends through the lens. Keep "
        "both temples, bridge, hinges and lens shapes unchanged. Black editorial stage, crisp "
        "machined bevels, premium product advertising. No text, UI, phone, people or sound.",
    ),
    (
        "detail",
        "kling-video/v3.0/4k/image-to-video",
        "Preserve the exact slim black OptiFrame glasses from the input product image. A controlled "
        "camera arc travels from the front lens edge along one slim temple and hinge, then returns "
        "to a dramatic three-quarter hero angle. A travelling softbox reveals precise chamfers, "
        "dark graphite finish, clean screw detail and a small single-temple brand mark. Transparent "
        "lenses throw a very subtle spectral caustic. Luxury eyewear campaign, extremely clean "
        "4K product photography, no other objects, no phone, no app screen, no invented typography, "
        "no people, no sound.",
    ),
)


def video_url(result):
    if not isinstance(result, dict):
        return None
    if str(result.get("status", "")).lower() in {
        "failed", "canceled", "cancelled", "moderated", "rejected"
    }:
        return None
    value = result.get("video")
    url = value.get("url") if isinstance(value, dict) else value
    parsed = urlparse(url) if isinstance(url, str) else None
    return url if parsed and parsed.scheme == "https" and parsed.netloc else None


def main():
    load_dotenv(ROOT / ".env.local", override=False)
    if not os.environ.get("HF_KEY"):
        load_dotenv(ROOT.parent / ".env.local", override=False)
    if ":" not in os.environ.get("HF_KEY", ""):
        print("HF_KEY missing; enter it locally in the ignored .env.local.", file=sys.stderr)
        return 2
    image_url = (OUT / "hero-assembled-url.txt").read_text(encoding="utf-8").strip()
    if urlparse(image_url).scheme != "https":
        print("Product source URL is unavailable.", file=sys.stderr)
        return 2
    for name, model, prompt in SHOTS:
        output = OUT / f"higgsfield-motion-{name}-4k.mp4"
        if output.exists() and output.stat().st_size > 100_000:
            print(f"{name}: saved shot already exists", flush=True)
            continue
        args = {
            "prompt": prompt,
            "duration": 5,
            "sound": "off",
            "cfg_scale": .55,
            "multi_shots": False,
        }
        if name == "optical":
            args["aspect_ratio"] = "16:9"
        else:
            args["image_url"] = image_url
        print(f"{name}: generating with Higgsfield", flush=True)
        try:
            result = higgsfield_client.subscribe(model, arguments=args)
            url = video_url(result)
            if not url:
                status = result.get("status") if isinstance(result, dict) else type(result).__name__
                print(f"{name}: no completed video URL (status: {status})", file=sys.stderr)
                return 1
            with urlopen(url, timeout=120) as source, output.open("wb") as target:
                while chunk := source.read(1024 * 1024):
                    target.write(chunk)
        except Exception as exc:
            # SDK errors may include sensitive request data. Report type only.
            print(f"{name}: generation or download failed ({type(exc).__name__}).", file=sys.stderr)
            return 1
        print(f"{name}: saved 4K shot", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
