// US-056 — the staging demo-seed builder (docs/system/architecture.md § Ops /
// admin seams; docs/DEVELOPMENT.md § Seeding a staging demo account).
//
// A PURE, DETERMINISTIC builder that describes a rich SYNTHETIC demo dataset for
// ONE target user, so an operator can populate a staging account with one call
// instead of hand-entering data. NO production data is involved — every routine
// is authored here from the shipped syllabus (real charted `LIBRARY_FIGURES`),
// and every annotation body is synthetic demo prose.
//
// The worker's admin route (apps/worker/src/routes/seed-demo.ts) materializes the
// value this returns through the EXISTING write seams (createOwnedRoutine, seedDoc,
// membership rows, upsertAccountKind). This module does no I/O and mints no
// ULIDs / no `Date.now()`: ids are namespaced by the target user via a stable
// minter (so a re-run is idempotent and never collides with real data), and every
// `createdAt` is a caller-supplied backdated timestamp — the builder owns the
// clock, so the fade-out feature (when it lands) has active-vs-stale material.
//
// EXTENSION POINT (WEP-only annotation types): the annotation authors below emit
// only the anchor types that EXIST in main's schema today (point / figure /
// figureType — see `Anchor` in doc-types.ts). The deferred idea docs add more
// (attribute-predicate anchors, media embeds, voice-origin notes, coupling maps);
// they slot in at `authorExtendedAnnotations` (below) once those features merge —
// authoring them now would fail strict-write validation. Do NOT add them here.
import type { DanceId } from "./dances";
import type { AccountDoc, Annotation, Attribute, FigureDoc, RoutineDoc } from "./doc-types";
import { LIBRARY_FIGURES } from "./library";
import { CURRENT_SCHEMA_VERSION } from "./migrations";
import { keyBetween, sequentialKeys } from "./order";
import type { RegistryKind } from "./vocabulary";

const DAY = 24 * 60 * 60 * 1000;

/** A per-document membership row the seeder writes to D1 for sharing. */
export type DemoMembership = {
  docRef: string;
  userId: string;
  role: "viewer" | "commenter" | "editor";
};

/** One routine + the figure docs its placements reference (like buildGoldenWaltzBasic). */
export type DemoRoutine = {
  routine: RoutineDoc;
  figures: FigureDoc[];
};

/** One account doc to seed (the owner + each synthetic co-member). Carries
 *  backdated family-note annotations authored directly into the doc content. */
export type DemoAccount = {
  userId: string;
  doc: AccountDoc;
};

/** The full synthetic demo dataset for one target user. */
export type DemoSeed = {
  /** The owner the seed is materialized into. */
  userId: string;
  /** Synthetic co-member ids (namespaced by `userId`; never real logins). */
  coMemberIds: string[];
  /** Routines across dances, each with its charted figures. */
  routines: DemoRoutine[];
  /** Account docs to seed: the owner's + each co-member's (family notes live here). */
  accounts: DemoAccount[];
  /** Membership rows sharing some routines with the co-members. */
  memberships: DemoMembership[];
  /** The account-wide custom attribute kind applied on some steps. */
  customKind: RegistryKind;
};

export type BuildDemoSeedOptions = {
  /** The target user the demo dataset is authored FOR + owned by. */
  userId: string;
  /** The "now" the backdated spread is measured from (epoch ms). Injected so the
   *  build is deterministic; the worker passes `Date.now()`. */
  now: number;
};

/**
 * A counter-based, user-namespaced id minter. Passing the same `userId` + tag
 * always produces the same sequence, so a re-run is byte-identical and two users'
 * seeds never share an id. Shape mirrors `demo_<userId>_<tag><n>` so a demo doc is
 * recognisable and the DELETE side can target the set by prefix.
 */
function demoMinter(userId: string, tag: string): () => string {
  let n = 0;
  return () => `demo_${userId}_${tag}${++n}`;
}

/** A recognisable, per-user-namespaced synthetic co-member id (never a real login). */
export function demoCoMemberId(userId: string, role: string): string {
  return `demo_${userId}_${role}`;
}

/** A recognisable prefix for every doc/id this builder mints for `userId`, so the
 *  DELETE side can select the demo set without a registry flag. */
export function demoPrefix(userId: string): string {
  return `demo_${userId}_`;
}

/** One composed routine spec: dance, title, and the ordered charted figures. */
type RoutineSpec = {
  tag: string;
  dance: DanceId;
  title: string;
  figureTypes: string[];
};

