"""Assemble an honest OptiFrame demo from saved capture stills and UI screenshots."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = Path.home() / "Downloads" / "OptiFrame-Demo"
SHOTS = Path.home() / "Downloads" / "OptiFrame-Wizard-Review"
CAPTURE = Path.home() / ".codex" / "codex-remote-attachments" / "01a1027c-2db4-7aa2-bc12-9e37740c5b5c" / "5761000F-777D-4D8B-8D53-F7DF8D783693" / "1-Photo-1.jpg"
FONT = Path("C:/Windows/Fonts/segoeui.ttf")
BOLD = Path("C:/Windows/Fonts/segoeuib.ttf")
W, H = 1280, 720


def txt(draw, xy, value, size, color, bold=False):
    draw.text(xy, value, font=ImageFont.truetype(str(BOLD if bold else FONT), size), fill=color)


def cover(image, size):
    scale = max(size[0] / image.width, size[1] / image.height)
    image = image.resize((int(image.width * scale), int(image.height * scale)), Image.Resampling.LANCZOS)
    left, top = (image.width - size[0]) // 2, (image.height - size[1]) // 2
    return image.crop((left, top, left + size[0], top + size[1]))


def card(number, headline, subtitle, image_path, caption, output):
    canvas = Image.new("RGB", (W, H), "#101518")
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle((38, 38, 1242, 682), radius=38, fill="#192126", outline="#48606a", width=2)
    d.rounded_rectangle((682, 74, 1194, 642), radius=30, fill="#dfe8ec")
    if image_path.exists():
        source = Image.open(image_path).convert("RGB")
        area = cover(source, (468, 524))
        mask = Image.new("L", area.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, area.width, area.height), radius=22, fill=255)
        canvas.paste(area, (704, 96), mask)
    d = ImageDraw.Draw(canvas)
    txt(d, (86, 91), "OPTIFRAME     /     THE PROCESS", 18, "#a1d2df", True)
    txt(d, (86, 198), f"{number:02d}", 88, "#79cce2", True)
    for i, line in enumerate(headline.split("\n")):
        txt(d, (86, 321 + i * 67), line, 52, "#f2f6f7", True)
    txt(d, (88, 510), subtitle, 23, "#bed0d5")
    d.line((88, 605, 615, 605), fill="#55717a", width=2)
    txt(d, (88, 619), caption, 16, "#9ab4bc")
    canvas.save(output, quality=95)


def run():
    OUT.mkdir(parents=True, exist_ok=True)
    stages = [
        (1, "Start with your\nexisting lenses", "A measured capture sheet anchors scale.", CAPTURE,
         "Actual user capture still; camera motion is simulated."),
        (2, "Review both\nlens outlines", "Check the projected shape before building.", SHOTS / "01-lenses-mobile.jpg",
         "App screen from a saved example session."),
        (3, "Confirm how the\nframe should fit", "Choose a source for face measurements.", SHOTS / "02-measurement-source-mobile.jpg",
         "Visual estimate is provisional, not an optical measurement."),
        (4, "Set pupil spacing\nand edge thickness", "Small details drive the CAD geometry.", SHOTS / "04-thickness-mobile.jpg",
         "Example values shown for a prototype build."),
        (5, "Pick the style\nand lens retention", "Classic, Bold or Brow. Screw, pins or clip-in.", SHOTS / "08-frame-catalog-mobile.jpg",
         "Rendered preview from the OptiFrame wizard."),
        (6, "Export a printable\ntest kit", "Inspect fit and retention before use.", SHOTS / "09-export-mobile.jpg",
         "Physical lens fit remains to be verified."),
    ]
    clips = []
    for num, headline, subtitle, image, caption in stages:
        jpg = OUT / f"scene-{num:02d}.jpg"
        mp4 = OUT / f"scene-{num:02d}.mp4"
        card(num, headline, subtitle, image, caption, jpg)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-t", "3.5", "-i", str(jpg),
                        "-vf", "zoompan=z='min(zoom+0.00025,1.025)':d=1:s=1280x720:fps=24,format=yuv420p",
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-t", "3.5", str(mp4)], check=True)
        clips.append(mp4)
    hero = ROOT / "web" / "assets" / "hero-loop.mp4"
    concat = OUT / "concat.txt"
    concat.write_text("file '" + str(hero).replace("'", "'\\''") + "'\n" +
                      "".join("file '" + str(x).replace("'", "'\\''") + "'\n" for x in clips), encoding="utf-8")
    final = OUT / "OptiFrame-e2e-visual-demo.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(concat),
                    "-vf", "fps=24,scale=1280:720,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "19",
                    "-movflags", "+faststart", "-an", str(final)], check=True)
    print(final)


if __name__ == "__main__":
    run()
