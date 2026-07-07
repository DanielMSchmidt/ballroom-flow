import {
  AbsoluteFill,
  interpolate,
  OffthreadVideo,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { type CardSegment, type SceneSegment, type Segment, sec, TIMELINE } from "./timeline";

// Palette mirrors the app's design tokens (styles/tokens.css): studio blue
// accent on a charcoal "studio-paper" backdrop, paper-white app frame.
const COLOR = {
  ink: "#1c1c1e",
  paper: "#ffffff",
  backdrop: "#14181d",
  backdropSoft: "#1c232b",
  accent: "#4f86c6",
  accentDeep: "#2f5d8f",
  accentTint: "#eef4fb",
  onDark: "#f7f5f0",
  onDarkMuted: "#a9b4c0",
} as const;

const SANS = "Inconsolata, ui-monospace, SFMono-Regular, Menlo, monospace";
const BODY = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** Small mono eyebrow used on cards and lower-thirds. */
function Kicker({ children, color }: { children: string; color: string }): React.JSX.Element {
  return (
    <span
      style={{
        fontFamily: SANS,
        fontWeight: 700,
        fontSize: 22,
        letterSpacing: 6,
        color,
      }}
    >
      {children}
    </span>
  );
}

/** The woven "W" brand glyph, drawn so we ship no external asset dependency. */
function BrandMark({ size, color }: { size: number; color: string }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <title>Weave Steps</title>
      <path
        d="M3 4l3.2 16L12 7l5.8 13L21 4"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Card({ card }: { card: CardSegment }): React.JSX.Element {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 24 });
  const y = interpolate(rise, [0, 1], [24, 0]);
  const titleColor = card.variant === "intro" ? COLOR.onDark : COLOR.onDark;

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at 30% 20%, ${COLOR.backdropSoft}, ${COLOR.backdrop})`,
        justifyContent: "center",
        alignItems: "center",
        padding: 120,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 22,
          alignItems: "center",
          textAlign: "center",
          transform: `translateY(${y}px)`,
          opacity: rise,
          maxWidth: 900,
        }}
      >
        {card.variant === "intro" && <BrandMark size={64} color={COLOR.accent} />}
        {card.kicker && <Kicker color={COLOR.accent}>{card.kicker}</Kicker>}
        <h1
          style={{
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: card.variant === "intro" ? 64 : 54,
            lineHeight: 1.08,
            color: titleColor,
            margin: 0,
            letterSpacing: -1,
          }}
        >
          {card.title}
        </h1>
        {card.subtitle && (
          <p
            style={{
              fontFamily: BODY,
              fontSize: 26,
              color: COLOR.onDarkMuted,
              margin: 0,
              lineHeight: 1.4,
            }}
          >
            {card.subtitle}
          </p>
        )}
        {card.variant === "outro" && (
          <div
            style={{
              marginTop: 14,
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: COLOR.accent,
              color: COLOR.paper,
              fontFamily: BODY,
              fontWeight: 700,
              fontSize: 26,
              padding: "16px 34px",
              borderRadius: 14,
            }}
          >
            <BrandMark size={28} color={COLOR.paper} />
            Weave Steps
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
}

/** A recorded real-app snippet in a floating "app window", with a lower-third. */
function Scene({ scene }: { scene: SceneSegment }): React.JSX.Element {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 20 });
  const scale = interpolate(enter, [0, 1], [0.96, 1]);
  // Lower-third slides in shortly after the clip, out just before it ends.
  const capIn = spring({ frame: frame - 12, fps, config: { damping: 200 }, durationInFrames: 18 });
  const capOut = interpolate(frame, [durationInFrames - 16, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const capOpacity = Math.min(capIn, capOut);

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, ${COLOR.backdropSoft}, ${COLOR.backdrop})`,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: 1040,
          height: 508,
          marginBottom: 96,
          transform: `scale(${scale})`,
          opacity: enter,
          borderRadius: 18,
          overflow: "hidden",
          boxShadow: "0 40px 90px rgba(0,0,0,0.5)",
          border: "1px solid rgba(255,255,255,0.08)",
          background: COLOR.paper,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Faux window chrome */}
        <div
          style={{
            height: 34,
            background: "#f2efe8",
            display: "flex",
            alignItems: "center",
            gap: 8,
            paddingLeft: 16,
            flexShrink: 0,
            borderBottom: "1px solid #e3ded3",
          }}
        >
          {["#e06c5b", "#e3b341", "#5aa469"].map((c) => (
            <span
              key={c}
              style={{ width: 12, height: 12, borderRadius: 6, background: c, display: "block" }}
            />
          ))}
        </div>
        <OffthreadVideo
          src={staticFile(`clips/${scene.clip}`)}
          playbackRate={scene.playbackRate}
          muted
          style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
        />
      </div>

      {/* Scrim behind the lower-third for legibility over any clip. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 180,
          background: `linear-gradient(to top, ${COLOR.backdrop}, rgba(20,24,29,0))`,
        }}
      />

      {/* Lower-third caption */}
      <div
        style={{
          position: "absolute",
          left: 100,
          right: 100,
          bottom: 44,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          transform: `translateY(${interpolate(capOpacity, [0, 1], [16, 0])}px)`,
          opacity: capOpacity,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 30, height: 3, background: COLOR.accent, display: "block" }} />
          <Kicker color={COLOR.accent}>{scene.kicker}</Kicker>
        </div>
        <p
          style={{
            fontFamily: BODY,
            fontWeight: 700,
            fontSize: 30,
            color: COLOR.onDark,
            margin: 0,
            lineHeight: 1.2,
          }}
        >
          {scene.caption}
        </p>
      </div>
    </AbsoluteFill>
  );
}

function segment(s: Segment): React.JSX.Element {
  return s.type === "card" ? <Card card={s} /> : <Scene scene={s} />;
}

/** The full tour — cards + real-app snippets, sequenced back-to-back. */
export function Explainer(): React.JSX.Element {
  let from = 0;
  return (
    <AbsoluteFill style={{ background: COLOR.backdrop }}>
      {TIMELINE.map((s) => {
        const durationInFrames = sec(s.seconds);
        const el = (
          <Sequence key={s.id} from={from} durationInFrames={durationInFrames} name={s.id}>
            {segment(s)}
          </Sequence>
        );
        from += durationInFrames;
        return el;
      })}
    </AbsoluteFill>
  );
}
