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
import type { Annotation, AnnotationKind, Role } from "@ballroom/domain";
import { useState } from "react";

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
  /** Create handler (controlled). Omitted ⇒ the panel appends to internal state. */
  onCreate?: (input: { kind: AnnotationKind; text: string }) => void;
  /** Reply handler (controlled). */
  onReply?: (annotationId: string, text: string) => void;
  /** Reply-delete handler (controlled); shown only on the viewer's own replies. */
  onDeleteReply?: (annotationId: string, replyId: string) => void;
}

type Filter = "all" | "lessons" | "practice";

const KINDS: AnnotationKind[] = ["note", "lesson", "practice"];

let localSeq = 0;
const nextLocalId = (): string => `local-${localSeq++}`;

export function AnnotationPanel({
  role,
  currentUserId,
  annotations,
  composeAnchor,
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

  const visible = list.filter((a) =>
    filter === "all" ? true : filter === "lessons" ? a.kind === "lesson" : a.kind === "practice",
  );

  return (
    <section aria-label="Annotations">
      <fieldset>
        <legend>Filter annotations</legend>
        {(["all", "lessons", "practice"] as const).map((f) => (
          <button type="button" key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </fieldset>

      <ul aria-label="comment thread">
        {visible.map((a) => (
          <li key={a.id}>
            {/* kind shown as text so colour is never the sole signal (a11y). */}
            <span data-kind={a.kind}>{a.kind}</span> <span>{a.text}</span>
            <ul aria-label="replies thread">
              {a.replies.map((r) => (
                <li key={r.id}>
                  <span>{r.text}</span>
                  {r.authorId === currentUserId && (
                    <button type="button" onClick={() => onDeleteReply?.(a.id, r.id)}>
                      delete reply
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {canAnnotate && onReply && <ReplyBox onSend={(text) => onReply(a.id, text)} />}
          </li>
        ))}
      </ul>

      {canAnnotate && (
        <form
          aria-label="Add annotation"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label>
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value as AnnotationKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <textarea
            aria-label="note"
            placeholder="Add a note…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit">add note</button>
        </form>
      )}
    </section>
  );
}

/** A single inline reply composer. */
function ReplyBox({ onSend }: { onSend: (text: string) => void }): React.JSX.Element {
  const [text, setText] = useState("");
  return (
    <form
      aria-label="Reply"
      onSubmit={(e) => {
        e.preventDefault();
        const t = text.trim();
        if (!t) return;
        onSend(t);
        setText("");
      }}
    >
      <input aria-label="reply" value={text} onChange={(e) => setText(e.target.value)} />
      <button type="submit">post reply</button>
    </form>
  );
}
