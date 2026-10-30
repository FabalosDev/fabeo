#!/usr/bin/env python3
"""Zoom and pan edit for public/demo.mp4, rendered in a single ffmpeg pass.

The camera is a scale + crop pair driven by per-frame expressions: each frame
is scaled by zoom(t), then a 1920x1080 window is cropped around focus(t).
Both are piecewise with smoothstep (3p^2 - 2p^3) transitions, so every move
eases in and out instead of sliding at a constant speed.

Focus points are SOURCE pixel coordinates, measured on stills of demo.mp4
(1912x1020). To retime or re-aim a shot, edit SHOTS below; nothing else needs
to change.

The window is clamped inside the frame, so a focus point near an edge pans as
far as it can rather than revealing black. That is why the shots aimed at the
left of the screen settle flush against the left edge.

demo.mp4 is 1912x1020, which is not 16:9. A centred 1812x1020 slice is taken
first so the output is true 1920x1080; that trims 50px from each side. Pass
--keep-width to letterbox the full width into 1080p instead.

Usage:
    python zoom_edit.py                     # render out/demo-zoomed.mp4
    python zoom_edit.py --print-filter      # print the filtergraph and exit
    python zoom_edit.py --print-command     # print the ffmpeg command and exit
    python zoom_edit.py --still 178         # render one frame at t=178s
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass

HERE = os.path.dirname(os.path.abspath(__file__))

SRC = os.path.join(HERE, "public", "demo.mp4")
OUT = os.path.join(HERE, "out", "demo-zoomed.mp4")

# Source geometry, from ffprobe.
SRC_W, SRC_H = 1912, 1020

# 16:9 slice of the source, so the output is a true 1920x1080.
BASE_X, BASE_W, BASE_H = 50, 1812, 1020

OUT_W, OUT_H = 1920, 1080

#: Seconds each move takes. Every shot eases in over this long, then holds.
TRANSITION = 1.0

#: Cut here (04:26). The recording itself runs to 04:37.
END = 266.0


@dataclass(frozen=True)
class Shot:
    """One held camera position, in source pixels."""

    label: str
    start: float
    end: float
    zoom: float
    fx: float
    fy: float


#: The edit. Between shots the camera returns to the full frame.
SHOTS = [
    Shot(
        label="First prompt: 'Check the incoming queue stats for hook 4436710'",
        start=0.0,
        end=26.0,
        zoom=1.35,
        fx=809,
        fy=676,  # bottom prompt input bar
    ),
    Shot(
        label="Stats result: 'Hook 4436710 (mcp-queue-demo) has 13 items waiting'",
        start=60.0,
        end=86.0,
        zoom=1.40,
        fx=610,
        fy=473,  # answer block in the chat output
    ),
    Shot(
        label="Second prompt: inspect the first payload",
        start=88.0,
        end=128.0,
        zoom=1.35,
        fx=809,
        fy=676,
    ),
    Shot(
        label='Payload JSON: {"event": "lead_intake", "user": "Frank Abalos", ...}',
        start=174.0,
        end=188.0,
        zoom=1.50,
        fx=468,
        fy=438,  # the code block line
    ),
    Shot(
        label="Third prompt: delete the first queued item",
        start=189.0,
        end=224.0,
        zoom=1.35,
        fx=809,
        fy=676,
    ),
    Shot(
        label="Deletion proof: Before 13 / After 12 table and the deleted item id",
        start=259.0,
        end=END,
        zoom=1.45,
        fx=731,
        fy=462,
    ),
]

#: The resting camera: whole frame, dead centre.
FULL = (1.0, SRC_W / 2.0, SRC_H / 2.0)


def keyframes() -> list[tuple[float, float, float, float]]:
    """Expand SHOTS into (time, zoom, fx, fy) keys with transitions between."""
    keys: list[tuple[float, float, float, float]] = []
    state = FULL

    def add(t: float, value: tuple[float, float, float]) -> None:
        if keys and t <= keys[-1][0]:
            return
        keys.append((t, *value))

    for shot in SHOTS:
        target = (shot.zoom, shot.fx, shot.fy)
        add(shot.start, state)
        add(min(shot.start + TRANSITION, shot.end), target)
        add(shot.end, target)
        state = target
        if shot.end < END:
            add(min(shot.end + TRANSITION, END), FULL)
            state = FULL

    add(END, state)
    return keys


def piecewise(keys: list[tuple[float, float, float, float]], index: int) -> str:
    """Build an ffmpeg expression in t, smoothstepped between keyframes."""
    expr = f"{keys[-1][index]:.4f}"
    for (t0, *a), (t1, *b) in reversed(list(zip(keys, keys[1:]))):
        v0, v1 = a[index - 1], b[index - 1]
        if abs(v1 - v0) < 1e-9:
            segment = f"{v0:.4f}"
        else:
            p = f"((t-{t0:.4f})/{t1 - t0:.4f})"
            smooth = f"({p}*{p}*(3-2*{p}))"
            segment = f"({v0:.4f}+{v1 - v0:.4f}*{smooth})"
        expr = f"if(lt(t,{t1:.4f}),{segment},{expr})"
    return expr


def filtergraph() -> str:
    keys = keyframes()
    zoom = piecewise(keys, 1)
    focus_x = piecewise(keys, 2)
    focus_y = piecewise(keys, 3)

    # Focus is authored in source pixels; shift it into the cropped base frame.
    fx_base = f"(({focus_x})-{BASE_X})"

    # Scale straight to the output aspect, so one scale does zoom and sizing.
    scale_w = f"round({OUT_W}*({zoom})/2)*2"
    scale_h = f"round({OUT_H}*({zoom})/2)*2"

    # Centre the window on the focus point, clamped inside the scaled frame.
    crop_x = f"max(0,min(in_w-out_w,{fx_base}*in_w/{BASE_W}-out_w/2))"
    crop_y = f"max(0,min(in_h-out_h,({focus_y})*in_h/{BASE_H}-out_h/2))"

    # crop takes no eval option in the ffmpeg Remotion ships, but it already
    # re-evaluates x/y every frame, which is what the pan needs. That build
    # has no setsar either, so square pixels are set with -aspect instead.
    return (
        f"crop={BASE_W}:{BASE_H}:{BASE_X}:0,"
        f"scale=w='{scale_w}':h='{scale_h}':eval=frame:flags=lanczos,"
        f"crop=w={OUT_W}:h={OUT_H}:x='{crop_x}':y='{crop_y}'"
    )


def find_ffmpeg() -> str:
    """Prefer a system ffmpeg; fall back to the one Remotion ships."""
    found = shutil.which("ffmpeg")
    if found:
        return found
    bundled = os.path.join(
        HERE,
        "node_modules",
        "@remotion",
        "compositor-win32-x64-msvc",
        "ffmpeg.exe",
    )
    if os.path.exists(bundled):
        return bundled
    sys.exit("ffmpeg not found: install it or pass --ffmpeg PATH")


def build_command(
    ffmpeg: str,
    graph: str,
    src: str,
    out: str,
    still: float | None,
    preset: str = "fast",
    crf: int = 18,
    gpu: bool = False,
    progress: str | None = None,
) -> list[str]:
    command = [ffmpeg, "-y"]
    if still is not None:
        # Input seek with -copyts keeps source timestamps, so the expressions
        # still see the real t rather than restarting at zero.
        command += ["-ss", f"{still:.3f}", "-copyts"]
    command += ["-i", src, "-vf", graph, "-aspect", "16:9"]
    if still is not None:
        return command + ["-frames:v", "1", "-q:v", "2", out]

    if gpu:
        # The RTX 4050 encodes far quicker than x264; -cq is its quality dial.
        video = ["-c:v", "h264_nvenc", "-preset", "p5", "-cq", str(crf), "-b:v", "0"]
    else:
        video = ["-c:v", "libx264", "-preset", preset, "-crf", str(crf)]

    if progress:
        command += ["-progress", progress, "-nostats"]

    return command + ["-t", f"{END:.3f}"] + video + [
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        out,
    ]


def main() -> int:
    # Paths here contain an emoji, which a cp1252 console cannot encode.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--src", default=SRC)
    parser.add_argument("--out", default=OUT)
    parser.add_argument("--ffmpeg")
    parser.add_argument("--still", type=float, help="render one frame at this time")
    parser.add_argument("--preset", default="fast", help="x264 preset")
    parser.add_argument("--crf", type=int, default=18, help="quality, lower is better")
    parser.add_argument("--gpu", action="store_true", help="encode with h264_nvenc")
    parser.add_argument("--progress", help="write ffmpeg progress to this file")
    parser.add_argument("--print-filter", action="store_true")
    parser.add_argument("--print-command", action="store_true")
    args = parser.parse_args()

    graph = filtergraph()
    if args.print_filter:
        print(graph)
        return 0

    ffmpeg = args.ffmpeg or find_ffmpeg()
    out = args.out
    if args.still is not None and out == OUT:
        out = os.path.join(HERE, "out", f"still-{args.still:.0f}.jpg")
    os.makedirs(os.path.dirname(out), exist_ok=True)

    command = build_command(
        ffmpeg,
        graph,
        args.src,
        out,
        args.still,
        preset=args.preset,
        crf=args.crf,
        gpu=args.gpu,
        progress=args.progress,
    )
    if args.print_command:
        print(" ".join(command))
        return 0

    for shot in SHOTS:
        print(f"  {shot.start:6.1f}-{shot.end:6.1f}s  {shot.zoom:.2f}x  {shot.label}")
    print(f"\nrendering {out}")
    return subprocess.call(command)


if __name__ == "__main__":
    raise SystemExit(main())
