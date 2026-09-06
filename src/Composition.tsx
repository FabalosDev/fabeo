import React from "react";
import {
  AbsoluteFill,
  CalculateMetadataFunction,
  OffthreadVideo,
  staticFile,
} from "remotion";
import {
  eventsToKeyframes,
  RecordedEvent,
} from "./eventsToKeyframes";
import { FocusRing, KeyframeFocus, ZoomCamera } from "./ZoomCamera";

/**
 * The screen recording the camera flies over, and the event log recorded
 * alongside it by recorder.py. Both live in public/, so they are addressed with
 * staticFile() rather than an import.
 */
export const VIDEO_SRC = "tutorial.mp4";
export const EVENTS_SRC = "events.json";

/** Composition frame rate. The source is 30fps; 60 keeps the camera smooth. */
export const VIDEO_FPS = 60;

/**
 * public/tutorial.mp4 is 9m37s, which is 34,613 frames at 60fps: far too long
 * to scrub while tuning, and slow to render. The timeline length is derived
 * from the event log, then capped here so one stray late event cannot turn a
 * preview into a ten-minute render. Raise it to cover a longer session.
 */
export const VIDEO_START_SECONDS = 0;
export const MAX_PREVIEW_SECONDS = 24;

/** Used only when there is no usable event log to derive a timeline from. */
export const FALLBACK_DURATION = 20 * VIDEO_FPS;

/**
 * Camera shape. These feed eventsToKeyframes() and are the main dials for how
 * the derived camera behaves; they are not tied to any particular recording.
 */
export const CAMERA_OPTIONS = {
  fps: VIDEO_FPS,
  /** Where the camera rests between targets: the centre of the frame. */
  wide: { x: 960, y: 540 },
  clickScale: 2.0,
  typeScale: 2.2,
  moveDuration: 85,
  holdDuration: 35,
  mergeDistance: 160,
  idleResetSeconds: 2.5,
  startOffsetSeconds: VIDEO_START_SECONDS,
} as const;

/**
 * Camera used when public/events.json is missing or unreadable, so the
 * composition still renders something sensible before the first recording.
 */
export const FALLBACK_KEYFRAMES: KeyframeFocus[] = [
  { frame: 0, x: 960, y: 540, scale: 1 },
  { frame: 45, x: 960, y: 540, scale: 1 },
  { frame: 130, x: 960, y: 420, scale: 2.0, easing: "spring" },
  { frame: 165, x: 960, y: 420, scale: 2.0 },
  { frame: 250, x: 1240, y: 620, scale: 2.4, easing: "ease-in-out" },
  { frame: 285, x: 1240, y: 620, scale: 2.4 },
  { frame: 370, x: 960, y: 540, scale: 1, easing: "spring" },
  { frame: FALLBACK_DURATION, x: 960, y: 540, scale: 1 },
];

export type FabeoDemoProps = {
  keyframes: KeyframeFocus[];
};

/**
 * Read the recorded events and turn them into the camera timeline, setting the
 * composition length to match. Runs before the first frame is rendered, so the
 * timeline never has to be committed to source.
 */
export const calculateFabeoMetadata: CalculateMetadataFunction<
  FabeoDemoProps
> = async () => {
  try {
    const response = await fetch(staticFile(EVENTS_SRC));
    if (!response.ok) {
      throw new Error(`events.json returned ${response.status}`);
    }

    const events = (await response.json()) as RecordedEvent[];
    if (!Array.isArray(events) || events.length === 0) {
      throw new Error("events.json is empty");
    }

    const derived = eventsToKeyframes(events, CAMERA_OPTIONS);
    return {
      props: { keyframes: derived.keyframes },
      durationInFrames: Math.min(
        derived.durationInFrames,
        MAX_PREVIEW_SECONDS * VIDEO_FPS,
      ),
    };
  } catch (error) {
    // A missing or malformed log is expected before the first recording, so
    // fall back rather than failing the whole composition.
    console.warn(
      `[Fabeo] Falling back to the built-in camera: ${String(error)}`,
    );
    return {
      props: { keyframes: FALLBACK_KEYFRAMES },
      durationInFrames: FALLBACK_DURATION,
    };
  }
};

/** The recording, scaled to fill the composition. */
export const RecordingLayer: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: "#000" }}>
    {/*
      <OffthreadVideo> rather than <Video>: tutorial.mp4 is HEVC, which headless
      Chrome cannot decode, so <Video> hangs until delayRender() times out.
      <OffthreadVideo> pulls exact frames through Remotion's ffmpeg compositor,
      which handles HEVC and is the recommended component for rendering anyway.
    */}
    <OffthreadVideo
      src={staticFile(VIDEO_SRC)}
      trimBefore={Math.round(VIDEO_START_SECONDS * VIDEO_FPS)}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  </AbsoluteFill>
);

/** The full shot: screen recording plus the camera rig and focus overlay. */
export const FabeoDemo: React.FC<FabeoDemoProps> = ({ keyframes }) => (
  <ZoomCamera keyframes={keyframes}>
    <RecordingLayer />
    <FocusRing />
  </ZoomCamera>
);
