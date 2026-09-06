#!/usr/bin/env python3
"""Fabeo screen event recorder.

Captures global mouse clicks and typing bursts while you record your screen, so
the Remotion camera can be pointed at real coordinates instead of guessed ones.
The output lands in public/events.json, ready to import into a composition.

Privacy note: this records WHERE and WHEN you clicked and typed. It never
records WHICH keys you pressed, and no key content is written to disk.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from threading import Lock

# --- Tuning -----------------------------------------------------------------

# Two clicks closer than this in both space and time are treated as one click.
# This is what stops double-clicks and hand tremor from flooding the timeline
# with near-identical camera targets.
CLICK_MIN_INTERVAL_SECONDS = 0.35
CLICK_MIN_DISTANCE_PIXELS = 40

# A typing burst ends once this much time passes with no printable keystroke.
# One burst produces one "type" event, not one per character.
TYPING_DEBOUNCE_SECONDS = 1.2

DEFAULT_OUTPUT = Path(__file__).parent / "public" / "events.json"

INSTALL_HELP = """
Fabeo recorder needs pynput, which is not installed.

    pip install pynput

On Windows, run it from the same interpreter you use for this script:

    python -m pip install pynput
"""

USAGE_HELP = """
------------------------------------------------------------------
 Fabeo screen event recorder
------------------------------------------------------------------
 1. Start your screen recorder FIRST, then start this script, so the
    two timelines share a zero point. Every timestamp below is
    relative to the moment this script started.
 2. Record your workflow as normal.
 3. Press Ctrl+C here to stop. Events are saved automatically.

 Captured: click position + button, and typing bursts (timing and
 the last known pointer position). Key contents are never recorded.
------------------------------------------------------------------
"""

# pynput is imported defensively so this module stays importable (and the
# filtering logic stays unit-testable) on machines without it installed.
try:
    from pynput import keyboard, mouse

    PYNPUT_AVAILABLE = True
except ImportError:  # pragma: no cover - depends on the local environment
    keyboard = None
    mouse = None
    PYNPUT_AVAILABLE = False


class EventRecorder:
    """Collects click and typing events on a timeline relative to start_time."""

    def __init__(self, scale: float = 1.0, quiet: bool = False) -> None:
        self.scale = scale
        self.quiet = quiet
        self.start_time = time.time()

        self.events: list[dict] = []
        self._lock = Lock()

        # Last click, kept as (x, y, timestamp) for the jitter filter.
        self._last_click: tuple[int, int, float] | None = None

        # Last known pointer position, updated by moves and clicks alike. A
        # typing burst is attributed to wherever the pointer was resting, which
        # is almost always the field being typed into.
        self._pointer: tuple[int, int] = (0, 0)

        # Open typing burst, if any: the event dict plus the last keystroke time.
        self._typing_event: dict | None = None
        self._last_key_time: float = 0.0

    # --- Timeline helpers ---------------------------------------------------

    def _now(self) -> float:
        """Seconds since recording started."""
        return time.time() - self.start_time

    def _scaled(self, x: float, y: float) -> tuple[int, int]:
        """Map raw screen pixels into the target composition's pixel space."""
        return round(x * self.scale), round(y * self.scale)

    def _log(self, message: str) -> None:
        if not self.quiet:
            print(message, flush=True)

    # --- Filtering ----------------------------------------------------------

    def _is_jitter(self, x: int, y: int, now: float) -> bool:
        """True if this click is a near-duplicate of the previous one.

        Both conditions must hold: a fast click far away is a real second
        target, and a slow click in the same spot is a real second visit.
        """
        if self._last_click is None:
            return False

        last_x, last_y, last_time = self._last_click
        if now - last_time > CLICK_MIN_INTERVAL_SECONDS:
            return False

        dx = x - last_x
        dy = y - last_y
        return dx * dx + dy * dy < CLICK_MIN_DISTANCE_PIXELS**2

    @staticmethod
    def _is_typing_key(key) -> bool:
        """True for keys that represent actual typing, not bare modifiers.

        Holding Shift or pressing Ctrl+C should not open a typing burst. Only
        the key's category is inspected; its value is never stored.
        """
        if keyboard is None:
            return True

        if isinstance(key, keyboard.KeyCode):
            # A printable character. Ctrl+<letter> arrives with char set to a
            # control code (\x00-\x1f), which is a shortcut, not typing.
            if key.char is None:
                return False
            return not (len(key.char) == 1 and ord(key.char) < 32)

        return key in {
            keyboard.Key.space,
            keyboard.Key.enter,
            keyboard.Key.backspace,
            keyboard.Key.tab,
            keyboard.Key.delete,
        }

    # --- Event handlers -----------------------------------------------------

    def on_move(self, x: float, y: float) -> None:
        """Track the pointer without logging it; moves are far too frequent."""
        self._pointer = self._scaled(x, y)

    def on_click(self, x: float, y: float, button, pressed: bool) -> None:
        if not pressed:
            # Only the press edge is interesting; the release would double up.
            return

        now = self._now()
        point = self._scaled(x, y)
        self._pointer = point

        with self._lock:
            if self._is_jitter(point[0], point[1], now):
                self._log(f"  skipped jitter click at {point}")
                return

            self._last_click = (point[0], point[1], now)
            # A click ends any open typing burst: attention has moved on.
            self._close_typing_burst(now)

            self.events.append(
                {
                    "time": round(now, 3),
                    "x": point[0],
                    "y": point[1],
                    "type": "click",
                    "button": getattr(button, "name", str(button)),
                }
            )

        self._log(f"[{now:7.2f}s] click  {point}")

    def on_press(self, key) -> None:
        if not self._is_typing_key(key):
            return

        now = self._now()

        with self._lock:
            # Lazily close a burst that already went quiet, then open a new one.
            # This avoids needing a watchdog thread to expire bursts.
            if (
                self._typing_event is not None
                and now - self._last_key_time > TYPING_DEBOUNCE_SECONDS
            ):
                self._close_typing_burst(self._last_key_time)

            if self._typing_event is None:
                self._typing_event = {
                    "time": round(now, 3),
                    "x": self._pointer[0],
                    "y": self._pointer[1],
                    "type": "type",
                    "duration": 0.0,
                }
                self.events.append(self._typing_event)
                self._log(f"[{now:7.2f}s] typing {self._pointer} started")

            self._last_key_time = now

    # --- Burst bookkeeping --------------------------------------------------

    def _close_typing_burst(self, ended_at: float) -> None:
        """Stamp the open burst with how long it ran. Caller holds the lock."""
        if self._typing_event is None:
            return

        duration = max(0.0, ended_at - self._typing_event["time"])
        self._typing_event["duration"] = round(duration, 3)
        self._log(f"           typing stopped after {duration:.2f}s")
        self._typing_event = None

    def finalise(self) -> None:
        """Close anything still open. Call once, after the listeners stop."""
        with self._lock:
            self._close_typing_burst(self._last_key_time or self._now())

    # --- Output -------------------------------------------------------------

    def save(self, output: Path) -> None:
        output.parent.mkdir(parents=True, exist_ok=True)
        with self._lock:
            payload = sorted(self.events, key=lambda event: event["time"])
        output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    def summary(self) -> str:
        clicks = sum(1 for event in self.events if event["type"] == "click")
        types = sum(1 for event in self.events if event["type"] == "type")
        return f"{len(self.events)} events ({clicks} clicks, {types} typing bursts)"


