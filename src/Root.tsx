import "./index.css";
import { Composition } from "remotion";
import {
  calculateFabeoMetadata,
  FABEO_DEFAULT_PROPS,
  FabeoDemo,
  VIDEO_FPS,
} from "./Composition";
import { MockupDemo, MOCKUP_DURATION } from "./DemoCanvas";

/**
 * Both compositions are 1920x1080 at 60fps.
 *
 * FabeoDemo flies the camera over a recording in public/ using the hand-timed
 * shot table in Composition.tsx. Pick the file with the `videoSrc` prop (Studio
 * props panel, or --props on the CLI); the length follows the video unless a
 * `durationInFrames` prop overrides it.
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
        defaultProps={FABEO_DEFAULT_PROPS}
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
