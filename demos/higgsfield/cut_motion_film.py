"""Cut a 25-second 4K screen-free OptiFrame film from Higgsfield shots."""

from io import BytesIO
from pathlib import Path
import subprocess

import cairosvg
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
OUT = Path.home() / "Downloads" / "OptiFrame-Demo"


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *map(str, args)], check=True)


def brand_overlay():
    source = (ROOT / "web/assets/optiframe-logo.svg").read_text(encoding="utf-8")
    rendered = cairosvg.svg2png(bytestring=source.replace("currentColor", "#f5f7fa").encode(),
                                  output_width=760)
    logo = Image.open(BytesIO(rendered)).convert("RGBA")
    canvas = Image.new("RGBA", (3840, 2160), (0, 0, 0, 0))
    canvas.alpha_composite(logo, (160, 670))
    path = OUT / "campaign-brand-overlay.png"
    canvas.save(path)
    return path


def normalize(source, output):
    ffmpeg("-i", source, "-vf", "fps=24,scale=3840:2160:flags=lanczos,format=yuv420p",
           "-t", "5", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "17", output)


def main():
    shots = [
        OUT / "prism-4k.mp4",
        OUT / "higgsfield-motion-optical-4k.mp4",
        OUT / "higgsfield-motion-detail-4k.mp4",
        OUT / "higgsfield-motion-seat-4k.mp4",
    ]
    hero = OUT / "higgsfield-motion-detail-4k.mp4"
    voice = OUT / "voice-natural.wav"
    for path in (*shots, hero, voice):
        if not path.exists() or path.stat().st_size < 100_000:
            raise FileNotFoundError(path)

    clips = []
    for index, source in enumerate(shots, 1):
        output = OUT / f"film-motion-{index:02d}.mp4"
        normalize(source, output)
        clips.append(output)

    brand = brand_overlay()
    outro = OUT / "film-motion-05.mp4"
    ffmpeg("-i", hero, "-loop", "1", "-i", brand,
           "-filter_complex",
           "[0:v]fps=24,scale=3840:2160:flags=lanczos,format=rgba[base];"
           "[1:v]format=rgba,fade=t=in:st=0.7:d=0.8:alpha=1[logo];"
           "[base][logo]overlay=0:0:shortest=1,format=yuv420p[v]",
           "-map", "[v]", "-t", "5", "-an", "-c:v", "libx264",
           "-preset", "medium", "-crf", "17", outro)
    clips.append(outro)

    listing = OUT / "film-motion-concat.txt"
    listing.write_text("".join(f"file '{clip}'\n" for clip in clips), encoding="utf-8")
    output = OUT / "OptiFrame-4K-Higgsfield-Devpost.mp4"
    ffmpeg("-f", "concat", "-safe", "0", "-i", listing, "-i", voice,
           "-map", "0:v", "-map", "1:a", "-vf", "fps=24,format=yuv420p",
           "-c:v", "libx264", "-preset", "medium", "-crf", "18",
           "-c:a", "aac", "-b:a", "160k", "-af", "loudnorm=I=-18:TP=-2:LRA=11",
           "-t", "25", "-movflags", "+faststart", output)
    print(output)


if __name__ == "__main__":
    main()