def enable_dpi_awareness() -> None:
    """Opt into true physical pixels on Windows.

    Without this, a display scaled to 125% reports 1536x864 for a physical
    1920x1080 panel, and pynput hands back coordinates in that shrunken space.
    Every captured point would then be 1.25x off from the recorded video. Must
    run before any coordinate is read.
    """
    if sys.platform != "win32":
        return

    try:
        import ctypes

        # 2 = PROCESS_PER_MONITOR_DPI_AWARE. Falls back to the older per-process
        # call on Windows 8 and earlier.
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:  # pragma: no cover - depends on the Windows version
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


def detect_screen_width() -> int | None:
    """Best-effort primary screen width, used only to suggest a scale factor.

    This reads the same coordinate space pynput reports in, so the ratio
    against the composition width is always the right conversion factor.
    """
    if sys.platform == "win32":
        try:
            import ctypes

            return int(ctypes.windll.user32.GetSystemMetrics(0))
        except Exception:  # pragma: no cover - defensive, never fatal
            return None
    return None


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Record mouse clicks and typing bursts for the Fabeo camera.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Where to write the event log (default: public/events.json)",
    )
    parser.add_argument(
        "--scale",
        type=float,
        default=1.0,
        help=(
            "Multiply captured coordinates by this factor to convert screen "
            "pixels into composition pixels. A 3840-wide screen feeding a "
            "1920-wide composition needs --scale 0.5 (default: 1.0)"
        ),
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Do not print events as they are captured",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    if not PYNPUT_AVAILABLE:
        print(INSTALL_HELP)
        return 1

    print(USAGE_HELP)

    enable_dpi_awareness()
    screen_width = detect_screen_width()
    if screen_width and args.scale == 1.0:
        suggested = 1920 / screen_width
        if abs(suggested - 1.0) > 0.01:
            print(
                f" Screen is {screen_width}px wide. For a 1920px composition,\n"
                f" re-run with --scale {suggested:.4g} to record coordinates\n"
                f" directly in composition space.\n"
            )

    recorder = EventRecorder(scale=args.scale, quiet=args.quiet)

    mouse_listener = mouse.Listener(
        on_click=recorder.on_click,
        on_move=recorder.on_move,
    )
    keyboard_listener = keyboard.Listener(on_press=recorder.on_press)

    mouse_listener.start()
    keyboard_listener.start()
    print(" Recording. Press Ctrl+C to stop.\n")

    try:
        # Poll rather than join(), so Ctrl+C is delivered promptly on Windows.
        while mouse_listener.running and keyboard_listener.running:
            time.sleep(0.2)
    except KeyboardInterrupt:
        print("\n Stopping...")
    finally:
        # Always stop the listeners and save, even if something above threw:
        # a recording session that cannot be repeated is worth protecting.
        mouse_listener.stop()
        keyboard_listener.stop()
        recorder.finalise()
        recorder.save(args.output)
        print(f" Saved {recorder.summary()} to {args.output}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
