# Prototype Additions — gap analysis vs PLAN.md v4.4

**Status:** Designer gap analysis, 2026-06-25. Parity pass + coherence audit, 2026-06-26 (pen ↔ prototype: filled the gaps the rebuild missed — see the note below).
**Inputs:** `docs/PLAN.md` (v4.4), `docs/design/Ballroom Builder.dc.html` (the original wireframe sketch), the live editable prototype at `https://claude.ai/design/p/fa3d687e-0bb6-4e9c-9eff-a10c08c081c1`.

> **Canonical design artifact: `docs/design/ballroom-flow.pen`** (Pencil). All original prototype screens have been rebuilt there with the plan's v1 model folded in. The `.pen` file is now the canonical design surface (open it in Pencil); this markdown is the rationale/traceability record behind it. Screens built: Figure Library, Choreo List, Assemble (**both the reading/timeline view and the edit view**, toggled by the pencil — the reading view lays the routine out as a timeline, each figure's steps showing all five attribute slots, with inline comments on annotated steps), Figure Timeline, Tag Editor (**renders all five attribute kinds** — rise/body/foot/sway/turn — plus an *add-a-kind* affordance), Journal, Thread, Entry Editor, Share, Profile (with the *Preview · your notes* card + per-member colour footer); overlays: Anchor Picker (point/figure/figureType + dance-scope), **New Choreography sheet** (dance picker + name), **Attribute Info sheet** (per-kind values + definitions, "Tango omits rise" note), **Add-figure / fork sheet** (filter + library rows with scope badges + create-your-own, copy-on-write microcopy), Add-a-kind sheet, Toasts ("Copied as your variant" / "Undone + superseded" / quota upsell); reusable components: ScopeBadge (library/variant/custom), TabBar (4 tabs). Design tokens match the original visual language (accent, inks, 5 attribute-kind colors, 3 scope colors, Inconsolata + Caveat).
>
> **Parity pass (2026-06-26).** A pen-vs-prototype audit found the rebuild had dropped several things the prototype does, now restored: (1) the **Assemble reading/timeline view** (only the edit view had been carried over); (2) the **Tag Editor's full five-kind set** (only Rise & Turn were present — Body/Footwork/Sway were missing, contradicting DESIGN-PRINCIPLES #24); (3) three prototype overlays absent from the pen — **New Choreography**, **Attribute Info**, and the **Add-figure / fork** sheet; (4) the **Profile** screen's notes-preview card + colour footer (the screen had an empty gap). The pen's exports (`docs/design/exports/`) were regenerated to match.

## How to read this

The wireframe (`Ballroom Builder.dc.html`) is a **pre-redesign sketch**. It predates the v4 fork/inheritance decision (PLAN §0 "What's new in v4") and several v1 centerpieces. This document is a **screen-by-screen list of what the prototype must add or change** to reflect the plan, each tied to a PLAN.md section, with a rationale and a status:

- **PUSHED** — requested into the live prototype this session.
- **TODO** — documented here; not yet in the prototype (left for the frontend build, which uses PLAN.md + this doc as the source of truth — the live prototype is a sketch, not a requirement, per PLAN §14).

The prototype's job is to keep the **visual language** legible (handwritten Caveat notes, Inconsolata mono, studio-paper bg, the five attribute colors). The frontend agent builds against PLAN.md + `DESIGN-PRINCIPLES.md`; the prototype is a reference sketch, so an item being TODO in the prototype does **not** mean it is out of scope — every item below is in v1 per the plan.

---

## Conflicts to resolve first (the wireframe contradicts the plan)

These are not additions — they are **corrections** where the sketch shows a superseded model.

| # | Wireframe shows | Plan requires | PLAN ref | Status |
|---|---|---|---|---|
| C1 | **"Sides"** with a **Long / Short / Corner** picker (`onAddLong/Short/Corner`) | **User-named sections** (free text + optional preset quick-fills); **no** long/short/corner enum; alignment is per-figure | §2.3, §4.3, D18 | PUSHED |
| C2 | **"custom"** is the only figure scope shown (amber dot/pill); a binary library-vs-custom | **Three scopes**: global library (app-owned) / account **variant** (carries base lineage) / account **custom**; "custom" alone is insufficient | §2.2, §5.2, D28 | PUSHED (variant + lineage) |
| C3 | Share screen says *"anyone can duplicate the choreo and edit their own copy"* and offers **"Duplicate to edit my version"** | This is the **choreo fork** ("make it your own", frozen clone with provenance) — name it Fork and show lineage; also surface **per-document roles** (viewer/commenter/editor) which the wireframe lacks | §5.1, §5.2, D11, D12 | PUSHED (fork naming/provenance); roles TODO |
| C4 | Link picker offers **"An attribute"** anchor (*"all CBMPs, all left turns"*) — a **predicate** anchor | Predicate/query anchors are **v1.1, out of scope**. The v1 third anchor is **`figureType` family** (this-dance / all-dances), which is identity-based, not a predicate | §2.6, §4.6, D20/D29, §11 | TODO (replace attribute-predicate with figureType family + dance-scope) |
| C5 | Profile shows a static role ("leader · shares 2 choreos") | Role is a **per-device view toggle**, not a user attribute; Profile shows **plan status + owned-routine count**, not a stored role | §1.5, §4.8, D19 | TODO |
| C6 | Tag editor exposes a **fixed 5 kinds** (rise/body/foot/sway/turn) | Kinds come from the **merged ATTRIBUTE_REGISTRY** (standard + user-defined); **Tango omits rise**; needs an **"add a kind"** affordance | §3, §4.5, D22 | TODO |

