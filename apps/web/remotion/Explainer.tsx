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
import {
  type CaptionMark,
  type CardSegment,
  type ExplainerProps,
  INTRO_CARD,
  INTRO_FRAMES,
  msToFrames,
  OUTRO_CARD,
  OUTRO_FRAMES,
  TOUR_CLIP,
} from "./timeline";

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

/** A full-screen intro / outro text card. */
function Card({ card }: { card: CardSegment }): React.JSX.Element {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rise = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 24 });
  const y = interpolate(rise, [0, 1], [24, 0]);

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
          maxWidth: 940,
        }}
      >
        {card.variant === "intro" && <BrandMark size={64} color={COLOR.accent} />}
        {card.kicker && <Kicker color={COLOR.accent}>{card.kicker}</Kicker>}
        <h1
          style={{
            fontFamily: BODY,
            fontWeight: 800,
            fontSize: card.variant === "intro" ? 62 : 56,
            lineHeight: 1.08,
            color: COLOR.onDark,
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

/** The recorded clip in a floating "app window" — bigger than the old tour so a
 *  first-time viewer can actually read the controls. The window shows the top
 *  ~70% of the recording (controls live up top); for the final SHARE step the
 *  share dialog is taller than that, so we pan down to reveal the role picker +
 *  "Create link" — stopping just above the localhost dev URL. */
function AppWindow({
  marks,
  tourDurationMs,
}: {
  marks: CaptionMark[];
  tourDurationMs: number;
}): React.JSX.Element {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 20 });
  const scale = interpolate(enter, [0, 1], [0.97, 1]);

  // objectPosition Y (%). 0 = top of the recording. During the last ~2s of the
  // tour — only when the closing step is SHARE — ease down to reveal the invite
  // controls that otherwise sit below the visible crop.
  const last = marks[marks.length - 1];
  const tourFrames = msToFrames(tourDurationMs);
  const panY =
    last && /share/i.test(last.kicker)
      ? interpolate(frame, [tourFrames - msToFrames(2400), tourFrames - msToFrames(500)], [0, 92], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        })
      : 0;

  return (
    <div
      style={{
        width: 1180,
        height: 576,
        marginBottom: 88,
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
        src={staticFile(`clips/${TOUR_CLIP}`)}
        // Real time — the recording already builds in generous pauses.
        playbackRate={1}
        muted
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: `50% ${panY}%`,
        }}
      />
    </div>
  );
}

/** The lower-third that shows whichever caption the playhead has reached. The
 *  frame here is RELATIVE to the tour Sequence, so mark times (ms from the
 *  recording start) map straight onto it. */
function TourCaptions({ marks }: { marks: CaptionMark[] }): React.JSX.Element | null {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nowMs = (frame / fps) * 1000;

  // The active caption is the last mark the playhead has passed.
  let mark: CaptionMark | null = null;
  for (const m of marks) {
    if (m.atMs <= nowMs) mark = m;
    else break;
  }
  if (!mark) return null;

  const startFrame = msToFrames(mark.atMs);
  // Quick fade-in each time the caption changes so steps read as distinct.
  const fade = interpolate(frame, [startFrame, startFrame + 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <>
      {/* Scrim behind the lower-third for legibility over any clip content. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 250,
          background: `linear-gradient(to top, ${COLOR.backdrop} 32%, rgba(20,24,29,0))`,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 100,
          right: 100,
          bottom: 44,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          transform: `translateY(${interpolate(fade, [0, 1], [16, 0])}px)`,
          opacity: fade,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 30, height: 3, background: COLOR.accent, display: "block" }} />
          <Kicker color={COLOR.accent}>{mark.kicker}</Kicker>
        </div>
        <p
          style={{
            fontFamily: BODY,
            fontWeight: 600,
            fontSize: 27,
            color: COLOR.onDark,
            margin: 0,
            lineHeight: 1.3,
            maxWidth: 1000,
          }}
        >
          {mark.caption}
        </p>
      </div>
    </>
  );
}

/** The recorded tour + its step-by-step captions. */
function Tour({ marks, tourDurationMs }: ExplainerProps): React.JSX.Element {
  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(160deg, ${COLOR.backdropSoft}, ${COLOR.backdrop})`,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <AppWindow marks={marks} tourDurationMs={tourDurationMs} />
      <TourCaptions marks={marks} />
    </AbsoluteFill>
  );
}

/** The full tour — intro card → one narrated real-app recording → outro card. */
export function Explainer({ tourDurationMs, marks }: ExplainerProps): React.JSX.Element {
  const tourFrames = msToFrames(tourDurationMs);
  return (
    <AbsoluteFill style={{ background: COLOR.backdrop }}>
      <Sequence from={0} durationInFrames={INTRO_FRAMES} name="intro">
        <Card card={INTRO_CARD} />
      </Sequence>
      <Sequence from={INTRO_FRAMES} durationInFrames={tourFrames} name="tour">
        <Tour marks={marks} tourDurationMs={tourDurationMs} />
      </Sequence>
      <Sequence from={INTRO_FRAMES + tourFrames} durationInFrames={OUTRO_FRAMES} name="outro">
        <Card card={OUTRO_CARD} />
      </Sequence>
    </AbsoluteFill>
  );
}
