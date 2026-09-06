import type { KeyframeFocus } from "./ZoomCamera";

/**
 * One entry from public/events.json, as written by recorder.py.
 * Coordinates are already in composition pixels if the recorder ran with the
 * right --scale; see the notes in recorder.py.
 */
export interface RecordedEvent {
  /** Seconds since the recorder started. */
  time: number;
  x: number;
  y: number;
  type: "click" | "type";
  /** Present on clicks: "left" | "right" | "middle". */
  button?: string;
  /** Present on typing bursts: how long the burst ran, in seconds. */
  duration?: number;
}

export interface EventCameraOptions {
  fps: number;
  /** Where the camera rests between targets. */
  wide: { x: number; y: number };
  /** Zoom used for a click target. */
  clickScale?: number;
  /** Zoom used for a typing burst. Usually tighter: you are reading text. */
  typeScale?: number;
  /** Frames each camera move takes. */
  moveDuration?: number;
  /** Frames to dwell on a target after arriving. */
  holdDuration?: number;
  /** Targets within this many pixels are treated as the same area. */
  mergeDistance?: number;
  /** Pull back to the wide shot if nothing happens for this long. */
  idleResetSeconds?: number;
  /**
   * Seconds trimmed off the front of the video. An event recorded at t=30s
   * appears at composition frame 0 when this is 30.
   */
  startOffsetSeconds?: number;
  /** Frames of wide shot to leave after the last event. */
  tailFrames?: number;
}

export interface EventCameraResult {
  keyframes: KeyframeFocus[];
  /** Timeline length needed to play every derived move to completion. */
  durationInFrames: number;
}

/** One dwell on a target, before it is expanded into keyframes. */
interface Shot {
  x: number;
  y: number;
  scale: number;
  /** Frame the camera should have finished arriving by. */
  arrive: number;
  /** Frame the camera may start leaving after. */
  until: number;
}

const DEFAULTS = {
  clickScale: 2.0,
  typeScale: 2.2,
  moveDuration: 85,
  holdDuration: 35,
  mergeDistance: 160,
  idleResetSeconds: 2.5,
  startOffsetSeconds: 0,
  tailFrames: 50,
};

/**
 * Turn a recorded event log into a camera timeline.
 *
 * The central rule is that the camera *arrives* as the event happens rather
 * than starting to move then: a viewer should already be looking at the button
 * when it is clicked. Each shot therefore begins moving moveDuration frames
 * before its event.
 */
export const eventsToKeyframes = (
  events: RecordedEvent[],
  options: EventCameraOptions,
): EventCameraResult => {
  const {
    fps,
    wide,
    clickScale,
    typeScale,
    moveDuration,
    holdDuration,
    mergeDistance,
    idleResetSeconds,
    startOffsetSeconds,
    tailFrames,
  } = { ...DEFAULTS, ...options };

  const widePose = { ...wide, scale: 1 };
  const idleResetFrames = Math.round(idleResetSeconds * fps);

  // --- 1. Events to shots -------------------------------------------------
  //
  // Events land in composition frames, and neighbouring events in the same
  // area collapse into a single dwell so the camera does not jog between two
  // clicks a few pixels apart.
  const shots: Shot[] = [];

  const timed = events
    .map((event) => ({
      ...event,
      frame: Math.round((event.time - startOffsetSeconds) * fps),
    }))
    .filter((event) => event.frame >= 0)
    .sort((a, b) => a.frame - b.frame);

  for (const event of timed) {
    const scale = event.type === "type" ? typeScale : clickScale;
    const burstFrames =
      event.type === "type" ? Math.round((event.duration ?? 0) * fps) : 0;
    const until = event.frame + burstFrames + holdDuration;

    const previous = shots[shots.length - 1];
    if (previous) {
      const dx = event.x - previous.x;
      const dy = event.y - previous.y;
      const isSameArea = dx * dx + dy * dy <= mergeDistance * mergeDistance;
      // Only merge while the previous shot is still on screen; a return to the
      // same spot a minute later deserves its own move.
      const isStillLive = event.frame <= previous.until + moveDuration;

      if (isSameArea && isStillLive) {
        previous.until = Math.max(previous.until, until);
        // A typing burst inside a click's dwell tightens the framing.
        previous.scale = Math.max(previous.scale, scale);
        continue;
      }
    }

    shots.push({ x: event.x, y: event.y, scale, arrive: event.frame, until });
  }

  // --- 2. Shots to keyframes ----------------------------------------------

  const keyframes: KeyframeFocus[] = [{ frame: 0, ...widePose }];

  /** Append a keyframe, keeping frames strictly increasing. */
  const push = (keyframe: KeyframeFocus): void => {
    const last = keyframes[keyframes.length - 1];
    if (keyframe.frame <= last.frame) {
      // Dense events can ask for a move that has already started. Nudging
      // forward keeps the timeline valid; the move simply gets compressed.
      keyframes.push({ ...keyframe, frame: last.frame + 1 });
      return;
    }
    keyframes.push(keyframe);
  };

  let pose = widePose;

  shots.forEach((shot, index) => {
    const cursor = keyframes[keyframes.length - 1].frame;
    const moveStart = Math.max(cursor, shot.arrive - moveDuration);

    // Hold the current pose until it is time to start travelling.
    if (moveStart > cursor) {
      push({ frame: moveStart, ...pose });
    }

    pose = { x: shot.x, y: shot.y, scale: shot.scale };
    push({ frame: Math.max(shot.arrive, moveStart + 1), ...pose, easing: "spring" });
    push({ frame: shot.until, ...pose });

    // If the next shot is a long way off, pull back to the wide shot rather
    // than sitting zoomed into a stale target.
    const next = shots[index + 1];
    if (next) {
      const nextMoveStart = next.arrive - moveDuration;
      const gap = nextMoveStart - keyframes[keyframes.length - 1].frame;
      if (gap > idleResetFrames + moveDuration) {
        pose = widePose;
        push({
          frame: keyframes[keyframes.length - 1].frame + moveDuration,
          ...pose,
          easing: "spring",
        });
      }
    }
  });

  // --- 3. Land back on the wide shot --------------------------------------

  if (shots.length > 0) {
    pose = widePose;
    push({
      frame: keyframes[keyframes.length - 1].frame + moveDuration,
      ...pose,
      easing: "spring",
    });
  }

  const durationInFrames = keyframes[keyframes.length - 1].frame + tailFrames;
  push({ frame: durationInFrames, ...widePose });

  return { keyframes, durationInFrames };
};
