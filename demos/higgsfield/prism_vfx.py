"""Subtle optical caustic overlay for the 4K campaign edit."""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path.home() / "Downloads" / "OptiFrame-Demo" / "prism-caustic.png"
W, H = 3840, 2160
im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(im)
origin = (1750, 1050)
bands = [
    ((245, 82, 88, 40), 610),
    ((250, 167, 72, 35), 658),
    ((254, 226, 126, 30), 706),
    ((98, 221, 174, 28), 754),
    ((90, 149, 245, 32), 802),
    ((155, 110, 220, 26), 850),
]
for color, y in bands:
    d.polygon([origin, (W, y), (W, y+24)], fill=color)
im = im.filter(ImageFilter.GaussianBlur(42))
im.save(OUT)
print(OUT)
