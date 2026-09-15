import React, { createContext, useContext, useId, useMemo } from "react";
import {
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

/**
 * Easing applied to the transition that *arrives* at a keyframe.
 * "spring" is the Screen Studio-style default: fast start, soft settle.
 */
export type CameraEasing =
  | "spring"
  | "linear"
  | "ease-in"
  | "ease-out"
  | "ease-in-out";

export interface KeyframeFocus {
  /** Frame at which the camera has fully arrived at this pose. */
  frame: number;
  /** Focus point X, in composition pixels (same space as <Composition width>). */
  x: number;
  /** Focus point Y, in composition pixels. */
  y: number;
  /** 1 = full canvas, 2 = 2x zoom. */
  scale: number;
  /** How to travel *into* this keyframe. Defaults to "spring". */
  easing?: CameraEasing;
}

/**
 * The resolved camera pose for the current frame. `x`/`y` are the requested
 * focus point, before any edge clamping, so overlays stay glued to the element
 * the camera is framing even when the shot is pushed back inside the canvas.
 */
export interface CameraState {
  x: number;
  y: number;
  scale: number;
}

interface ZoomCameraProps {
  keyframes: KeyframeFocus[];
  children: React.ReactNode;
  /** Max directional blur in screen pixels at high pan speed. 0 disables it. */
  maxMotionBlur?: number;
  /**
   * Keep the viewport inside the canvas so a focus point near an edge can never
   * reveal empty space beyond it. Disable only for deliberate off-canvas shots.
   */
  clampToBounds?: boolean;
}

/**
 * Overdamped on purpose: critical damping here is 2 * sqrt(stiffness * mass),
 * about 13.4, so a damping of 26 settles with no overshoot and no bounce. That
 * trades the snappy UI feel for a slow, cinematic glide the eye can follow.
 */
const SPRING_CONFIG = {
  damping: 26,
  mass: 1,
  stiffness: 45,
} as const;

export const EASING_FUNCTIONS: Record<
  Exclude<CameraEasing, "spring">,
  (t: number) => number
> = {
  linear: Easing.linear,
  "ease-in": Easing.in(Easing.cubic),
  "ease-out": Easing.out(Easing.cubic),
  "ease-in-out": Easing.inOut(Easing.cubic),
};

const CameraContext = createContext<CameraState | null>(null);

/**
 * Read the live camera pose from inside <ZoomCamera>. Useful for overlays that
 * must keep a constant on-screen size regardless of zoom.
 */
export const useCamera = (): CameraState => {
  const camera = useContext(CameraContext);
  if (!camera) {
    throw new Error("useCamera() must be called inside a <ZoomCamera>.");
  }
  return camera;
};

/**
 * Pulsing highlight ring and cursor dot pinned to whatever the camera is
 * framing. Must be rendered as a child of <ZoomCamera>.
 */
export const FocusRing: React.FC = () => {
  const { x, y, scale } = useCamera();
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Fade in as soon as the camera pushes past the wide shot.
  const opacity = interpolate(scale, [1.05, 1.4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  if (opacity <= 0) {
    return null;
  }

  const pulse = (Math.sin((frame / fps) * Math.PI * 2 * 1.1) + 1) / 2;
  // Divide by the zoom so the ring keeps a constant on-screen size.
  const size = (150 + pulse * 34) / scale;

  return (
    <div style={{ position: "absolute", left: x, top: y, opacity }}>
      <div
        style={{
          position: "absolute",
          width: size,
          height: size,
          left: -size / 2,
          top: -size / 2,
          borderRadius: "50%",
          border: `${3 / scale}px solid #a78bfa`,
          opacity: 0.35 + pulse * 0.45,
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 14 / scale,
          height: 14 / scale,
          left: -7 / scale,
          top: -7 / scale,
          borderRadius: "50%",
          backgroundColor: "#a78bfa",
        }}
      />
    </div>
  );
};

export const ZoomCamera: React.FC<ZoomCameraProps> = ({
  keyframes,
  children,
  maxMotionBlur = 5,
  clampToBounds = true,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  // Filter ids must be unique per instance; strip the colons React puts in them.
  const filterId = `camera-blur-${useId().replace(/:/g, "")}`;

  const sorted = useMemo(
    () => [...keyframes].sort((a, b) => a.frame - b.frame),
    [keyframes],
  );

  /** Resolve the camera pose at an arbitrary frame (used to sample velocity). */
  const cameraAt = (at: number): CameraState => {
    let prev = sorted[0];
    for (const keyframe of sorted) {
      if (keyframe.frame > at) {
        break;
      }
      prev = keyframe;
    }
    const next = sorted.find((keyframe) => keyframe.frame > at) ?? prev;

    // At or past the last keyframe there is nothing to travel to, and
    // interpolate() rejects an input range like [2340, 2340], so hold the pose.
    if (next.frame <= prev.frame) {
      return { x: prev.x, y: prev.y, scale: prev.scale };
    }

    // The transition lasts exactly as long as the gap between the two
    // keyframes, so timing is authored on the timeline and not in the physics.
    const durationInFrames = Math.max(1, next.frame - prev.frame);
    const easing = next.easing ?? "spring";

    const progress =
      easing === "spring"
        ? spring({
            frame: at - prev.frame,
            fps,
            durationInFrames,
            config: SPRING_CONFIG,
          })
        : interpolate(at, [prev.frame, next.frame], [0, 1], {
            easing: EASING_FUNCTIONS[easing],
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });

    return {
      x: interpolate(progress, [0, 1], [prev.x, next.x]),
      y: interpolate(progress, [0, 1], [prev.y, next.y]),
      scale: interpolate(progress, [0, 1], [prev.scale, next.scale]),
    };
  };

  if (sorted.length === 0) {
    return <>{children}</>;
  }

  const camera = cameraAt(frame);

  // transform-origin is the centre and the translation happens in outer,
  // unscaled space, so a point p lands at: centre + (p - centre) * scale + t.
  // Solving that for "focus point ends up dead centre" gives the offset below.
  //
  // Clamping keeps the viewport inside the canvas: at a given zoom the focus
  // point can sit no closer to an edge than half a viewport, or the shot would
  // run off the recording. At scale 1 that pins the camera to dead centre.
  const offsetFor = ({ x, y, scale }: CameraState) => {
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    const clamp = (value: number, min: number, max: number) =>
      min > max ? (min + max) / 2 : Math.min(Math.max(value, min), max);

    const focusX = clampToBounds
      ? clamp(x, halfWidth / scale, width - halfWidth / scale)
      : x;
    const focusY = clampToBounds
      ? clamp(y, halfHeight / scale, height - halfHeight / scale)
      : y;

    return {
      tx: (halfWidth - focusX) * scale,
      ty: (halfHeight - focusY) * scale,
    };
  };

  const { tx, ty } = offsetFor(camera);

  // Screen-space travel of the content between the previous frame and this one.
  // This captures panning *and* zooming, and drives the directional blur.
  const previous = cameraAt(frame - 1);
  const previousOffset = offsetFor(previous);
  const travelX = Math.abs(
    (width / 2) * (1 - camera.scale) +
      tx -
      ((width / 2) * (1 - previous.scale) + previousOffset.tx),
  );
  const travelY = Math.abs(
    (height / 2) * (1 - camera.scale) +
      ty -
      ((height / 2) * (1 - previous.scale) + previousOffset.ty),
  );

  const blurFor = (travel: number) =>
    interpolate(travel, [2, 45], [0, maxMotionBlur], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  // The filter is applied before the transform scales the layer, so divide by
  // the zoom to keep the blur constant in screen pixels.
  const blurX = blurFor(travelX) / camera.scale;
  const blurY = blurFor(travelY) / camera.scale;
  const isBlurring = maxMotionBlur > 0 && Math.max(blurX, blurY) > 0.05;

  return (
    <div style={{ width, height, overflow: "hidden", position: "relative" }}>
      {isBlurring ? (
        <svg width={0} height={0} style={{ position: "absolute" }}>
          <defs>
            <filter
              id={filterId}
              x="-20%"
              y="-20%"
              width="140%"
              height="140%"
              colorInterpolationFilters="sRGB"
            >
              <feGaussianBlur stdDeviation={`${blurX} ${blurY}`} />
            </filter>
          </defs>
        </svg>
      ) : null}
      <div
        style={{
          width,
          height,
          transformOrigin: "50% 50%",
          transform: `translate(${tx}px, ${ty}px) scale(${camera.scale})`,
          filter: isBlurring ? `url(#${filterId})` : undefined,
        }}
      >
        <CameraContext.Provider value={camera}>
          {children}
        </CameraContext.Provider>
      </div>
    </div>
  );
};