// Four routines across four dances, each an amalgamation of REAL charted figures
// (verified present in LIBRARY_FIGURES with charts) composed into a plausible
// amateur routine — the Golden Waltz template pattern, extended. No figure data is
// invented here: names + attributes are copied verbatim from the catalog.
const ROUTINE_SPECS: readonly RoutineSpec[] = [
  {
    tag: "wz",
    dance: "waltz",
    title: "Demo — Silver Waltz Amalgamation",
    figureTypes: [
      "closed-change-on-rf",
      "natural-turn",
      "closed-change-on-lf",
      "reverse-turn",
      "whisk",
      "chasse-from-pp",
      "natural-spin-turn",
    ],
  },
  {
    tag: "fx",
    dance: "foxtrot",
    title: "Demo — Bronze Foxtrot Routine",
    figureTypes: [
      "feather-step",
      "three-step",
      "natural-turn",
      "closed-telemark",
      "feather-finish",
      "reverse-turn",
    ],
  },
  {
    tag: "qs",
    dance: "quickstep",
    title: "Demo — Quickstep Social Routine",
    figureTypes: [
      "quarter-turn-to-r",
      "progressive-chasse",
      "forward-lock",
      "natural-turn",
      "natural-spin-turn",
      "closed-impetus",
    ],
  },
  {
    tag: "tg",
    dance: "tango",
    title: "Demo — Tango Bronze Routine",
    figureTypes: [
      "progressive-link",
      "closed-promenade",
      "back-corte",
      "open-promenade",
      "five-step",
      "rock-turn",
    ],
  },
];

// The account-wide custom kind. Role-aware enum (per the brief): a coaching
// "focus" tag the studio applies to specific steps. Synthetic demo vocabulary —
// not a ballroom-technique claim, so it never collides with a builtin kind.
const CUSTOM_KIND_SLUG = "focus";
const CUSTOM_KIND_VALUES = ["frame", "footwork", "timing", "connection"] as const;

function buildCustomKind(): RegistryKind {
  return {
    kind: CUSTOM_KIND_SLUG,
    label: "Coaching focus",
    color: "#c77d3a",
    cardinality: "single",
    valueType: "enum",
    values: [...CUSTOM_KIND_VALUES],
    appliesToDances: ["waltz", "foxtrot", "quickstep", "tango", "viennese_waltz"],
    description: "The studio's coaching focus for this step (demo custom kind).",
    roleAware: true,
    required: false,
    builtin: false,
  };
}

/** Look up a charted catalog figure, or throw — the specs above are all verified
 *  charted, so a miss is a seed-data regression the tests catch, never fabrication. */
function libFigure(dance: DanceId, figureType: string) {
  const lib = LIBRARY_FIGURES.find((l) => l.dance === dance && l.figureType === figureType);
  if (!lib) {
    throw new Error(`demo-seed: catalog figure ${dance}:${figureType} not found (seed-data drift)`);
  }
  return lib;
}

/** The distinct whole-beat counts on a figure's charted timeline (ascending). A
 *  custom-kind attribute lands on one of these so it sits on a real step. */
function wholeBeatCounts(attributes: readonly Attribute[]): number[] {
  const set = new Set<number>();
  for (const a of attributes) {
    if (Number.isInteger(a.count)) set.add(a.count);
  }
  return [...set].sort((x, y) => x - y);
}

/**
 * Build the full synthetic demo dataset for `opts.userId`. Pure + deterministic.
 * See the module header for the guarantees (idempotent, backdated, no fabrication).
 */
