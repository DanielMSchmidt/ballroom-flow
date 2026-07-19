import { useState } from "react";
import {
  ATTRIBUTE_KINDS,
  Badge,
  Button,
  Card,
  Chip,
  CountLabel,
  EmptyState,
  FIGURE_SCOPES,
  IconButton,
  Input,
  kindVar,
  List,
  ListRow,
  Modal,
  OfflineState,
  ScopeBadge,
  Select,
  Sheet,
  Skeleton,
  SkeletonRow,
  Spinner,
  Tabs,
  Toggle,
  useToast,
} from "../ui";
import { EditIcon, PlusIcon, ShareIcon, StepsIcon, UndoIcon, WarningIcon } from "../ui/icons";

/** A labelled section wrapper for the gallery. */
function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-border-subtle py-6 first:border-t-0">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-ink">{title}</h2>
        {note && <p className="mt-0.5 text-2xs text-ink-muted">{note}</p>}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

const KIND_LABELS: Record<string, { code: string; word: string }> = {
  step: { code: "Fw", word: "Footwork" },
  rise: { code: "Ri", word: "Rise" },
  position: { code: "Bo", word: "Body" },
  sway: { code: "Sw", word: "Sway" },
  turn: { code: "Tn", word: "Turn" },
};

/**
 * Styleguide — live gallery of every design-system primitive in its
 * states. Wired into App.tsx at `/styleguide`. This is the visual
 * acceptance surface for DESIGN-PRINCIPLES.
 */
