// US-022/US-025 — the Choreo list: your routines + create, with the quota upsell.
// T2 (design parity, frames 1.1–1.5): "My Choreos" header + round studio-blue +;
// dance-coloured routine cards with a ⋯ menu → Open/Fork sheet; designed empty
// state; New-choreo sheet with dance CHIPS (not a Select).
//
// Presentational (the §3 seam): it takes the routine list + handlers as props and
// renders + collects input; the screen wrapper (ChoreoFlow) wires the store (list
// query + create/fork mutations) and navigation. The free plan owns at most the
// server-sourced cap (D21) — the server is authoritative (POST → 402 upsell) and
// this screen mirrors the cap so a capped user sees the upsell without a round-trip.
// Sample/template empty state + fork are US-045/US-037. Header search is US-046.

import type { RoutineListItem, SearchResult } from "@ballroom/contract";
import { DANCE_IDS, type DanceId } from "@ballroom/domain";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Chip,
  EmptyState,
  IconButton,
  Input,
  Modal,
  ScreenHeader,
  Sheet,
} from "../ui";
import { BranchIcon, EditIcon, PlusIcon, StepsIcon, TrashIcon } from "../ui/icons";

/** Humanize a dance id for display ("viennese_waltz" → "Viennese Waltz"). */
function danceLabel(dance: DanceId): string {
  return dance
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Dance → identity colour, mapped onto existing design tokens (no new hex):
 * waltz = studio-blue, viennese = slate, quickstep = green, foxtrot = violet,
 * tango = terracotta/red. Used for the card's glyph tile (frame 1.1/1.3).
 */
const DANCE_COLOR: Record<DanceId, string> = {
  waltz: "var(--bf-accent)",
  viennese_waltz: "var(--bf-kind-turn)",
  quickstep: "var(--bf-kind-rise)",
  foxtrot: "var(--bf-kind-position)",
  tango: "var(--bf-kind-sway)",
};

/** Dances offered as chips in the New-choreo sheet (frame 1.5). */
const NEW_CHOREO_DANCES: readonly DanceId[] = DANCE_IDS;

/**
 * Human "month year" / "today" stamp (frame 1.1: "Jun 2025" / "today"), never a
 * raw locale date like 6/29/2026. Fixed en-US so screenshots stay deterministic.
 */
function formatUpdated(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  if (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  ) {
    return "today";
  }
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/**
 * A Choreo-list row. Extends the D1-projected {@link RoutineListItem} with the
 * OPTIONAL parity fields (derived bar count / figure count / fork lineage) that
 * aren't in the list projection yet — rendered only when present so the card
 * degrades gracefully until the store exposes them (see T2 report data gaps).
 */
export interface ChoreoRoutineItem extends RoutineListItem {
  /** Derived bar count, when available without loading the routine doc. */
  bars?: number;
  /** Figure count, when available — drives the "no figures yet" label. */
  figureCount?: number;
  /** Title of the routine this one was forked from (lineage line, frame 1.3). */
  forkedFromTitle?: string;
}

export interface ChoreoListProps {
  /** The viewer's routines (owned + shared-in). */
  routines?: ChoreoRoutineItem[];
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
  /** Fork a routine into a new owned, frozen copy (US-037, from the ⋯ sheet). */
  onFork?: (docRef: string) => void;
  /** Delete a routine (owner-only, from the ⋯ sheet → confirm). The screen wires
   *  this to the store; the Delete affordance only shows for routines the viewer owns. */
  onDelete?: (docRef: string) => void;
  /** A create is in flight. */
  creating?: boolean;
  /** A delete is in flight (drives the confirm button's loading state). */
  deleting?: boolean;
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

/** The choreo glyph tile (vertical-bars Steps mark on a dance-coloured square). */
function GlyphTile({ color }: { color: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-[34px] shrink-0 items-center justify-center rounded-[9px] text-ink-inverse"
      style={{ background: color }}
    >
      <StepsIcon size={18} />
    </span>
  );
}

export function ChoreoList({
  routines = [],
  ownedCount,
  plan,
  cap,
  quotaBlocked,
  onCreate,
  onOpen,
  onFork,
  onDelete,
  creating,
  deleting,
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
  // Which routine's ⋯ Open/Fork sheet is open (null = closed).
  const [menuFor, setMenuFor] = useState<ChoreoRoutineItem | null>(null);
  // Which routine the destructive delete-confirm dialog is for (null = closed).
  const [confirmDelete, setConfirmDelete] = useState<ChoreoRoutineItem | null>(null);
  const atCap = plan === "free" && cap != null && ownedCount >= cap;
  // If the server refuses a create with a 402 (a race past the instant gate),
  // open the upsell so the user still sees why the routine wasn't created.
  useEffect(() => {
    if (quotaBlocked) setUpsellOpen(true);
  }, [quotaBlocked]);
  // Stable close handlers: Sheet's useOverlay re-runs its focus effect when
  // onClose identity changes, so an inline arrow would re-focus the panel on
  // every keystroke and drop input.
  const closeForm = useCallback(() => setFormOpen(false), []);
  const closeUpsell = useCallback(() => setUpsellOpen(false), []);
  const closeMenu = useCallback(() => setMenuFor(null), []);
  const closeConfirmDelete = useCallback(() => setConfirmDelete(null), []);

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
  // itself if no dedicated template list is provided).
  const templateTarget = templates[0] ?? sample;

  return (
    <section aria-label="Your choreography" className="flex flex-col gap-3">
      <ScreenHeader
        title="My Choreos"
        className="border-b-0 px-0 py-0"
        actions={
          <IconButton
            label="New choreo"
            onClick={onNew}
            style={{
              background: "var(--bf-accent)",
              color: "var(--bf-ink-inverse)",
              borderRadius: "var(--bf-radius-md)",
            }}
          >
            <PlusIcon size={20} />
          </IconButton>
        }
      />

      {/* Region heading for the routines list (sr-only). Keeps the heading order
          valid (h1 screen → h2 section → h3 EmptyState) without a visible label
          the design doesn't show. */}
      <h2 className="bf-sr-only">Your choreography</h2>

      {/* US-046: search box — kept available but visually subordinate (not in the
          design frame). It filters at any list size without dominating the header. */}
      {onSearch && (
        <Input
          label="Search"
          hideLabel
          type="search"
          placeholder="Search routines…"
          onChange={(e) => onSearch(e.target.value)}
        />
      )}

      {/* US-046: search results rendered above the routine cards */}
      {searchResults.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Search results">
          {searchResults.map((r) => (
            <li key={r.docRef}>
              <button
                type="button"
                onClick={() => onOpen?.(r.docRef)}
                className="flex min-h-[44px] w-full items-center gap-3 rounded-md border border-border-default px-3 py-2 text-left"
              >
                <span className="flex flex-col">
                  <span className="font-bold text-ink">{r.title}</span>
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
          {/* Frame 1.2 — the designed empty state. */}
          <EmptyState
            icon={<StepsIcon size={28} />}
            title="No choreos yet"
            description="Each dance gets its own routine — plus extras for practice. Start your first."
            actions={
              <Button variant="primary" leadingIcon={<PlusIcon size={16} />} onClick={onNew}>
                Create choreo
              </Button>
            }
          />
          {/* US-045: read-only sample + start-from-template, when the app publishes one. */}
          {sample && (
            <button
              type="button"
              onClick={() => onOpen?.(sample.docRef)}
              className="flex min-h-[44px] w-full items-center gap-3 rounded-lg border border-border-default px-3 py-2 text-left"
            >
              <GlyphTile color={DANCE_COLOR[sample.dance]} />
              <span className="flex flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-2">
                  <span className="font-bold text-ink">{sample.title}</span>
                  <Badge tone="neutral">Read-only sample</Badge>
                </span>
                <span className="text-2xs text-ink-muted">{danceLabel(sample.dance)}</span>
              </span>
            </button>
          )}
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
        <ul className="flex flex-col gap-2.5">
          {routines.map((r) => {
            const forked = Boolean(r.forkedFromTitle);
            // Meta segments (frame 1.1): Dance · <bars|no figures> · <date>.
            // Bars/figure-count come from the OPTIONAL parity fields; absent until
            // the store exposes them, in which case the segment is simply omitted.
            const barsLabel =
              r.figureCount === 0
                ? "no figures yet"
                : r.bars != null
                  ? `${r.bars} bars`
                  : undefined;
            const meta = [danceLabel(r.dance), barsLabel, formatUpdated(r.updatedAt)]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={r.docRef} className="relative">
                <button
                  type="button"
                  onClick={() => onOpen?.(r.docRef)}
                  className="flex min-h-[64px] w-full items-center gap-3 rounded-lg border bg-surface py-3 pl-3 pr-12 text-left"
                  style={
                    forked
                      ? {
                          background: "var(--bf-scope-custom-tint)",
                          borderColor: "var(--bf-scope-custom-border)",
                        }
                      : { borderColor: "var(--bf-border)" }
                  }
                >
                  <GlyphTile color={forked ? "var(--bf-scope-custom)" : DANCE_COLOR[r.dance]} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span
                      className="truncate text-xs font-bold"
                      style={{ color: forked ? "var(--bf-scope-custom-ink)" : "var(--bf-ink)" }}
                    >
                      {r.title}
                    </span>
                    {forked ? (
                      <span
                        className="truncate text-2xs"
                        style={{ color: "var(--bf-scope-custom-ink)" }}
                      >
                        <span aria-hidden="true">⑂ </span>
                        forked from {r.forkedFromTitle}
                      </span>
                    ) : (
                      <span className="truncate text-2xs text-ink-muted">{meta}</span>
                    )}
                  </span>
                </button>
                <IconButton
                  label={`More options for ${r.title}`}
                  onClick={() => setMenuFor(r)}
                  className="absolute right-1 top-1/2 -translate-y-1/2"
                >
                  <span className="text-base leading-none">⋯</span>
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}

      {/* New-choreo sheet (frame 1.5) */}
      <Sheet open={formOpen} onClose={closeForm} title="New choreography">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <fieldset className="flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1.5 text-2xs font-bold uppercase tracking-wide text-ink-muted">
              Dance
            </legend>
            <div className="flex flex-wrap gap-2">
              {NEW_CHOREO_DANCES.map((d) => (
                <Chip key={d} tone="accent" selected={dance === d} onClick={() => setDance(d)}>
                  {danceLabel(d)}
                </Chip>
              ))}
            </div>
          </fieldset>
          <Input
            label="Routine name"
            placeholder="e.g. Gold Waltz — comp routine"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            required
          />
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={closeForm} className="flex-1">
              cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={creating}
              disabled={!title.trim()}
              className="flex-1"
            >
              create choreo
            </Button>
          </div>
        </form>
      </Sheet>

      {/* Open / Fork sheet (frame 1.4) */}
      <Sheet open={menuFor != null} onClose={closeMenu} title={menuFor?.title ?? ""}>
        <p
          className="mb-3 text-ink-secondary"
          style={{ fontFamily: "var(--bf-font-note)", fontSize: "var(--bf-text-note)" }}
        >
          Choose what to do with this routine
        </p>
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => {
              if (menuFor) onOpen?.(menuFor.docRef);
              closeMenu();
            }}
            className="flex w-full items-center gap-3 rounded-lg border border-border-default bg-surface p-3 text-left"
          >
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-md text-accent"
              style={{ background: "var(--bf-accent-tint)" }}
            >
              <EditIcon size={16} />
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-bold text-ink">Open</span>
              <span className="text-2xs text-ink-muted">view &amp; edit this routine</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (menuFor) onFork?.(menuFor.docRef);
              closeMenu();
            }}
            className="flex w-full items-center gap-3 rounded-lg border p-3 text-left"
            style={{
              background: "var(--bf-scope-custom-tint)",
              borderColor: "var(--bf-scope-custom-border)",
            }}
          >
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-md"
              style={{
                background: "var(--bf-scope-custom-border)",
                color: "var(--bf-scope-custom-ink)",
              }}
            >
              <BranchIcon size={16} />
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-bold" style={{ color: "var(--bf-scope-custom-ink)" }}>
                Fork — make it your own
              </span>
              <span className="text-2xs" style={{ color: "var(--bf-scope-custom-ink)" }}>
                a frozen, independent copy you fully own
              </span>
            </span>
          </button>
          {/* Delete — owner-only (the server enforces canDelete); opens a
              destructive confirm before removing. */}
          {onDelete && menuFor?.role === "owner" && (
            <button
              type="button"
              onClick={() => {
                setConfirmDelete(menuFor);
                closeMenu();
              }}
              className="flex w-full items-center gap-3 rounded-lg border border-border-default bg-surface p-3 text-left"
            >
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-md text-danger"
                style={{ background: "var(--bf-danger-tint)" }}
              >
                <TrashIcon size={16} />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-bold text-danger">Delete</span>
                <span className="text-2xs text-ink-muted">remove this routine from your list</span>
              </span>
            </button>
          )}
        </div>
      </Sheet>

      {/* Delete confirm (destructive) — PLAN §4.0: deletes are confirmed. */}
      <Modal
        open={confirmDelete != null}
        onClose={closeConfirmDelete}
        title="Delete this routine?"
        confirm={{
          label: "Delete",
          variant: "danger",
          loading: deleting,
          onClick: () => {
            if (confirmDelete) onDelete?.(confirmDelete.docRef);
            setConfirmDelete(null);
          },
        }}
      >
        <p>
          “{confirmDelete?.title}” will be removed from your choreos. This can't be undone here.
        </p>
      </Modal>

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
