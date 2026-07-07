import "@fontsource/inconsolata/latin-400.css";
import "@fontsource/inconsolata/latin-700.css";
import { Composition } from "remotion";
import { Explainer } from "./Explainer";
import {
  type ExplainerProps,
  FPS,
  HEIGHT,
  INTRO_FRAMES,
  msToFrames,
  OUTRO_FRAMES,
  WIDTH,
} from "./timeline";

// One composition: the auto-generated product tour. The single clip it plays
// and the caption marks are written by the @video Playwright journey into
// public/ before render; scripts/render-explainer.mjs reads the marks file and
// feeds { tourDurationMs, marks } as inputProps, so the composition length
// tracks the real recording (intro card + recorded tour + outro card).
export function RemotionRoot(): React.JSX.Element {
  return (
    <Composition
      id="Explainer"
      component={Explainer}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      // Placeholder so the Studio/preview and a props-less render still open;
      // the real values arrive via inputProps at render time.
      durationInFrames={INTRO_FRAMES + msToFrames(30_000) + OUTRO_FRAMES}
      defaultProps={{ tourDurationMs: 30_000, marks: [] } satisfies ExplainerProps}
      calculateMetadata={({ props }) => ({
        durationInFrames: INTRO_FRAMES + msToFrames(props.tourDurationMs) + OUTRO_FRAMES,
      })}
    />
  );
}
