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
import type { Annotation, AnnotationKind, Role } from "@ballroom/domain";
import { useState } from "react";
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
}: AnnotationPanelProps): React.JSX.Element {
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
    if (onCreate) {
      onCreate({ kind, text });
    } else {
      const anchor: ComposeAnchor = composeAnchor ?? { type: "figure", figureRef: "" };
      setLocal((prev) => [
        ...prev,
        {
          id: nextLocalId(),
          authorId: currentUserId ?? "me",
          kind,
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

  return (
    <section aria-label="Annotations" className="flex flex-col gap-3">
      {/* Filter chips share the app's "pick one" pattern (#5/#7): a real button
          per filter, aria-pressed on the active one, 44px hit area via Chip. */}
      <fieldset className="flex flex-wrap items-center gap-1">
        <legend className="bf-sr-only">Filter annotations</legend>
        {(["all", "lessons", "practice"] as const).map((f) => (
          <Chip key={f} selected={filter === f} onClick={() => setFilter(f)}>
            {f}
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

      <ul aria-label="comment thread" className="flex flex-col gap-2">
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
          aria-label="Add annotation"
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
            aria-label="Kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as AnnotationKind)}
            className="w-full appearance-none rounded-md border border-border-strong bg-surface-sunken px-3.5 text-sm text-ink min-h-[var(--bf-touch-target)] outline-none"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <textarea
            aria-label="note"
            placeholder="Add a note…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-border-strong bg-surface-sunken px-3.5 py-2 text-sm text-ink placeholder:text-ink-faint outline-none"
          />
          <Button type="submit" variant="primary" size="sm" disabled={!draft.trim()}>
            add note
          </Button>
        </form>
      )}
    </section>
  );
}

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
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-line p-2">
      <p className="flex items-center gap-1.5 text-sm">
        {/* kind shown as text so colour is never the sole signal (a11y #5). */}
        <Chip tone="neutral" asStatic data-kind={a.kind}>
          {a.kind}
        </Chip>
        <span className="text-ink">{a.text}</span>
      </p>
      <ul aria-label="replies thread" className="flex flex-col gap-1 pl-3">
        {a.replies.map((r) => (
          <li key={r.id} className="flex items-center gap-2 text-2xs text-ink-secondary">
            <span>{r.text}</span>
            {r.authorId === currentUserId && onDeleteReply && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onDeleteReply(r.id)}>
                delete reply
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
  const [text, setText] = useState("");
  return (
    <form
      aria-label="Reply"
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
        aria-label="reply"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Reply…"
        className="flex-1 rounded-md border border-border-strong bg-surface-sunken px-3 text-sm text-ink placeholder:text-ink-faint min-h-[var(--bf-touch-target)] outline-none"
      />
      <Button type="submit" variant="secondary" size="sm" disabled={!text.trim()}>
        post reply
      </Button>
    </form>
  );
}
