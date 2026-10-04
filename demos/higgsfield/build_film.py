"""Cut a restrained product film from real capture stills and app output."""

from pathlib import Path
import subprocess
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = Path.home() / "Downloads" / "OptiFrame-Demo"
SHOTS = Path.home() / "Downloads" / "OptiFrame-Wizard-Review"
CAPTURE = Path.home() / ".codex" / "codex-remote-attachments" / "01a1027c-2db4-7aa2-bc12-9e37740c5b5c" / "5761000F-777D-4D8B-8D53-F7DF8D783693" / "1-Photo-1.jpg"
FONT = "C:/Windows/Fonts/segoeuib.ttf"
W, H = 1280, 720


def cover(im, size):
    factor = max(size[0] / im.width, size[1] / im.height)
    im = im.resize((round(im.width * factor), round(im.height * factor)), Image.Resampling.LANCZOS)
    x, y = (im.width - size[0]) // 2, (im.height - size[1]) // 2
    return im.crop((x, y, x + size[0], y + size[1]))


def still(path, label, outfile, crop=None):
    source = Image.open(path).convert("RGB")
    if crop:
        source = source.crop(crop)
    background = cover(source, (W, H)).filter(ImageFilter.GaussianBlur(35))
    background = Image.blend(background, Image.new("RGB", (W, H), "#08090b"), 0.56)
    # The real image itself meets the video edges. No fake phone shell or card.
    foreground = source.resize((round(source.width * H / source.height), H), Image.Resampling.LANCZOS)
    x = (W - foreground.width) // 2
    background.paste(foreground, (x, 0))
    d = ImageDraw.Draw(background)
    d.rectangle((0, 0, W, 84), fill="#090a0b")
    d.text((48, 31), label, font=ImageFont.truetype(FONT, 18), fill="#ffffff")
    background.save(outfile, quality=96)


def title(outfile):
    im = Image.new("RGB", (W, H), "#090a0b")
    d = ImageDraw.Draw(im)
    d.text((74, 264), "A NEW FRAME.", font=ImageFont.truetype(FONT, 82), fill="#f7f7f4")
    d.text((79, 374), "FOR THE LENSES ALREADY HERE.", font=ImageFont.truetype(FONT, 32), fill="#aeb1b1")
    d.text((79, 614), "OPTIFRAME", font=ImageFont.truetype(FONT, 18), fill="#e8e9e7")
    im.save(outfile, quality=96)


def clip(image, seconds, outfile):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-i", str(image),
                    "-vf", "zoompan=z='min(zoom+0.00025,1.018)':d=1:s=1280x720:fps=24,format=yuv420p",
                    "-t", str(seconds), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", str(outfile)], check=True)


def run():
    OUT.mkdir(parents=True, exist_ok=True)
    scenes = [
        (CAPTURE, "CAPTURE  /  ACTUAL LENS PHOTO", 4, (72, 216, 518, 1008)),
        (SHOTS / "01-lenses-mobile.jpg", "TRACE  /  CALIBRATED OUTLINES", 3, (18, 78, 375, 647)),
        (SHOTS / "03-pupil-distances-mobile.jpg", "FIT  /  CONFIRM MEASUREMENTS", 3, None),
        (SHOTS / "04-thickness-mobile.jpg", "EDGE  /  MEASURE THICKNESS", 3, None),
        (SHOTS / "08-frame-catalog-mobile.jpg", "STYLE  /  FRAME + RETENTION", 4, None),
        (SHOTS / "09-export-mobile.jpg", "PRINT  /  TEST KIT", 3, None),
    ]
    files = [OUT / "higgsfield-concept.mp4"]
    for i, (source, label, seconds, crop) in enumerate(scenes, 1):
        frame, video = OUT / f"film-{i:02d}.jpg", OUT / f"film-{i:02d}.mp4"
        still(source, label, frame, crop)
        clip(frame, seconds, video)
        files.append(video)
    ending = OUT / "film-end.jpg"
    title(ending)
    clip(ending, 3, OUT / "film-end.mp4")
    files.append(OUT / "film-end.mp4")
    listing = OUT / "film-concat.txt"
    listing.write_text("".join(f"file '{p}'\n" for p in files), encoding="utf-8")
    final = OUT / "OptiFrame-product-film.mp4"
    voice = OUT / "voice-only-narration.wav"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing),
                    "-i", str(voice), "-vf", "fps=24,scale=1280:720,format=yuv420p",
                    "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "medium", "-crf", "19",
                    "-c:a", "aac", "-b:a", "160k", "-af", "loudnorm=I=-18:TP=-2:LRA=11",
                    "-t", "28", "-movflags", "+faststart", str(final)], check=True)
    print(final)


if __name__ == "__main__":
    run()