> Note: the live prototype's chat history already contains a scope-toggle experiment on the link picker ("This choreo only / All Waltz choreos / Every dance" and an "all Whisks · all Waltz" chip). That is closer to the plan's figureType-family dance-scope than the static HTML's "attribute" card — but it is framed as a predicate-style "an attribute" path. C4 is about making the **third anchor be the figureType family** specifically (identity-based), with the dance-scope toggle, and removing the predicate framing.

---

## Additions by screen

### A. Figure Library (new top-level screen) — PLAN §4.2, §2.2, D28, D30

The single biggest gap: the plan's v1 centerpiece **does not exist** in the wireframe (only an inline add-figure *sheet* exists).

- **A1. New "Library" destination** (4th tab or a route off Profile/Choreo). *Rationale: §4.2 makes the library a first-class browse surface, not just an add-picker.* — **PUSHED** (requested as a 4th "Library" tab).
- **A2. Global library, grouped by `figureType` family, filterable by dance.** Show a family header (e.g. *Feather*, *Natural Turn*) with the per-dance definitions under it. *Rationale: §2.2 cross-dance identity; §4.2 "grouped by figureType, filterable by dance".* — **PUSHED**.
- **A3. "Your variants & custom" section** with a **variant badge showing base lineage** ("based on <base name>") and **"used in N routines"**. *Rationale: §4.2 verbatim; §2.2 variant fields.* — **PUSHED**.
- **A4. Create / fork / edit affordances** on library and variant cards. Editing a global figure is **auto-variant**; editing your own flows to all referencing routines. *Rationale: §4.2, §5.2.* — **PUSHED** (fork/edit affordance); auto-variant toast covered in E1.
- **A5. Open the cross-dance note surface from a family** ("annotate this dance / all dances"). *Rationale: §4.2 last sentence, §4.6.* — **TODO**.

### B. Assemble (Choreo) — PLAN §4.3, §2.3

