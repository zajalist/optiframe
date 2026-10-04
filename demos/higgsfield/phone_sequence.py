"""Compose actual wizard screenshots into a restrained 4K handset cutaway."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path.home() / "Downloads" / "OptiFrame-Demo"
SHOTS = Path.home() / "Downloads" / "OptiFrame-Wizard-Review"
CAPTURE = Path.home() / ".codex" / "codex-remote-attachments" / "01a1027c-2db4-7aa2-bc12-9e37740c5b5c" / "5761000F-777D-4D8B-8D53-F7DF8D783693" / "1-Photo-1.jpg"
W, H = 3840, 2160
FONT = "C:/Windows/Fonts/segoeui.ttf"

STAGES = [
    (CAPTURE, "THE SCAN", (80, 650)),
    ("01-lenses-mobile.jpg", "THE LENSES", (264, 796)),
    ("02-measurement-source-mobile.jpg", "THE FIT", (285, 776)),
    ("03-pupil-distances-mobile.jpg", "THE SPACING", (290, 790)),
    ("04-thickness-mobile.jpg", "THE EDGE", (290, 790)),
    ("05a-left-centre-mobile.jpg", "THE ORIENTATION", (290, 790)),
    ("07-frame-fit-mobile.jpg", "THE PROPORTION", (290, 790)),
    ("08-frame-catalog-mobile.jpg", "THE FRAME", (290, 790)),
    ("09-export-mobile.jpg", "THE TEST KIT", (292, 790)),
]


def frame(source, label, tap):
    screen = Image.open(source).convert("RGB")
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle((155, 94, 542, 197), radius=42, fill=(3, 4, 5, 181))
    d.text((196, 120), "OPTIFRAME", font=ImageFont.truetype(FONT, 43), fill="#f0f0ef")
    d.rounded_rectangle((155, 1850, 710, 1945), radius=40, fill=(3, 4, 5, 181))
    d.text((196, 1880), label, font=ImageFont.truetype(FONT, 31), fill="#e8e9e7")
    # One thin physical phone silhouette. The screenshot is the real app view.
    px, py, pw, ph = 1510, 50, 940, 2060
    d.rounded_rectangle((px-13, py-13, px+pw+13, py+ph+13), radius=132, fill="#202328")
    d.rounded_rectangle((px, py, px+pw, py+ph), radius=120, fill="#020304", outline="#777e81", width=3)
    sx, sy, sw, sh = px+42, py+52, pw-84, ph-104
    screen = screen.resize((sw, sh), Image.Resampling.LANCZOS)
    mask = Image.new("L", (sw, sh), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, sw, sh), radius=80, fill=255)
    canvas.paste(screen.convert("RGBA"), (sx, sy), mask)
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle((px+322, py+36, px+620, py+92), radius=28, fill="#030405")
    if tap:
        tx = sx + int(tap[0] / 390 * sw)
        ty = sy + int(tap[1] / 844 * sh)
        d.ellipse((tx-48, ty-48, tx+48, ty+48), outline="#ffffff", width=7)
        d.ellipse((tx-14, ty-14, tx+14, ty+14), fill="#ffffff")
    return canvas


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for index, (file, label, tap) in enumerate(STAGES, 1):
        source = file if isinstance(file, Path) else SHOTS / file
        if source.exists() and source.stat().st_size > 10000:
            frame(source, label, None).save(OUT / f"phone-{index:02d}.png")
            frame(source, label, tap).save(OUT / f"phone-{index:02d}-tap.png")
    print(OUT)


if __name__ == "__main__":
    main()