export function Styleguide() {
  const toast = useToast();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [tab, setTab] = useState("all");
  const [toggle, setToggle] = useState(true);
  const [roleView, setRoleView] = useState(false);
  const [pickedKind, setPickedKind] = useState<string | null>("rise");
  const [text, setText] = useState("");

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-16">
      <header className="py-6">
        <h1 className="text-xl font-bold tracking-tight text-ink">Weave Steps — Design System</h1>
        <p
          className="mt-1 text-ink-secondary"
          style={{ fontFamily: "var(--bf-font-note)", fontSize: "var(--bf-text-md)" }}
        >
          studio-paper canvas · mono UI type · handwritten notes · token-driven
        </p>
      </header>

      <Section title="Typography" note="Inconsolata (mono UI) + Caveat (handwritten human notes)">
        <p className="text-xl font-bold text-ink">Screen title — 24px bold</p>
        <p className="text-lg font-bold text-ink">Section title — 19px bold</p>
        <p className="text-base text-ink">Body — 14px. The quick brown fox jumps.</p>
        <p className="text-2xs text-ink-muted uppercase tracking-wide">Eyebrow / metadata — 10px</p>
        <p
          style={{
            fontFamily: "var(--bf-font-note)",
            fontSize: "var(--bf-text-note)",
            color: "var(--bf-ink-secondary)",
          }}
        >
          Handwritten note — heads stay left through the natural turn.
        </p>
      </Section>

      <Section
        title="Attribute-kind colors"
        note="The five kinds (docs/concepts/notation.md § Kinds) — color is ALWAYS paired with code + word (#5)"
      >
        <Row>
          {ATTRIBUTE_KINDS.map((k) => (
            <span key={k} className="inline-flex items-center gap-2">
              <span
                className="size-4 rounded-sm"
                style={{ background: kindVar(k) }}
                aria-hidden="true"
              />
              <Badge tone="neutral">{KIND_LABELS[k]?.code}</Badge>
              <span className="text-2xs text-ink-muted">{KIND_LABELS[k]?.word}</span>
            </span>
          ))}
        </Row>
        <Row>
          {ATTRIBUTE_KINDS.map((k) => (
            <Chip key={k} tone={k} asStatic>
              {KIND_LABELS[k]?.word}
            </Chip>
          ))}
        </Row>
      </Section>

      <Section
        title="ScopeBadge"
        note="Two figure scopes by content divergence — text + icon + color (#11)"
      >
        <Row>
          {FIGURE_SCOPES.map((s) => (
            <ScopeBadge key={s} scope={s} />
          ))}
        </Row>
        <Row>
          {FIGURE_SCOPES.map((s) => (
            <ScopeBadge key={s} scope={s} compact />
          ))}
        </Row>
      </Section>

      <Section title="Buttons" note="≥44px hit area (#3), focus ring (#7), loading state (#18)">
        <Row>
          <Button variant="primary">Create choreo</Button>
          <Button variant="secondary">Cancel</Button>
          <Button variant="ghost">Skip</Button>
          <Button variant="danger" leadingIcon={<WarningIcon size={15} />}>
            Delete
          </Button>
        </Row>
        <Row>
          <Button size="sm" leadingIcon={<PlusIcon size={14} />}>
            Add figure
          </Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
        </Row>
        <Row>
          <IconButton label="Edit">
            <EditIcon size={18} />
          </IconButton>
          <IconButton label="Share" variant="filled">
            <ShareIcon size={18} />
          </IconButton>
          <IconButton label="Add" variant="inverse">
            <PlusIcon size={18} />
          </IconButton>
        </Row>
      </Section>

      <Section title="Inputs & Select" note="Labelled, hint + error states (#8)">
        <Input
          label="Choreo name"
          placeholder="e.g. Gold Waltz — comp routine"
          value={text}
          onChange={(e) => setText(e.target.value)}
          hint="Give it a name you'll recognise."
        />
        <Input label="Name" error="This field is required." placeholder="…" defaultValue="" />
        <Select
          label="Dance"
          placeholder="Pick a dance"
          options={[
            { value: "waltz", label: "Waltz" },
            { value: "tango", label: "Tango" },
            { value: "quickstep", label: "Quickstep" },
          ]}
        />
      </Section>

      <Section
        title="Chips — single-select (the tag editor pattern)"
        note="aria-pressed; keyboard operable (#7)"
      >
        <Row>
          {["lowering", "body rise", "up", "continue"].map((v) => (
            <Chip
              key={v}
              tone="rise"
              selected={pickedKind === v}
              onClick={() => setPickedKind((p) => (p === v ? null : v))}
            >
              {v}
            </Chip>
          ))}
        </Row>
      </Section>

      <Section
        title="Count labels"
        note="Presentational seam — e=.25 / &=.5 / a=.75 (#27); conversion lives in domain"
      >
        <Row>
          {["1", "&", "2", "3", "3a", "&a"].map((c) => (
            <CountLabel key={c} value={c} />
          ))}
        </Row>
      </Section>

      <Section title="Badges" note="Status markers — always text + tone (#5)">
        <Row>
          <Badge tone="neutral">custom</Badge>
          <Badge tone="accent">3 counts</Badge>
          <Badge tone="success">synced</Badge>
          <Badge tone="warning" leading={<WarningIcon size={11} />}>
            3 / 3 routines
          </Badge>
          <Badge tone="danger">conflict</Badge>
          <Badge tone="info">2 notes</Badge>
        </Row>
      </Section>

      <Section title="Tabs" note="ARIA tabs, arrow-key roving focus (#7)">
        <Tabs
          label="Journal filter"
          value={tab}
          onChange={setTab}
          items={[
            { value: "all", label: "all" },
            { value: "lessons", label: "lessons" },
            { value: "practice", label: "practice" },
            { value: "by-figure", label: "by figure" },
          ]}
        />
      </Section>

      <Section
        title="Toggle / Switch"
        note="role=switch (#7, #8). Role is a per-device VIEW, not a stored role (#25)"
      >
        <Toggle checked={toggle} onChange={setToggle} label="Lanes view" />
        <Toggle
          checked={roleView}
          onChange={setRoleView}
          label={roleView ? "Following" : "Leading"}
        />
        <Toggle checked={false} onChange={() => {}} label="Disabled" disabled />
      </Section>

      <Section
        title="Cards & List rows"
        note="ListRow is a real button — whole row is the ≥44px target (#3)"
      >
        <Card>
          <p className="text-sm font-bold text-ink">Gold Waltz</p>
          <p className="mt-0.5 text-2xs text-ink-muted">Waltz · 7 bars · Jun 2025</p>
        </Card>
        <List>
          <ListRow
            leading={
              <span className="flex size-10 items-center justify-center rounded-md bg-accent text-ink-inverse">
                <StepsIcon size={18} />
              </span>
            }
            title="Natural Turn"
            subtitle="1st Long Side · 3 counts"
            trailing={<ScopeBadge scope="library" compact />}
          />
        </List>
      </Section>

      <Section title="Empty / loading / offline states" note="First-class states (#18, #19, #20)">
        <EmptyState
          icon={<StepsIcon size={28} />}
          title="No routines yet"
          description="Start from a sample, or build your first routine from a template."
          actions={
            <>
              <Button fullWidth leadingIcon={<PlusIcon size={14} />}>
                New routine
              </Button>
              <Button variant="secondary" fullWidth>
                Open the sample
              </Button>
            </>
          }
        />
        <div className="flex flex-col gap-2">
          <SkeletonRow />
          <SkeletonRow />
        </div>
        <Row>
          <Spinner /> <span className="text-2xs text-ink-muted">loading…</span>
          <Skeleton className="w-32" />
        </Row>
        <OfflineState
          action={
            <Button variant="secondary" size="sm">
              Retry
            </Button>
          }
        />
      </Section>

      <Section
        title="Overlays & Toasts"
        note="Dialog semantics, Escape/focus handling (#7,#8); toasts announce to AT (#16)"
      >
        <Row>
          <Button onClick={() => setSheetOpen(true)}>Open bottom sheet</Button>
          <Button variant="danger" onClick={() => setModalOpen(true)}>
            Delete (confirm)
          </Button>
        </Row>
        <Row>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => toast.show("Made this figure yours")}
          >
            Toast: copy-on-write
          </Button>
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<UndoIcon size={14} />}
            onClick={() => toast.show("Undone", { action: { label: "Redo", onClick: () => {} } })}
          >
            Toast: undo
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              toast.show("You've reached 3 routines on the free plan.", {
                tone: "warning",
                action: { label: "Upgrade", onClick: () => {} },
                duration: 6000,
              })
            }
          >
            Toast: quota upsell
          </Button>
        </Row>
      </Section>

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Figure library"
        meta="Waltz · add to 1st Long Side"
      >
        <Input label="Filter" hideLabel placeholder="filter figures…" />
        <List className="mt-3">
          <ListRow
            title="Natural Turn"
            trailing={<ScopeBadge scope="library" compact />}
            showChevron={false}
          />
          <ListRow
            title="Whisk"
            trailing={<ScopeBadge scope="library" compact />}
            showChevron={false}
          />
          <ListRow
            title="My Chassé"
            trailing={<ScopeBadge scope="custom" compact />}
            showChevron={false}
          />
        </List>
      </Sheet>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Delete this routine?"
        confirm={{
          label: "Delete",
          variant: "danger",
          onClick: () => {
            setModalOpen(false);
            toast.show("Routine deleted", {
              tone: "neutral",
              action: { label: "Undo", onClick: () => {} },
            });
          },
        }}
      >
        It moves to your trash — you can undo this right after.
      </Modal>
    </div>
  );
}
