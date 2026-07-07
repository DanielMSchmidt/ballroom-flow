import "@fontsource/inconsolata/latin-400.css";
import "@fontsource/inconsolata/latin-700.css";
import { Composition } from "remotion";
import { Explainer } from "./Explainer";
import { FPS, HEIGHT, TOTAL_FRAMES, WIDTH } from "./timeline";

// One composition: the auto-generated product tour. The clips it plays are
// written by the @video Playwright journey into public/clips/ before render.
export function RemotionRoot(): React.JSX.Element {
  return (
    <Composition
      id="Explainer"
      component={Explainer}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  );
}
