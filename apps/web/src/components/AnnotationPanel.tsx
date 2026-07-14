// US-039 / US-042 — the annotation panel: a kinded note/lesson/practice thread
// for a selected anchor (a point or a figure), with replies and kind/figure
// filters. PLAN §4.6.
//
// Presentational: data + handlers as props (the §3 seam). The screen (Task 8)
// feeds it `annotations` + `onCreate/onReply/onDeleteReply` wired to the store;
// uncontrolled local state is a fallback so the panel is usable standalone.
//
// Capability gating mirrors the shared table (principle #26): only a commenter+
// sees the compose box. The worker still enforces it — a viewer's write is
// refused at the DO (US-039 effect-based gate).
//
// Styling: uses the `../ui` primitives (Button, Chip) so the panel matches the
// rest of the app — 44px touch targets (#3), focus rings (#7), the shared
// type/colour scale — and keeps the accessible names/roles the tests rely on.
import type { Annotation, AnnotationKind, Role } from "@weavesteps/domain";
import { useState } from "react";
import { getLocale, pickMessages, useMessages } from "../i18n";
import { journalMessages } from "../i18n/messages/journal";
import { onSelectValue } from "../lib/select-value";
import { Button, Chip } from "../ui";

/** A point or figure anchor the panel is composing against (Task 8 supplies it). */
export type ComposeAnchor =
  | { type: "point"; figureRef: string; count: number; role?: Role }
  | { type: "figure"; figureRef: string };

export interface AnnotationPanelProps {
  /** The viewer's per-document role; only commenter+ may compose (US-039 AC-4). */
  role: "viewer" | "commenter" | "editor";
  /** The viewer's user id — reply delete is offered only on their own replies. */
  currentUserId?: string;
  /** Controlled annotation set (Task 8). Omit to use internal state (standalone). */
  annotations?: Annotation[];
  /** The anchor a newly-composed annotation attaches to (Task 8). */
  composeAnchor?: ComposeAnchor;
  /**
   * Human-readable labels for figure refs (US-042 by-figure filter). The panel
   * derives the figure set from the annotations' anchors; this maps each ref to
   * a name. A ref with no entry falls back to the ref itself.
   */
  figureLabels?: Record<string, string>;
  /** Create handler (controlled). Omitted ⇒ the panel appends to internal state. */
  onCreate?: (input: { kind: AnnotationKind; text: string }) => void;
  /** Reply handler (controlled). */
  onReply?: (annotationId: string, text: string) => void;
  /** Reply-delete handler (controlled); shown only on the viewer's own replies. */
  onDeleteReply?: (annotationId: string, replyId: string) => void;
  // ── T8 Thread parity (frame 1.14) ────────────────────────────────────────
  /** Thread header title — e.g. "Spin Turn · step 2". When set, the panel
   *  renders in THREAD MODE: a titled header + flat comment list + single reply
   *  composer, instead of the filter bar + kind-select compose form. */
  threadTitle?: string;
  /** Optional thread sub-header — e.g. "whole figure" for a figure-level thread
   *  (US-004a). Rendered under the title in thread mode. */
  threadSubtitle?: string;
  /** Author display names: authorId → display name ("Daniel"). Falls back to
   *  authorId when missing. Used in T8 thread mode. */
  authorNameMap?: Record<string, string>;
  /** Author identity colors: authorId → hex color ("#3b7dd8"). Falls back to
   *  a stable hash slot when missing. Used in T8 thread mode. */
  authorColorMap?: Record<string, string>;
  /** Current viewer's identity color (for the reply composer avatar). */
  currentUserColor?: string;
  /** Current viewer's display name (for avatar initial in reply composer). */
  currentUserName?: string;
}

/** A kind filter, or a `figure:<ref>` by-figure filter (US-042). */
type Filter = "all" | "lessons" | "practice" | `figure:${string}`;

const KINDS: AnnotationKind[] = ["note", "lesson", "practice"];

let localSeq = 0;
const nextLocalId = (): string => `local-${localSeq++}`;

/** The distinct figure refs an annotation set anchors to (US-042 by-figure). */
function figureRefsOf(list: Annotation[]): string[] {
  const seen = new Set<string>();
  for (const a of list) {
    for (const an of a.anchors) {
      if (an.type === "point" || an.type === "figure") seen.add(an.figureRef);
    }
  }
  return [...seen];
}

