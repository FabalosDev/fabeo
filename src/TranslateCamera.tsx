import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { CameraEasing, EASING_FUNCTIONS } from "./ZoomCamera";

/**
 * A shot authored the way an editor thinks about it: a zoom plus a slide of
 * the picture, rather than ZoomCamera's focus point.
 */
export interface TranslateShot {
  /** What the camera is framing, for whoever edits this next. */
  label: string;
  /** Seconds at which the camera has fully arrived. */
  from: number;
  /**
   * Seconds the camera holds until before travelling to the next shot. Leave
   * unset on the last shot to hold until the video ends.
   */
  to?: number;
  /** 1 = full frame. */
  scale: number;
  /**
   * Slide of the zoomed picture, in percent of the frame width. It is applied
   * after the zoom, so -25 moves the picture a quarter of the frame left
   * (bringing its right side toward centre) whatever the scale.
   */
  translateX: number;
  /** As translateX, in percent of the frame height. Negative moves it up. */
  translateY: number;
  /** How to travel into this shot. Defaults to "ease-in-out". */
  easing?: Exclude<CameraEasing, "spring">;
}

interface TranslatePose {
  scale: number;
  translateX: number;
  translateY: number;
}

const poseOf = ({
  scale,
  translateX,
  translateY,
}: TranslateShot): TranslatePose => ({ scale, translateX, translateY });

/**
 * Resolve the pose at a frame. Each move runs from the previous shot's `to` to
 * the next shot's `from` through interpolate(), eased by the arriving shot.
 */
export const translatePoseAt = (
  shots: TranslateShot[],
  frame: number,
  fps: number,
): TranslatePose => {
  const nextIndex = shots.findIndex((shot) => shot.from * fps > frame);
  if (nextIndex === -1) {
    return poseOf(shots[shots.length - 1]);
  }
  if (nextIndex === 0) {
    return poseOf(shots[0]);
  }

  const prev = shots[nextIndex - 1];
  const next = shots[nextIndex];
  const start = (prev.to ?? prev.from) * fps;
  const end = next.from * fps;
  if (frame <= start) {
    return poseOf(prev);
  }

  const tween = (from: number, to: number) =>
    interpolate(frame, [start, end], [from, to], {
      easing: EASING_FUNCTIONS[next.easing ?? "ease-in-out"],
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  return {
    scale: tween(prev.scale, next.scale),
    translateX: tween(prev.translateX, next.translateX),
    translateY: tween(prev.translateY, next.translateY),
  };
};

interface TranslateCameraProps {
  shots: TranslateShot[];
  children: React.ReactNode;
  /**
   * Cap the slide so the zoomed picture always covers the frame. At scale s
   * the picture overhangs each edge by (s - 1) / 2 of the frame, which is the
   * furthest it can move before empty space shows. Disable only for deliberate
   * off-canvas shots.
   */
  clampToBounds?: boolean;
}

export const TranslateCamera: React.FC<TranslateCameraProps> = ({
  shots,
  children,
  clampToBounds = true,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (shots.length === 0) {
    return <>{children}</>;
  }

  const { scale, translateX, translateY } = translatePoseAt(shots, frame, fps);
  const limit = Math.max(0, ((scale - 1) / 2) * 100);
  const clamp = (value: number) =>
    clampToBounds ? Math.min(Math.max(value, -limit), limit) : value;

  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "#000" }}>
      <AbsoluteFill
        style={{
          // translate() comes first so it applies after the zoom, in frame
          // space; percentages are of the unscaled 1920x1080 layer.
          transform: `translate(${clamp(translateX)}%, ${clamp(translateY)}%) scale(${scale})`,
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