export function buildDemoSeed(opts: BuildDemoSeedOptions): DemoSeed {
  const { userId, now } = opts;
  const mintFigure = demoMinter(userId, "fig");
  const mintRoutine = demoMinter(userId, "rt");
  const mintSection = demoMinter(userId, "sec");
  const mintPlacement = demoMinter(userId, "pl");
  const mintAnn = demoMinter(userId, "ann");
  const mintReply = demoMinter(userId, "rep");
  const mintNote = demoMinter(userId, "note");
  const mintAttr = demoMinter(userId, "attr");

  const coach = demoCoMemberId(userId, "coach");
  const partner = demoCoMemberId(userId, "partner");
  const friend = demoCoMemberId(userId, "friend");
  const coMemberIds = [coach, partner, friend];

  const customKind = buildCustomKind();

  const routines: DemoRoutine[] = [];
  const memberships: DemoMembership[] = [];
  // Family-note annotations, bucketed by their author so each account doc gets its own.
  const familyNotesByAuthor = new Map<string, Annotation[]>([
    [userId, []],
    [coach, []],
    [partner, []],
    [friend, []],
  ]);

  ROUTINE_SPECS.forEach((spec, specIndex) => {
    const figures: FigureDoc[] = spec.figureTypes.map((figureType, figIndex) => {
      const lib = libFigure(spec.dance, figureType);
      const attributes: Attribute[] = (lib.attributes ?? []).map((a) => ({ ...a }));
      // Apply the custom kind on the FIRST routine's figures so some steps carry a
      // coaching focus (deterministic: the first whole-beat count, leader lens).
      if (specIndex === 0) {
        const counts = wholeBeatCounts(attributes);
        const anchorCount = counts[0];
        if (anchorCount != null) {
          const value = CUSTOM_KIND_VALUES[figIndex % CUSTOM_KIND_VALUES.length];
          attributes.push({
            id: mintAttr(),
            kind: CUSTOM_KIND_SLUG,
            count: anchorCount,
            role: "leader",
            value,
          });
        }
      }
      return {
        id: mintFigure(),
        scope: "account",
        ownerId: userId,
        figureType,
        dance: spec.dance,
        name: lib.name,
        source: "custom",
        attributes,
        schemaVersion: CURRENT_SCHEMA_VERSION,
        deletedAt: null,
      };
    });

    const placementKeys = sequentialKeys(figures.length);
    const routineId = mintRoutine();
    const annotations = authorRoutineAnnotations({
      routineId,
      figures,
      dance: spec.dance,
      owner: userId,
      coach,
      partner,
      now,
      specIndex,
      mintAnn,
      mintReply,
    });

    const routine: RoutineDoc = {
      id: routineId,
      title: spec.title,
      dance: spec.dance,
      ownerId: userId,
      sections: [
        {
          id: mintSection(),
          name: "Full routine",
          placements: figures.map((f, i) => ({
            id: mintPlacement(),
            figureRef: f.id,
            sortKey: placementKeys[i],
            deletedAt: null,
          })),
          sortKey: keyBetween(null, null),
          deletedAt: null,
        },
      ],
      annotations,
      // The account-wide custom kind is also recorded on the routine doc so the
      // editor renders its lane even before the D1 custom-kind row projects.
      customKinds: [customKind],
      schemaVersion: CURRENT_SCHEMA_VERSION,
      deletedAt: null,
    };

    routines.push({ routine, figures });

    // Share the first two routines with the co-members so the owner's view
    // exercises sharing + multi-author threads (the others stay solo).
    if (specIndex === 0) {
      memberships.push({ docRef: routineId, userId: coach, role: "commenter" });
      memberships.push({ docRef: routineId, userId: partner, role: "editor" });
    } else if (specIndex === 1) {
      memberships.push({ docRef: routineId, userId: coach, role: "viewer" });
    }

    // A backdated family note per dance, alternating author so co-members author
    // some of them. figureType anchors are cross-figure (family-level).
    const noteAuthor = specIndex % 2 === 0 ? coach : userId;
    const firstFigure = figures[0];
    if (firstFigure) {
      const bucket = familyNotesByAuthor.get(noteAuthor);
      bucket?.push({
        id: mintNote(),
        authorId: noteAuthor,
        kind: "lesson",
        text: familyNoteText(spec.dance, firstFigure.figureType),
        tags: [],
        anchors: [
          { type: "figureType", figureType: firstFigure.figureType, danceScope: spec.dance },
        ],
        replies: [],
        // Spread family notes old→recent across the specs.
        createdAt: now - (90 - specIndex * 20) * DAY,
        deletedAt: null,
      });
    }
  });

  // A whole-family note spanning ALL dances, authored by the partner co-member.
  familyNotesByAuthor.get(partner)?.push({
    id: mintNote(),
    authorId: partner,
    kind: "practice",
    text: "Across every dance: sustain the rise through the top of each swing.",
    tags: [],
    anchors: [{ type: "figureType", figureType: "natural-turn", danceScope: "all" }],
    replies: [],
    createdAt: now - 45 * DAY,
    deletedAt: null,
  });

  const accounts: DemoAccount[] = [...familyNotesByAuthor.entries()].map(([author, notes]) => ({
    userId: author,
    doc: {
      id: `account:${author}`,
      ownerId: author,
      annotations: notes,
      libraryFigureRefs: [],
      schemaVersion: CURRENT_SCHEMA_VERSION,
      deletedAt: null,
    },
  }));

  return { userId, coMemberIds, routines, accounts, memberships, customKind };
}

