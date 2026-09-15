import React from "react";
import { parseMedia } from "@remotion/media-parser";
import {
  AbsoluteFill,
  CalculateMetadataFunction,
  OffthreadVideo,
  staticFile,
} from "remotion";
import { TranslateCamera, TranslateShot } from "./TranslateCamera";
import { CameraEasing, KeyframeFocus, ZoomCamera } from "./ZoomCamera";

/**
 * Default recording: public/4.mp4, the Make AI Agent triage walkthrough
 * (formerly tutorial.mp4). Any other file in public/ can be swapped in through
 * the `videoSrc` prop; files there are addressed with staticFile(), not imports.
 *
 * Recordings are 16:9 and scaled to fill the 1920x1080 composition, so the
 * focus points below are composition pixels whatever the source resolution.
 */
export const DEFAULT_VIDEO_SRC = "4.mp4";

export const VIDEO_FPS = 60;

export type FabeoDemoProps = {
  /** File name inside public/, e.g. "02_break_scenario.mp4". */
  videoSrc: string;
  /**
   * Timeline length in frames. Leave unset to match the video's own length,
   * which is read from the file before the first frame renders.
   */
  durationInFrames?: number;
};

export const FABEO_DEFAULT_PROPS: FabeoDemoProps = {
  videoSrc: DEFAULT_VIDEO_SRC,
};

/**
 * Size the timeline to the chosen video, so swapping recordings never leaves
 * the preview too short or running on past the last frame.
 */
export const calculateFabeoMetadata: CalculateMetadataFunction<
  FabeoDemoProps
> = async ({ props }) => {
  if (props.durationInFrames !== undefined) {
    return {
      durationInFrames: Math.max(1, Math.round(props.durationInFrames)),
    };
  }

  try {
    // Reads the container rather than decoding, so it works for HEVC too.
    const { slowDurationInSeconds } = await parseMedia({
      src: staticFile(props.videoSrc),
      fields: { slowDurationInSeconds: true },
      acknowledgeRemotionLicense: true,
    });
    return {
      durationInFrames: Math.max(
        1,
        Math.round(slowDurationInSeconds * VIDEO_FPS),
      ),
    };
  } catch (error) {
    throw new Error(
      `[Fabeo] Could not read public/${props.videoSrc}. Check the file name, or pass durationInFrames. ${String(error)}`,
    );
  }
};

const WIDE = { x: 960, y: 540 };

interface Shot {
  /** What the camera is framing, for whoever edits this next. */
  label: string;
  /** Seconds at which the camera has fully arrived. */
  from: number;
  /**
   * Seconds the camera holds until before travelling to the next shot. Leave
   * unset on the last shot to hold until the video ends, whatever its length.
   */
  to?: number;
  x: number;
  y: number;
  scale: number;
  /** How to travel into this shot. */
  easing?: CameraEasing;
}

/**
 * The edit, one row per segment. Camera moves fill the gap between one shot's
 * `to` and the next shot's `from`, so a shorter gap is a snappier move.
 *
 * Near an edge the camera clamps to keep the frame filled, so the Run once and
 * Sheets shots settle into the bottom-left and bottom-right corners with their
 * target still in view rather than dead centre.
 */
export const SHOTS: Shot[] = [
  { label: "Full view", from: 0, to: 7, ...WIDE, scale: 1 },
  {
    label: "Google Sheets settings modal",
    from: 8,
    to: 16,
    // The modal is taller than a 135% view, so sit slightly high: keep its
    // title bar in frame and let the Cancel / Save footer crop instead.
    x: 1025,
    y: 525,
    scale: 1.35,
    easing: "spring",
  },
  {
    label: "Timestamp (A) field, parseDate formula edit",
    from: 17,
    to: 22,
    x: 1000,
    y: 425,
    scale: 1.6,
    easing: "spring",
  },
  {
    label: "Back to full canvas",
    from: 23,
    to: 28,
    ...WIDE,
    scale: 1,
    easing: "spring",
  },
  {
    label: "Run once button click",
    from: 28.5,
    to: 31,
    x: 465,
    y: 965,
    scale: 1.25,
    easing: "ease-out",
  },
  {
    label: 'Make AI Agent, "Agent is thinking..."',
    from: 32,
    to: 38.5,
    x: 1080,
    y: 290,
    scale: 1.3,
    easing: "ease-in-out",
  },
  {
    label: "Google Sheets module, Warning badge",
    from: 39,
    x: 1400,
    y: 790,
    scale: 1.45,
    easing: "ease-out",
  },
];

const shotsToKeyframes = (shots: Shot[], fps: number): KeyframeFocus[] =>
  shots.flatMap(({ from, to, x, y, scale, easing }) => [
    { frame: Math.round(from * fps), x, y, scale, easing },
    // The camera holds its last keyframe, so an open-ended shot needs no end.
    ...(to === undefined ? [] : [{ frame: Math.round(to * fps), x, y, scale }]),
  ]);

