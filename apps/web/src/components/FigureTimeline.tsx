// US-028 — the figure timeline (the hero flow). PLAN §4.4/§4.5.
//
// A row of count cells (conventional labels via countLabel/US-004). Tapping a
// count opens the AttributeEditor for it; choosing a value adds/edits/removes an
// attribute on that count (registry-driven, US-003). Editing is editor-only.
//
// Controlled-with-fallback: seeds from the `attributes` prop and emits every
// edit via `onChange` (the screen wires it to the store's setAttribute mutation;
// tests pass it directly or omit it). A count shows a marker dot when it carries
// any attribute, so the timeline reads at a glance.

import { type Attribute, countLabel, type DanceId } from "@ballroom/domain";
import { useMemo, useState } from "react";
import { Card, CountLabel, cx } from "../ui";
import type { MembershipRole } from "./Assemble";
import { AttributeEditor } from "./AttributeEditor";

export interface FigureTimelineProps {
  /** Membership role — only an editor can place/edit attributes. */
  role: MembershipRole;
  /** The dance, to scope the attribute registry (US-029). */
  dance?: DanceId;
  /** The figure's current attributes (controlled-with-fallback). */
  attributes?: Attribute[];
  /** How many whole counts to lay out (default one 8-count phrase). */
  counts?: number;
  /** The viewed role lens (US-030); new values inherit it. */
  initialView?: "leader" | "follower";
  /** Emits the figure's next full attribute set after an edit. */
  onChange?: (next: Attribute[]) => void;
}

export function FigureTimeline({
  role,
  dance,
  attributes,
  counts = 8,
  initialView,
  onChange,
}: FigureTimelineProps) {
  const [attrs, setAttrs] = useState<Attribute[]>(attributes ?? []);
  const [openCount, setOpenCount] = useState<number | null>(null);
  const view = initialView ?? null;

  const byCount = useMemo(() => {
    const map = new Map<number, Attribute[]>();
    for (const a of attrs) {
      if (a.deletedAt != null) continue;
      const list = map.get(a.count) ?? [];
      list.push(a);
      map.set(a.count, list);
    }
    return map;
  }, [attrs]);

  const cells = Array.from({ length: counts }, (_, i) => i + 1);

  /** Replace this count's attributes within the figure's full set + emit. */
  const onCountChange = (count: number, next: Attribute[]): void => {
    const others = attrs.filter((a) => a.count !== count || a.deletedAt != null);
    const merged = [...others, ...next];
    setAttrs(merged);
    onChange?.(merged);
  };

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-wrap gap-1" aria-label="Count timeline">
        {cells.map((count) => {
          const has = (byCount.get(count) ?? []).length > 0;
          return (
            <li key={count}>
              <button
                type="button"
                aria-label={`count ${count}`}
                aria-expanded={openCount === count}
                onClick={() => setOpenCount(openCount === count ? null : count)}
                className={cx(
                  "relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md border",
                  openCount === count ? "border-accent" : "border-line",
                )}
              >
                <CountLabel value={countLabel(count)} />
                {has && (
                  <span
                    aria-hidden="true"
                    className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent"
                  />
                )}
              </button>
            </li>
          );
        })}
      </ol>

      {openCount !== null && (
        <Card>
          <AttributeEditor
            count={openCount}
            role={role}
            dance={dance}
            view={view}
            value={byCount.get(openCount) ?? []}
            onChange={(next) => onCountChange(openCount, next)}
          />
        </Card>
      )}
    </div>
  );
}