/** Does an annotation anchor to `figureRef`? (point or figure anchor.) */
function anchorsToFigure(a: Annotation, figureRef: string): boolean {
  return a.anchors.some(
    (an) => (an.type === "point" || an.type === "figure") && an.figureRef === figureRef,
  );
}

export function AnnotationPanel({
  role,
  currentUserId,
  annotations,
  composeAnchor,
  figureLabels,
  onCreate,
  onReply,
  onDeleteReply,
  threadTitle,
  threadSubtitle,
  authorNameMap,
  authorColorMap,
  currentUserColor,
  currentUserName,
}: AnnotationPanelProps): React.JSX.Element {
  const t = useMessages(journalMessages);
  const canAnnotate = role === "commenter" || role === "editor";
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState<AnnotationKind>("note");
  const [filter, setFilter] = useState<Filter>("all");
  const [local, setLocal] = useState<Annotation[]>([]);

  // Controlled when `annotations` is provided; otherwise the panel owns the list.
  const list = annotations ?? local;
  const figureRefs = figureRefsOf(list);

  const submit = (): void => {
    const text = draft.trim();
    if (!text) return;
    // Thread mode always uses "note" kind; the filter-bar mode uses the select.
    const submitKind: AnnotationKind = threadTitle ? "note" : kind;
    if (onCreate) {
      onCreate({ kind: submitKind, text });
    } else {
      const anchor: ComposeAnchor = composeAnchor ?? { type: "figure", figureRef: "" };
      setLocal((prev) => [
        ...prev,
        {
          id: nextLocalId(),
          authorId: currentUserId ?? "me",
          kind: submitKind,
          text,
          tags: [],
          anchors: [anchor],
          replies: [],
          createdAt: 0,
          deletedAt: null,
        },
      ]);
    }
    setDraft("");
  };

  const visible = list.filter((a) => {
    if (filter === "all") return true;
    if (filter === "lessons") return a.kind === "lesson";
    if (filter === "practice") return a.kind === "practice";
    // `figure:<ref>` — only annotations anchored to that figure (US-042 by-figure).
    return anchorsToFigure(a, filter.slice("figure:".length));
  });

  const labelFor = (ref: string): string => figureLabels?.[ref] ?? ref;

  // ── Thread mode (frame 1.14): titled header + flat comment list + footer reply ──
  if (threadTitle) {
    return (
      <section aria-label={t.thread} className="flex flex-col gap-3">
        {/* Thread header: title ("Spin Turn · step 2") + comment count. */}
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-bold text-ink">{threadTitle}</h2>
          {threadSubtitle && (
            <p className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">
              {threadSubtitle}
            </p>
          )}
          <p className="text-2xs text-ink-muted">{t.commentCount(visible.length)}</p>
        </div>

        <ul aria-label={t.commentThread} className="flex flex-col gap-4">
          {visible.map((a) => (
            <li key={a.id}>
              <ThreadComment
                annotation={a}
                currentUserId={currentUserId}
                authorColorMap={authorColorMap}
                authorNameMap={authorNameMap}
                canReply={canAnnotate && Boolean(onReply)}
                onReply={onReply ? (text) => onReply(a.id, text) : undefined}
                onDeleteReply={
                  onDeleteReply ? (replyId) => onDeleteReply(a.id, replyId) : undefined
                }
              />
            </li>
          ))}
        </ul>

        {/* Footer reply composer (frame 1.14 ③): avatar + "add a reply…" + send.
            Tints the avatar + border with the current user's identity colour.
            Commenter+ only (viewers are read-only). */}
        {canAnnotate && (
          <form
            aria-label={t.addReply}
            className="flex items-center gap-2 border-t border-line pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <AuthorAvatar name={currentUserName} color={currentUserColor} size="md" />
            <input
              aria-label={t.addReplyField}
              placeholder={t.addReplyPlaceholder}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="flex-1 rounded-full border border-border-strong bg-surface-sunken px-4 text-sm text-ink placeholder:text-ink-faint min-h-[var(--bf-touch-target)] outline-none"
              style={
                currentUserColor ? { borderColor: currentUserColor, boxShadow: "none" } : undefined
              }
            />
            <Button type="submit" variant="secondary" size="sm" disabled={!draft.trim()}>
              {t.send}
            </Button>
          </form>
        )}
      </section>
    );
  }

  // ── Standard mode: filter bar + annotation list + kind-select compose form ──
  return (
    <section aria-label={t.annotations} className="flex flex-col gap-3">
      {/* Filter chips share the app's "pick one" pattern (#5/#7): a real button
          per filter, aria-pressed on the active one, 44px hit area via Chip. */}
      <fieldset className="flex flex-wrap items-center gap-1">
        <legend className="bf-sr-only">{t.filterAnnotations}</legend>
        {(["all", "lessons", "practice"] as const).map((f) => (
          <Chip key={f} selected={filter === f} onClick={() => setFilter(f)}>
            {t.annotationFilter(f)}
          </Chip>
        ))}
        {/* By-figure filters (US-042): one chip per anchored figure. */}
        {figureRefs.map((ref) => {
          const value: Filter = `figure:${ref}`;
          return (
            <Chip key={ref} selected={filter === value} onClick={() => setFilter(value)}>
              {labelFor(ref)}
            </Chip>
          );
        })}
      </fieldset>

      <ul aria-label={t.commentThread} className="flex flex-col gap-2">
        {visible.map((a) => (
          <li key={a.id}>
            <AnnotationRow
              annotation={a}
              currentUserId={currentUserId}
              canReply={canAnnotate && Boolean(onReply)}
              onReply={onReply ? (text) => onReply(a.id, text) : undefined}
              onDeleteReply={onDeleteReply ? (replyId) => onDeleteReply(a.id, replyId) : undefined}
            />
          </li>
        ))}
      </ul>

      {canAnnotate && (
        <form
          aria-label={t.addAnnotation}
          className="flex flex-col gap-2 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {/* Kind chosen via a labelled select; the chosen kind also renders as
              text on each annotation so colour is never the only cue (#5).
              Native control stays keyboard/AT-friendly with a 44px target (#3/#7). */}
          <select
            aria-label={t.kindSelect}
            value={kind}
            onChange={onSelectValue(KINDS, setKind)}
            className="w-full appearance-none rounded-md border border-border-strong bg-surface-sunken px-3.5 text-sm text-ink min-h-[var(--bf-touch-target)] outline-none"
          >
            {KINDS.map((k) => (
              // Option VALUES are the stored kinds; only the visible label localizes.
              <option key={k} value={k}>
                {t.kindLabel(k)}
              </option>
            ))}
          </select>
          <textarea
            aria-label={t.noteField}
            placeholder={t.notePlaceholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-border-strong bg-surface-sunken px-3.5 py-2 text-sm text-ink placeholder:text-ink-faint outline-none"
          />
          <Button type="submit" variant="primary" size="sm" disabled={!draft.trim()}>
            {t.addNote}
          </Button>
        </form>
      )}
    </section>
  );
}

// ── T8 helpers: Thread mode components ───────────────────────────────────────

/** Relative time from a unix-ms timestamp (e.g. "2h", "3d ago", "3 May"). */
function relativeTime(createdAt: number): string {
  const t = pickMessages(journalMessages);
  const now = Date.now();
  const diffMs = now - createdAt;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return t.justNow;
  if (diffMin < 60) return t.minutesAgo(diffMin);
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return t.hoursAgo(diffHr);
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay === 1) return t.yesterday;
  if (diffDay < 7) return t.daysAgo(diffDay);
  // Older: format as "3 May"
  return new Date(createdAt).toLocaleDateString(getLocale() === "de" ? "de-DE" : "en-GB", {
    day: "numeric",
    month: "short",
  });
}

/** Round identity avatar: initial of the author name on their identity colour.
 *  Decorative — the name is rendered alongside, so aria-hidden is correct. */
function AuthorAvatar({
  name,
  color,
  size = "md",
}: {
  name?: string;
  color?: string;
  size?: "sm" | "md";
}) {
  const initial = (name?.trim()[0] ?? "?").toUpperCase();
  const sizeCls = size === "sm" ? "h-[20px] w-[20px] text-[10px]" : "h-[32px] w-[32px] text-sm";
  return (
    <span
      aria-hidden="true"
      className={`flex flex-none items-center justify-center rounded-full font-bold text-white ${sizeCls}`}
      style={{ backgroundColor: color ?? "var(--bf-identity-1)" }}
    >
      {initial}
    </span>
  );
}

/** One thread comment (T8 frame 1.14): large avatar + author name in identity
 *  colour + relative time + Caveat text.  Reply thread indented below. */
function ThreadComment({
  annotation: a,
  currentUserId,
  authorColorMap,
  authorNameMap,
  canReply,
  onReply,
  onDeleteReply,
}: {
  annotation: Annotation;
  currentUserId?: string;
  authorColorMap?: Record<string, string>;
  authorNameMap?: Record<string, string>;
  canReply: boolean;
  onReply?: (text: string) => void;
  onDeleteReply?: (replyId: string) => void;
}): React.JSX.Element {
  const t = useMessages(journalMessages);
  const authorName = authorNameMap?.[a.authorId] ?? a.authorId;
  const authorColor = authorColorMap?.[a.authorId];
  const time = relativeTime(a.createdAt);
  return (
    <div className="flex gap-3">
      <AuthorAvatar name={authorName} color={authorColor} size="md" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Author name (in identity colour) · relative time */}
        <p className="flex items-baseline gap-1.5 text-sm">
          <span className="font-semibold" style={{ color: authorColor ?? "var(--bf-ink)" }}>
            {authorName}
          </span>
          <span className="text-2xs text-ink-muted">· {time}</span>
        </p>
        {/* Comment text — Caveat (hand-written) font per brief */}
        <p className="text-[15px] text-ink" style={{ fontFamily: "var(--bf-font-note)" }}>
          {a.text}
        </p>
        {/* Threaded replies (indented) */}
        {a.replies.length > 0 && (
          <ul aria-label={t.repliesThread} className="mt-1 flex flex-col gap-1 pl-2">
            {a.replies.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-2xs text-ink-secondary">
                <span>{r.text}</span>
                {r.authorId === currentUserId && onDeleteReply && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onDeleteReply(r.id)}
                  >
                    {t.deleteReply}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canReply && onReply && <ReplyBox onSend={onReply} />}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

/** One annotation: its kind (as text, not colour-only), body, and reply thread. */
function AnnotationRow({
  annotation: a,
  currentUserId,
  canReply,
  onReply,
  onDeleteReply,
}: {
  annotation: Annotation;
  currentUserId?: string;
  canReply: boolean;
  onReply?: (text: string) => void;
  onDeleteReply?: (replyId: string) => void;
}): React.JSX.Element {
  const t = useMessages(journalMessages);
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-line p-2">
      <p className="flex items-center gap-1.5 text-sm">
        {/* kind shown as text so colour is never the sole signal (a11y #5). */}
        <Chip tone="neutral" asStatic data-kind={a.kind}>
          {t.kindLabel(a.kind)}
        </Chip>
        <span className="text-ink">{a.text}</span>
      </p>
      <ul aria-label={t.repliesThread} className="flex flex-col gap-1 pl-3">
        {a.replies.map((r) => (
          <li key={r.id} className="flex items-center gap-2 text-2xs text-ink-secondary">
            <span>{r.text}</span>
            {r.authorId === currentUserId && onDeleteReply && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onDeleteReply(r.id)}>
                {t.deleteReply}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canReply && onReply && <ReplyBox onSend={onReply} />}
    </div>
  );
}

/** A single inline reply composer. */
function ReplyBox({ onSend }: { onSend: (text: string) => void }): React.JSX.Element {
  const t = useMessages(journalMessages);
  const [text, setText] = useState("");
  return (
    <form
      aria-label={t.replyForm}
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const t = text.trim();
        if (!t) return;
        onSend(t);
        setText("");
      }}
    >
      <input
        aria-label={t.replyField}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t.replyPlaceholder}
        className="flex-1 rounded-md border border-border-strong bg-surface-sunken px-3 text-sm text-ink placeholder:text-ink-faint min-h-[var(--bf-touch-target)] outline-none"
      />
      <Button type="submit" variant="secondary" size="sm" disabled={!text.trim()}>
        {t.postReply}
      </Button>
    </form>
  );
}