/**
 * Author the routine-scoped annotations for one routine: a spread across the three
 * anchor types (point / figure / figureType), several per routine, some threaded
 * (multi-message replies), some by co-members, all with backdated createdAt.
 */
function authorRoutineAnnotations(args: {
  routineId: string;
  figures: FigureDoc[];
  dance: DanceId;
  owner: string;
  coach: string;
  partner: string;
  now: number;
  specIndex: number;
  mintAnn: () => string;
  mintReply: () => string;
}): Annotation[] {
  const { figures, dance, owner, coach, partner, now, specIndex, mintAnn, mintReply } = args;
  const out: Annotation[] = [];
  const first = figures[0];
  if (!first) return out;
  // A distinct second figure when present (all demo specs have ≥ 4), else reuse
  // the first — the `?? first` keeps `second` provably non-null for the compiler.
  const second = figures[1] ?? first;

  // A POINT anchor: a note pinned to count 1 of the first figure, threaded with a
  // two-message reply conversation (owner → coach → owner).
  out.push({
    id: mintAnn(),
    authorId: owner,
    kind: "note",
    text: "Watch the rise timing here — feels early on count 1.",
    tags: ["technique"],
    anchors: [{ type: "point", figureRef: first.id, count: 1, role: "leader" }],
    replies: [
      {
        id: mintReply(),
        authorId: coach,
        text: "Agreed — commence the rise at the end of 1, not on it.",
        createdAt: now - (70 - specIndex * 5) * DAY,
        deletedAt: null,
      },
      {
        id: mintReply(),
        authorId: owner,
        text: "Got it, that fixed the sway too.",
        createdAt: now - (68 - specIndex * 5) * DAY,
        deletedAt: null,
      },
    ],
    // OLD thread (fade-out material).
    createdAt: now - (75 - specIndex * 5) * DAY,
    deletedAt: null,
  });

  // A FIGURE anchor: a whole-figure lesson note authored by a co-member (coach),
  // RECENT (active).
  out.push({
    id: mintAnn(),
    authorId: coach,
    kind: "lesson",
    text: `Whole-figure note on the ${second.name}: keep the heel turn quiet.`,
    tags: ["lesson"],
    anchors: [{ type: "figure", figureRef: second.id }],
    replies: [
      {
        id: mintReply(),
        authorId: partner,
        text: "Will drill this before Saturday.",
        createdAt: now - (4 - (specIndex % 3)) * DAY,
        deletedAt: null,
      },
    ],
    createdAt: now - (6 - (specIndex % 3)) * DAY,
    deletedAt: null,
  });

  // A FIGURETYPE anchor at ROUTINE scope: a timed family-ish note pinned to one
  // count of the family within this dance (concrete danceScope required for a
  // counted figureType anchor). Practice entry (Journal material), mid-age.
  out.push({
    id: mintAnn(),
    authorId: owner,
    kind: "practice",
    text: `Practice ${dance}: ran the ${first.name} entry ten times, cleaner each pass.`,
    tags: ["practice"],
    anchors: [
      {
        type: "figureType",
        figureType: first.figureType,
        danceScope: dance,
        count: 1,
        role: "leader",
      },
    ],
    replies: [],
    createdAt: now - (30 - specIndex * 3) * DAY,
    deletedAt: null,
  });

  // ── EXTENSION POINT (WEP-only annotation types) ────────────────────────────
  // Once attribute-predicate anchors (docs/ideas/attribute-predicate-anchors.md),
  // media embeds (docs/ideas/annotation-media-embeds.md), voice-origin notes and
  // coupling maps merge to main, author their demo material HERE via a parallel
  // `authorExtendedAnnotations(...)` push. Do NOT author them today — their anchor
  // shapes don't exist in main's `Anchor` union yet and would fail strict-write
  // validation at materialization.

  return out;
}

/** Synthetic demo prose for a per-dance family note (never a technique claim from
 *  an unverified source — it's clearly demo copy). */
function familyNoteText(dance: DanceId, figureType: string): string {
  const nice = figureType.replace(/-/g, " ");
  return `Family note (${dance}): my go-to entry into the ${nice} — commit the standing leg early.`;
}