export const SHOT_KEYFRAMES = shotsToKeyframes(SHOTS, VIDEO_FPS);

/** public/1.mp4: the to-camera intro over the Make dashboard. */
export const INTRO_VIDEO_SRC = "1.mp4";

/**
 * The intro edit, in TranslateCamera terms: scale plus a slide in percent of
 * the frame. Moves fill the one-second gaps between shots.
 *
 * The dashboard is static and the speaker bubble sits near the bottom-right
 * corner, further out than these zooms can reach without showing black past
 * the edge. The camera caps each slide at the edge, (scale - 1) / 2 of the
 * frame, so the punch-ins land with the bubble in the lower-right corner.
 */
export const INTRO_SHOTS: TranslateShot[] = [
  {
    label: "Full dashboard",
    from: 0,
    to: 6,
    scale: 1,
    translateX: 0,
    translateY: 0,
  },
  {
    label: "Top-centre Make command area, pipelines breaking",
    from: 7,
    to: 17,
    scale: 1.25,
    translateX: 5,
    translateY: 15,
    easing: "ease-in-out",
  },
  {
    label: "Speaker bubble, lower right, introducing Maia",
    from: 18,
    to: 29,
    scale: 1.4,
    translateX: -25,
    translateY: -28,
    easing: "ease-out",
  },
  {
    label: "Medium-centre overview",
    from: 30,
    to: 34,
    scale: 1.15,
    translateX: 0,
    translateY: 5,
    easing: "ease-in-out",
  },
  {
    label: "Speaker face cam, sign-off (come, let's build)",
    from: 35,
    to: 39.5,
    scale: 1.35,
    translateX: -25,
    translateY: -28,
    easing: "ease-out",
  },
];

/** public/2.mp4: walkthrough of the triage scenario canvas and its tools. */
export const EXPLAIN_VIDEO_SRC = "2.mp4";

/**
 * The explainer edit. The slides are authored at the clamp limit where a shot
 * should sit flush against an edge, so nothing here is cut back.
 */
export const EXPLAIN_SHOTS: TranslateShot[] = [
  {
    label: "Full scenario",
    from: 0,
    to: 20,
    scale: 1,
    translateX: 0,
    translateY: 0,
  },
  {
    label: "Incoming Triage Webhook 1 and Make AI Agent 6",
    from: 21,
    to: 36,
    scale: 1.35,
    translateX: 10,
    translateY: 17.5,
    easing: "ease-in-out",
  },
  {
    label: "Downstream tools: Telegram Bot and Google Sheets",
    from: 37,
    to: 54,
    scale: 1.3,
    translateX: -15,
    translateY: -15,
    easing: "ease-in-out",
  },
  {
    label: "Make AI Agent, centre focus",
    from: 55,
    to: 82,
    scale: 1.4,
    translateX: -2,
    translateY: 16,
    easing: "ease-in-out",
  },
  {
    label: "Google Sheets tab headers",
    from: 83,
    to: 91,
    scale: 1.2,
    translateX: 5,
    translateY: 10,
    easing: "ease-in-out",
  },
  {
    label: "Full scenario reset",
    from: 92,
    to: 99.5,
    scale: 1,
    translateX: 0,
    translateY: 0,
    easing: "ease-in-out",
  },
];

/** Recordings with their own TranslateCamera edit, by file name in public/. */
export const TRANSLATE_SHOTS = new Map<string, TranslateShot[]>([
  [INTRO_VIDEO_SRC, INTRO_SHOTS],
  [EXPLAIN_VIDEO_SRC, EXPLAIN_SHOTS],
]);

/** The recording, scaled to fill the composition. */
export const RecordingLayer: React.FC<{ videoSrc: string }> = ({
  videoSrc,
}) => (
  <AbsoluteFill style={{ backgroundColor: "#000" }}>
    {/*
      <OffthreadVideo> rather than <Video>: it pulls exact frames through
      Remotion's ffmpeg compositor, which also copes with HEVC recordings that
      headless Chrome cannot decode, and is the recommended component for
      rendering anyway.
    */}
    <OffthreadVideo
      src={staticFile(videoSrc)}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  </AbsoluteFill>
);

/**
 * The full shot: screen recording under the hand-timed camera. Recordings in
 * TRANSLATE_SHOTS get their own edit, clamped so no black bars ever show; every
 * other recording uses the triage shots. No FocusRing here, since it would sit
 * on top of the text each punch-in is there to show.
 */
export const FabeoDemo: React.FC<FabeoDemoProps> = ({ videoSrc }) => {
  const translateShots = TRANSLATE_SHOTS.get(videoSrc);

  return translateShots ? (
    <TranslateCamera shots={translateShots} clampToBounds>
      <RecordingLayer videoSrc={videoSrc} />
    </TranslateCamera>
  ) : (
    <ZoomCamera keyframes={SHOT_KEYFRAMES}>
      <RecordingLayer videoSrc={videoSrc} />
    </ZoomCamera>
  );
};
