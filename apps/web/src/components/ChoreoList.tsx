// US-022/US-025 — the Choreo list: your routines + create, with the quota upsell.
//
// Presentational (the §3 seam): it takes the routine list + handlers as props and
// renders + collects input; the screen wrapper wires the store (list query +
// create mutation) and navigation. The free plan owns at most FREE_ROUTINE_CAP
// routines (D21) — the server is authoritative (POST → 402 upsell) and this
// screen mirrors the cap so a capped user sees the upsell without a round-trip.
// Sample/template empty state + fork are US-045/US-037.
// Header search is US-046.

import type { RoutineListItem, SearchResult } from "@ballroom/contract";
import { DANCE_IDS, DANCES, type DanceId } from "@ballroom/domain";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Input, Select, Sheet } from "../ui";

/** Humanize a dance id for display ("viennese_waltz" → "Viennese Waltz"). */
function danceLabel(dance: DanceId): string {
  return dance
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const DANCE_OPTIONS = DANCE_IDS.map((id) => ({ value: id, label: danceLabel(id) }));

export interface ChoreoListProps {
  /** The viewer's routines (owned + shared-in). */
  routines?: RoutineListItem[];
  /** How many routines the viewer OWNS (drives the quota gate). */
  ownedCount: number;
  /** The viewer's plan; only "free" is capped. */
  plan: "free" | "pro";
  /** The free-plan owned-routine cap, sourced from the server (/api/me) — the ONE
   *  source of truth, never a hardcoded copy (#176). Undefined until /api/me loads. */
  cap?: number;
  /** The server refused a create with the quota 402 — open the upsell (race backstop). */
  quotaBlocked?: boolean;
  /** Create a routine (the allowed path); the screen wires this to the store. */
  onCreate?: (input: { title: string; dance: DanceId }) => void;
  /** Open a routine (navigate to its Assemble screen). */
  onOpen?: (docRef: string) => void;
  /** A create is in flight. */
  creating?: boolean;
  /** US-045: the read-only sample routine to display in the empty state. */
  sample?: RoutineListItem;
  /** US-045: app-owned template routines — the "Start from template" button forks one. */
  templates?: RoutineListItem[];
  /** US-045: fork a template into a new owned routine. */
  onStartFromTemplate?: (docRef: string) => void;
  /** US-046: called on each keystroke in the header search box. */
  onSearch?: (q: string) => void;
  /** US-046: search results to display above the routine cards. */
  searchResults?: SearchResult[];
}

export function ChoreoList({
  routines = [],
  ownedCount,
  plan,
  cap,
  quotaBlocked,
  onCreate,
  onOpen,
  creating,
  sample,
  templates = [],
  onStartFromTemplate,
  onSearch,
  searchResults = [],
}: ChoreoListProps) {
  const [upsellOpen, setUpsellOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [dance, setDance] = useState<DanceId>("waltz");
  const atCap = plan === "free" && cap != null && ownedCount >= cap;
  // If the server refuses a create with a 402 (a race past the instant gate),
  // open the upsell so the user still sees why the routine wasn't created.
  useEffect(() => {
    if (quotaBlocked) setUpsellOpen(true);
  }, [quotaBlocked]);
  // Stable close handlers: Sheet's useOverlay re-runs its focus effect when
  // onClose identity changes, so an inline arrow would re-focus the panel on
  // every keystroke and drop input. (useOverlay should depend on `open` alone —
  // flagged as a follow-up; this keeps the form usable now.)
  const closeForm = useCallback(() => setFormOpen(false), []);
  const closeUpsell = useCallback(() => setUpsellOpen(false), []);

  const onNew = (): void => {
    // Mirror the server cap for instant feedback; the server still enforces it.
    if (atCap) setUpsellOpen(true);
    else setFormOpen(true);
  };

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    const name = title.trim();
    if (!name) return;
    onCreate?.({ title: name, dance });
    setFormOpen(false);
    setTitle("");
  };

  // The "Start from template" button forks the first template (or the sample
  // itself if no dedicated template list is provided). Server-side enforces the
  // fork — the client just fires the callback.
  const templateTarget = templates[0] ?? sample;

  return (
    <section aria-label="Your choreography" className="flex flex-col gap-3">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-medium text-ink">Choreography</h1>
          <Button variant="primary" onClick={onNew}>
            New Choreo
          </Button>
        </div>
        {/* US-046: search box — always present so the user can filter at any list size */}
        {onSearch && (
          <Input
            label="Search"
            type="search"
            placeholder="Search routines…"
            onChange={(e) => onSearch(e.target.value)}
          />
        )}
      </header>

      {/* US-046: search results rendered above the routine cards */}
      {searchResults.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Search results">
          {searchResults.map((r) => (
            <li key={r.docRef}>
              <button
                type="button"
                onClick={() => onOpen?.(r.docRef)}
                className="flex min-h-[44px] w-full items-center gap-3 rounded-md border border-line px-3 py-2 text-left"
              >
                <span className="flex flex-col">
                  <span className="font-medium text-ink">{r.title}</span>
                  {r.dance && (
                    <span className="text-2xs text-ink-muted">{danceLabel(r.dance)}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {routines.length === 0 ? (
        <div className="flex flex-col gap-3">
          {/* US-045: read-only sample in empty state */}
          {sample ? (
            <button
              type="button"
              onClick={() => onOpen?.(sample.docRef)}
              className="flex min-h-[44px] w-full items-center gap-3 rounded-md border border-line px-3 py-2 text-left"
            >
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: `var(--bf-dance-${sample.dance}, var(--bf-accent))` }}
              />
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  <span className="font-medium text-ink">{sample.title}</span>
                  <Badge tone="neutral">Read-only sample</Badge>
                </span>
                <span className="text-2xs text-ink-muted">
                  {danceLabel(sample.dance)} · {DANCES[sample.dance].timeSignature}
                </span>
              </span>
            </button>
          ) : (
            <Card>
              <p className="text-sm text-ink-secondary">
                No routines yet. Tap <span className="font-medium text-ink">New Choreo</span> to
                start your first one.
              </p>
            </Card>
          )}
          {/* US-045: "Start from template" only when a template target is available */}
          {templateTarget && (
            <Button
              variant="secondary"
              onClick={() => onStartFromTemplate?.(templateTarget.docRef)}
            >
              Start from template
            </Button>
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {routines.map((r) => (
            <li key={r.docRef}>
              <button
                type="button"
                onClick={() => onOpen?.(r.docRef)}
                className="flex min-h-[44px] w-full items-center gap-3 rounded-md border border-line px-3 py-2 text-left"
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: `var(--bf-dance-${r.dance}, var(--bf-accent))` }}
                />
                <span className="flex flex-col">
                  <span className="font-medium text-ink">{r.title}</span>
                  <span className="text-2xs text-ink-muted">
                    {danceLabel(r.dance)} · {DANCES[r.dance].timeSignature} ·{" "}
                    {new Date(r.updatedAt).toLocaleDateString()}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Create form */}
      <Sheet open={formOpen} onClose={closeForm} title="New routine">
        <form className="flex flex-col gap-3" onSubmit={submit}>
          <Input
            label="Routine name"
            placeholder="e.g. Showcase Waltz"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            required
          />
          <Select
            label="Dance"
            options={DANCE_OPTIONS}
            value={dance}
            onChange={(e) => setDance(e.target.value as DanceId)}
          />
          <Button type="submit" variant="primary" loading={creating} disabled={!title.trim()}>
            Create
          </Button>
        </form>
      </Sheet>

      {/* Quota upsell */}
      <Sheet open={upsellOpen} onClose={closeUpsell} title="Upgrade for more routines">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-secondary">
            You've reached your free-plan cap{cap != null ? ` of ${cap} routines` : ""}. A paid plan
            will let you create more — your existing routines stay exactly as they are.
          </p>
          {/* Billing is US-053; keep this honest rather than a dead live CTA. */}
          <Button variant="secondary" disabled>
            Pro plans — coming soon
          </Button>
        </div>
      </Sheet>
    </section>
  );
}
