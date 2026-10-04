"""Edit the 4K product ad from generated b-roll and optical motion design."""

from pathlib import Path
import subprocess
from PIL import Image, ImageDraw, ImageFont

OUT = Path.home() / "Downloads" / "OptiFrame-Demo"
W, H = 3840, 2160


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *map(str, args)], check=True)


def end_card():
    im = Image.open(OUT / "hero-assembled-4k.png").convert("RGB").resize((W, H))
    shade = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shade_draw = ImageDraw.Draw(shade)
    for x in range(1900):
        alpha = int(208 * (1 - x / 1900) ** 1.65)
        shade_draw.line((x, 0, x, H), fill=(5, 8, 12, alpha))
    im = Image.alpha_composite(im.convert("RGBA"), shade).convert("RGB")
    d = ImageDraw.Draw(im)
    font = "C:/Windows/Fonts/segoeuib.ttf"
    normal = "C:/Windows/Fonts/segoeui.ttf"
    d.text((260, 840), "OptiFrame", font=ImageFont.truetype(font, 172), fill="#f4f4f2")
    d.text((272, 1060), "A new frame for the lenses already here.",
           font=ImageFont.truetype(normal, 49), fill="#d0d2d4")
    im.save(OUT / "campaign-end.jpg", quality=97)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    prism = OUT / "prism-4k.mp4"
    vfx = OUT / "prism-caustic.png"
    concept = OUT / "hero-loop-4k-candidate.mp4"
    voice = OUT / "voice-natural.wav"
    capture = OUT / "campaign-capture-motion.mp4"
    assembly = OUT / "campaign-assembly-motion.mp4"
    for path in (prism, vfx, concept, voice, capture, assembly):
        if not path.exists():
            raise FileNotFoundError(path)

    intro = OUT / "campaign-intro.mp4"
    ffmpeg("-i", prism, "-loop", "1", "-i", vfx,
           "-filter_complex", "[0:v][1:v]overlay=0:0:shortest=1,format=yuv420p[v]",
           "-map", "[v]", "-t", "5", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "17", intro)

    concept_4k = OUT / "campaign-concept-4k.mp4"
    ffmpeg("-i", concept, "-vf", "format=yuv420p",
           "-t", "5", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", concept_4k)

    end_card()
    ending = OUT / "campaign-ending.mp4"
    ffmpeg("-loop", "1", "-i", OUT / "campaign-end.jpg", "-vf", "fps=24,format=yuv420p",
           "-t", "4", "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", ending)

    listing = OUT / "campaign-concat.txt"
    listing.write_text("".join(f"file '{p}'\n" for p in (intro, capture, assembly, concept_4k, ending)), encoding="utf-8")
    master = OUT / "OptiFrame-4K-cinematic-ad.mp4"
    ffmpeg("-f", "concat", "-safe", "0", "-i", listing, "-i", voice,
           "-map", "0:v", "-map", "1:a", "-vf", "fps=24,format=yuv420p",
           "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "aac", "-b:a", "160k",
           "-af", "loudnorm=I=-18:TP=-2:LRA=11", "-t", "25", "-movflags", "+faststart", master)
    print(master)


if __name__ == "__main__":
    main()
