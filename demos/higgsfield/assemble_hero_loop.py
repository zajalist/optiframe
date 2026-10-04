"""Animate the Higgsfield assembled 4K still without moving physical parts."""

from pathlib import Path
import subprocess

from PIL import Image


OUT = Path.home() / "Downloads" / "OptiFrame-Demo"


def main() -> None:
    still = OUT / "hero-assembled-4k.png"
    caustic = OUT / "prism-caustic.png"
    if not still.exists() or not caustic.exists():
        raise FileNotFoundError("The approved still and refraction layer are required.")

    flare = Image.open(caustic).convert("RGBA")
    flare.putalpha(flare.getchannel("A").point(lambda alpha: min(255, alpha * 4)))
    flare_path = OUT / "hero-caustic.png"
    flare.save(flare_path, optimize=True)

    video = OUT / "hero-loop-4k-candidate.mp4"
    filters = (
        "[0:v]zoompan=z='1.017+0.009*sin(2*PI*on/120)':"
        "x='(iw-iw/zoom)/2':y='(ih-ih/zoom)/2':"
        "d=1:s=3840x2160:fps=24[base];"
        "[base][1:v]overlay=x='-600+600*sin(2*PI*t/5)':y=0:"
        "shortest=1:format=auto,format=yuv420p[v]"
    )
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-framerate", "24",
         "-i", str(still), "-loop", "1", "-framerate", "24", "-i", str(flare_path),
         "-filter_complex", filters, "-map", "[v]", "-t", "5", "-an",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "19",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(video)],
        check=True,
    )
    print(video)


if __name__ == "__main__":
    main()
