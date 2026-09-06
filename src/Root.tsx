import "./index.css";
import { Composition } from "remotion";
import {
  calculateFabeoMetadata,
  FabeoDemo,
  FALLBACK_DURATION,
  FALLBACK_KEYFRAMES,
  VIDEO_FPS,
} from "./Composition";
import { MockupDemo, MOCKUP_DURATION } from "./DemoCanvas";

/**
 * Both compositions are 1920x1080 at 60fps.
 *
 * FabeoDemo flies the camera over the real screen recording, with the timeline
 * derived from public/events.json at load time (see calculateFabeoMetadata), so
 * durationInFrames and defaultProps here are only the pre-calculation values.
 *
 * MockupDemo does the same over the synthetic automation-builder UI, which is
 * handy for tuning easing without waiting on video decode.
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="FabeoDemo"
        component={FabeoDemo}
        calculateMetadata={calculateFabeoMetadata}
        defaultProps={{ keyframes: FALLBACK_KEYFRAMES }}
        durationInFrames={FALLBACK_DURATION}
        fps={VIDEO_FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="MockupDemo"
        component={MockupDemo}
        durationInFrames={MOCKUP_DURATION}
        fps={60}
        width={1920}
        height={1080}
      />
    </>
  );
};