- **B1. Sections, user-named** (replace Long/Short/Corner). See C1. — **PUSHED**.
- **B2. Placement cards show variant/custom badge + alignment chips + attribute summary.** *Rationale: §4.3.* — partial in wireframe (custom dot only); **PUSHED** (scope badge); alignment chips **TODO**.
- **B3. Edit affordances gated by membership role** (viewer can't edit; commenter can annotate only). *Rationale: §4.3, §5.1.* — **TODO**.
- **B4. Add/fork figure** from the placement add-sheet (the sheet exists; needs the fork-into-variant path). *Rationale: §4.3, §4.4.* — **TODO**.
- **B5. Role view toggle** (leader/follower) in the routine. *Rationale: §1.5, §4.3.* — **TODO**.

### C. Figure Timeline (hero) — PLAN §4.4, §4.5

- **C1t. "Fork into a variant" affordance** on the timeline; editing a shared figure triggers copy-on-write. *Rationale: §4.4.* — **TODO**.
- **C2t. Attribute editor sections render from the merged registry**, not a hardcoded 5; **Tango hides rise**; single vs multi cardinality from the registry. *Rationale: §4.5, §3, D22.* — **TODO** (see C6).
- **C3t. "Add a kind" affordance** in the attribute editor. *Rationale: §4.5, D22.* — **TODO**.
- **C4t. Lanes view** exists in the wireframe ✓ — keep; ensure it renders user-defined kinds too. — exists.
- **C5t. Section rename + alignment editing** on the figure. *Rationale: §4.4, §3.8.* — **TODO**.

### D. Annotation (timeline + journal as one concept) — PLAN §4.6, §2.6, D29

- **D1. Three anchor types: point / figure / `figureType` family** with a **dance-scope toggle (this dance | all dances)**. Replace the predicate "an attribute" card. *Rationale: §4.6, §2.6, D29; predicate anchors are v1.1 (§11).* — **TODO** (see C4).
- **D2. `figureType` notes surface on every matching figure across routines**, and (option 2) are **visible to co-members** of a shared routine where the figure appears. *Rationale: §2.6, §5.1, D29.* — **TODO**.
- **D3. Filters: all / lessons / practice / by-figure** — exist in the journal wireframe ✓. — exists.
- **D4. Reply thread, author-only reply delete** — thread exists ✓. — exists.
- **D5. Unify "timeline comment" and "journal entry"** as one Annotation concept (anchors decide where it surfaces). *Rationale: §2.6, §4.6.* — partially modeled (threads + journal are separate state in the sketch); **TODO** to present them as one.

### E. Fork / variant / copy-on-write feedback — PLAN §5.2, §4.9

- **E1. Toast "Copied as your variant"** on copy-on-write (editing a non-owned figure). *Rationale: §4.9, §5.2 (Q-COW-TRIGGER).* — **PUSHED**.
- **E2. Choreo "Fork — make it your own"** action (choreo card + Share); creates a **frozen** clone; header shows **"forked from <origin> · independent copy"** provenance. *Rationale: §4.1, §4.7, §5.2 (Q-FORK-UX).* — **PUSHED**.
- **E3. Figure auto-update microcopy** — editing your own shared figure flows to all referencing routines; the Share screen explains editing a shared figure affects every routine using it (else fork/variant). *Rationale: §4.7, §2.2.* — **PUSHED** (kept existing microcopy intent); explicit "affects every routine" wording **TODO** to confirm.

### F. Quota & plans — PLAN §1.6, §4.1, §4.8, §4.9, D21

- **F1. New-choreo creation is quota-checked**; 4th owned routine → **upsell toast**. *Rationale: §4.1, §4.9, D21 (free cap = 3 owned).* — **TODO**.
- **F2. Profile shows plan status + owned-routine count** (replace static "leader · shares 2 choreos"). *Rationale: §4.8, C5.* — **TODO**.

### G. Share / invite / roles — PLAN §4.7, §5.1, §5.5

- **G1. Per-document member list with roles** (viewer / commenter / editor / owner) and a **role control**. *Rationale: §4.7, §5.1, D11.* — **TODO** (wireframe shows names + access labels but no role model).
- **G2. Invite by link** (signed token → membership with chosen role). *Rationale: §4.7, §5.5.* — **TODO** (wireframe has "+ invite someone" stub).
- **G3. Remove member** (editor/owner). *Rationale: §4.7.* — **TODO**.
- **G4. Microcopy: editing a shared figure affects every routine using it** (else fork/variant). *Rationale: §4.7.* — **PUSHED** (intent kept).

### H. Custom attribute kinds — PLAN §4.5, §4.9, D22

- **H1. "Add a kind" sheet** (name, color, cardinality single/multi, value list). *Rationale: §4.5, §4.9, D22.* — **TODO**.

### I. Profile — PLAN §4.8

- **I1. Plan status + owned-routine count** (see F2). — **TODO**.
- **I2. Note-color picker** — exists ✓. **Editable display name** — wireframe is read-only-ish; **TODO** to confirm an edit affordance.
- **I3. Remove stored "role"** (per §1.5). — **TODO**.

### J. Data ownership — PLAN §7, §4.0

- **J1. ~~JSON export AND import~~ — RETIRED.** A self-contained owned copy is delivered by **forking** (clone + copy-on-write of a routine with its referenced figures); no separate JSON export/import screen is needed.

### K. Sample / template & empty states — PLAN §4.0, §4.1

- **K1. Read-only sample routine + start-from-template** entry from the empty Choreo list. *Rationale: §4.0, §4.1 "Empty → sample + template".* — **TODO** (wireframe has no empty state).

### L. Online-first / offline state — PLAN §1.6 note, §7

- **L1. "You're offline" state for data** (shell loads; data needs the DO). *Rationale: §7 connectivity, §1.6 offline note.* — **TODO**.

---

## Summary: PUSHED vs TODO

**Pushed into the live prototype this session (one comprehensive request):**
- New **Library** tab: global library grouped by figureType family, filterable by dance; "Your variants & custom" with base-lineage line + "used in N routines"; fork/edit affordances (A1–A4).
- **Scope badge** on figure cards: global / variant (with lineage) / custom (C2, B2).
- **"Copied as your variant"** copy-on-write toast (E1).
- **User-named sections** replacing the Long/Short/Corner enum (C1, B1).
- **Choreo fork** ("make it your own", frozen clone) with **"forked from <origin> · independent copy"** provenance line; share microcopy intent kept (C3, E2, E3, G4).

**Documented-only (TODO — build against PLAN.md + this doc):**
- Cross-dance `figureType` annotation anchor + dance-scope toggle, replacing the predicate "attribute" anchor; co-member family-note visibility (A5, D1, D2, C4).
- Registry-driven attribute editor (Tango omits rise; single/multi from registry) + "add a kind" sheet (C2t, C3t, C6, H1).
- Per-document roles, invite-by-link, remove-member, role-gated edit affordances (G1–G3, B3).
- Quota check + upsell toast; Profile plan status + owned count; remove stored role (F1, F2, I1, I3, C5).
- Role view toggle; alignment chips/editing; section rename on figure (B5, B2, C5t).
- Unify timeline-comment + journal as one Annotation concept (D5).
- Sample/template + empty states (K1); offline-state (L1). _(J1 JSON export/import retired — forking supersedes.)_
