"""Make a narration-ready OptiFrame film with short optical transitions."""

from pathlib import Path
import argparse
import subprocess


OUT = Path.home() / "Downloads" / "OptiFrame-Demo"
CLIPS = [OUT / f"film-motion-{index:02d}.mp4" for index in range(1, 6)]
CLIP_SECONDS = 5.0
TRANSITIONS = (
    ("hblur", 6 / 24),
    ("hblur", 6 / 24),
    ("fade", 2 / 24),
    ("fade", 2 / 24),
)


def cut(*, width: int, height: int, output: Path, preset: str) -> None:
    for clip in CLIPS:
        if not clip.is_file():
            raise FileNotFoundError(f"Missing source shot: {clip}")

    command = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    for clip in CLIPS:
        command += ["-i", str(clip)]

    chains = [
        f"[{index}:v]fps=24,scale={width}:{height}:flags=lanczos,"
        "setsar=1,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS"
        f"[shot{index}]"
        for index in range(len(CLIPS))
    ]
    previous = "shot0"
    elapsed_overlap = 0.0
    for index, (transition, duration) in enumerate(TRANSITIONS, 1):
        name = f"cut{index}"
        elapsed_overlap += duration
        offset = CLIP_SECONDS * index - elapsed_overlap
        chains.append(
            f"[{previous}][shot{index}]xfade=transition={transition}:"
            f"duration={duration:.6f}:offset={offset:.6f}[{name}]"
        )
        previous = name

    chains.append(f"[{previous}]format=yuv420p[v]")
    command += [
        "-filter_complex", ";".join(chains), "-map", "[v]", "-an",
        "-r", "24", "-c:v", "libx264", "-preset", preset, "-crf", "17",
        "-color_primaries", "bt709", "-color_trc", "bt709",
        "-colorspace", "bt709", "-movflags", "+faststart", str(output),
    ]
    subprocess.run(command, check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--proxy", action="store_true")
    args = parser.parse_args()
    name = "OptiFrame-visual-cut-v2-preview.mp4" if args.proxy else "OptiFrame-4K-visual-cut-v2.mp4"
    output = OUT / name
    cut(width=1280 if args.proxy else 3840,
        height=720 if args.proxy else 2160,
        output=output, preset="veryfast" if args.proxy else "medium")
    print(output)
