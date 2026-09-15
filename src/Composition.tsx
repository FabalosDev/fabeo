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
 * Seconds per file in public/, parsed one file at a time and cached.
 *
 * Every FabeoDemo-N composition sizes itself as soon as the Studio or CLI
 * loads, and each parseMedia() fetch holds a connection to the dev server.
 * Chrome allows six per host, so parsing every recording at once starves the
 * server and calculateMetadata() times out.
 */
const durationCache = new Map<string, Promise<number>>();
let parseQueue: Promise<unknown> = Promise.resolve();

const videoDurationInSeconds = (videoSrc: string): Promise<number> => {
  const cached = durationCache.get(videoSrc);
  if (cached) {
    return cached;
  }

  const duration = parseQueue.then(async () => {
    // Reads the container rather than decoding, so it works for HEVC too.
    const { slowDurationInSeconds } = await parseMedia({
      src: staticFile(videoSrc),
      fields: { slowDurationInSeconds: true },
      acknowledgeRemotionLicense: true,
    });
    return slowDurationInSeconds;
  });

  // Keep the queue moving past a bad file, and let a fixed file retry.
  parseQueue = duration.catch(() => durationCache.delete(videoSrc));
  durationCache.set(videoSrc, duration);
  return duration;
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
    const seconds = await videoDurationInSeconds(props.videoSrc);
    return {
      durationInFrames: Math.max(1, Math.round(seconds * VIDEO_FPS)),
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

/** public/3.mp4: running the triage scenario, then breaking it on purpose. */
export const TEST_BREAK_VIDEO_SRC = "3.mp4";

/** The test and break edit. Every slide is within its clamp limit. */
export const TEST_BREAK_SHOTS: TranslateShot[] = [
  {
    label: "Run once click, bottom left",
    from: 0,
    to: 6,
    scale: 1.25,
    translateX: 10,
    translateY: -12.5,
  },
  {
    label: "Make AI Agent run and tool executions",
    from: 7,
    to: 23,
    scale: 1.3,
    translateX: -5,
    translateY: 15,
    easing: "ease-in-out",
  },
  {
    label: "Google Sheets, successful triage row and text wrapping",
    from: 24,
    to: 51,
    scale: 1.25,
    translateX: 5,
    translateY: 12.5,
    easing: "ease-in-out",
  },
  {
    label: "Scenario overview, let's break the scenario",
    from: 52,
    to: 65,
    scale: 1.05,
    translateX: 0,
    translateY: 0,
    easing: "ease-in-out",
  },
  {
    label: "Google Sheets module modal opening",
    from: 66,
    to: 74,
    scale: 1.35,
    translateX: 5,
    translateY: 5,
    easing: "ease-in-out",
  },
  {
    label: "Timestamp (A) field, typing the broken value",
    from: 75,
    // The Sheets modal closes at about 88.5s, mid pull-back.
    to: 88,
    scale: 1.55,
    translateX: 10,
    translateY: 15,
    easing: "ease-out",
  },
  {
    label: "Pull back to the full canvas",
    from: 89,
    scale: 1,
    translateX: 0,
    translateY: 0,
    easing: "ease-in-out",
  },
];

/** public/4.mp4: fixing the broken scenario with Maia, then rerunning it. */
export const MAIA_FIX_VIDEO_SRC = "4.mp4";

/**
 * The Maia fix edit. The Sheets tab shot asks for translateY 15, past the 10
 * limit at scale 1.2, so it renders flush against the top edge.
 */
export const MAIA_FIX_SHOTS: TranslateShot[] = [
  {
    label: "Full scenario overview",
    from: 0,
    to: 7,
    scale: 1,
    translateX: 0,
    translateY: 0,
  },
  {
    label: "Google Sheets modal, setting the invalid date formula",
    from: 8,
    to: 23,
    scale: 1.5,
    translateX: 8,
    translateY: 10,
    easing: "ease-out",
  },
  {
    label: "Execution, Google Sheets warning badge",
    from: 24,
    to: 48,
    scale: 1.3,
    translateX: -15,
    translateY: -10,
    easing: "ease-in-out",
  },
  {
    label: "Build with Maia panel, typing the prompt",
    from: 49,
    to: 94,
    scale: 1.4,
    translateX: 18,
    translateY: 0,
    easing: "ease-in-out",
  },
  {
    label: "Maia sidebar and module inspection",
    from: 95,
    to: 174,
    scale: 1.15,
    translateX: 5,
    translateY: 5,
    easing: "ease-in-out",
  },
  {
    label: "Maia's diagnosis and solution",
    from: 175,
    to: 189,
    scale: 1.45,
    translateX: 20,
    translateY: 5,
    easing: "ease-out",
  },
  {
    label: "Google Sheets modal, Maia's fixed formatDate formula",
    from: 190,
    to: 206,
    scale: 1.45,
    translateX: -5,
    translateY: 0,
    easing: "ease-in-out",
  },
  {
    label: "Successful rerun, all green checkmarks",
    from: 207,
    to: 234,
    scale: 1.25,
    translateX: 0,
    translateY: 0,
    easing: "ease-in-out",
  },
  {
    label: "Google Sheets tab, newly fixed timestamp row",
    from: 235,
    to: 256,
    scale: 1.2,
    translateX: 5,
    translateY: 15,
    easing: "ease-in-out",
  },
  {
    label: "Full canvas reset and final save",
    from: 257,
    scale: 1,
    translateX: 0,
    translateY: 0,
    easing: "ease-in-out",
  },
];

/** public/5.mp4: Maia's review, the category follow-up and the clean rerun. */
export const FOLLOW_UP_VIDEO_SRC = "5.mp4";

/** The follow-up edit. Every slide is within its clamp limit. */
export const FOLLOW_UP_SHOTS: TranslateShot[] = [
  {
    label: "Full scenario overview",
    from: 0,
    to: 15,
    scale: 1,
    translateX: 0,
    translateY: 0,
  },
  {
    label: "Maia sidebar, Review button clicked",
    from: 16,
    to: 30,
    scale: 1.4,
    translateX: 18,
    translateY: 0,
    easing: "ease-in-out",
  },
  {
    label: "Maia's diagnosis of the incomplete Google Sheets fields",
    from: 31,
    to: 53,
    scale: 1.45,
    translateX: 20,
    translateY: 5,
    easing: "ease-out",
  },
  {
    label: "Scenario rerun execution",
    from: 54,
    to: 75,
    scale: 1.25,
    translateX: 0,
    translateY: 0,
    easing: "ease-in-out",
  },
  {
    label: "Google Sheets tab, category becoming timestamp",
    from: 76,
    to: 90,
    scale: 1.35,
    translateX: 0,
    translateY: 5,
    easing: "ease-in-out",
  },
  {
    label: "Medium overview, canvas and Maia panel",
    from: 91,
    to: 127,
    scale: 1.2,
    translateX: 5,
    translateY: 0,
    easing: "ease-in-out",
  },
  {
    label: "Maia input, typing but category becomes timestamp too",
    from: 128,
    to: 146,
    scale: 1.45,
    translateX: 18,
    translateY: -5,
    easing: "ease-in-out",
  },
  {
    label: "Medium overview, Maia thinking and updating the agent tool",
    from: 147,
    to: 166,
    scale: 1.2,
    translateX: 5,
    translateY: 0,
    easing: "ease-in-out",
  },
  {
    label: "Maia's Version 6 fix for Category and the action sentence",
    from: 167,
    to: 187,
    scale: 1.45,
    translateX: 20,
    translateY: 5,
    easing: "ease-out",
  },
  {
    label: "Final execution run",
    from: 188,
    to: 197,
    scale: 1.25,
    translateX: 0,
    translateY: 0,
    easing: "ease-in-out",
  },
  {
    label: "Google Sheets tab, clean columns",
    from: 198,
    to: 205,
    scale: 1.3,
    translateX: 5,
    translateY: 0,
    easing: "ease-in-out",
  },
  {
    label: "Full canvas reset",
    from: 206,
    scale: 1,
    translateX: 0,
    translateY: 0,
    easing: "ease-in-out",
  },
];

/** public/6.mp4: the outro. */
export const OUTRO_VIDEO_SRC = "6.mp4";

/**
 * The outro edit. The last shot sits exactly at the clamp limit on both axes
 * at scale 1.4, flush with the left and bottom edges.
 */
export const OUTRO_SHOTS: TranslateShot[] = [
  {
    label: "Opening, slight push-in",
    from: 0,
    to: 9,
    scale: 1.1,
    translateX: 0,
    translateY: 0,
  },
  {
    label: "Left-side push-in",
    from: 10,
    to: 17,
    scale: 1.35,
    translateX: 15,
    translateY: 5,
    easing: "ease-in-out",
  },
  {
    label: "Final punch-in",
    from: 18,
    scale: 1.4,
    translateX: 20,
    translateY: -20,
    easing: "ease-out",
  },
];

/** Recordings with their own TranslateCamera edit, by file name in public/. */
export const TRANSLATE_SHOTS = new Map<string, TranslateShot[]>([
  [INTRO_VIDEO_SRC, INTRO_SHOTS],
  [EXPLAIN_VIDEO_SRC, EXPLAIN_SHOTS],
  [TEST_BREAK_VIDEO_SRC, TEST_BREAK_SHOTS],
  [MAIA_FIX_VIDEO_SRC, MAIA_FIX_SHOTS],
  [FOLLOW_UP_VIDEO_SRC, FOLLOW_UP_SHOTS],
  [OUTRO_VIDEO_SRC, OUTRO_SHOTS],
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
