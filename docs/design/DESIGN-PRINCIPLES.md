# Ballroom Flow — Design Principles (UI PR review checklist)

**Status:** v1, 2026-06-25. **Source of truth:** `docs/PLAN.md` v4.4.

These are **checkable** principles for reviewing every UI PR. Each is an imperative statement a reviewer can answer **yes / no / N-A** against the diff. If a principle is N-A for a PR, say why. Exact design-token values (colors, spacing, type scale) are owned by the frontend agent; these principles state the rule, not the hex.

A PR that touches user-facing UI should link this file and confirm the applicable principles pass.

---

## Group 1 — Mobile-first & responsive

1. **Mobile-first layout.** The screen is designed for a ~394px-wide phone viewport first; nothing essential requires horizontal scrolling or a wider viewport to use.
2. **Desktop must not look bad.** On a wide viewport the screen is intentionally laid out (centered/maxed column or adapted layout) — not a stretched full-bleed mobile view with giant gaps or full-width text lines.
3. **Touch ergonomics.** Every interactive target (button, chip, tab, icon control, list row affordance) is **≥44×44px** effective hit area, even when the visual glyph is smaller.
4. **Reachability.** Primary actions on a screen are reachable in the lower/thumb zone or via a persistent control; destructive or rare actions are not the easiest thing to hit by accident.

## Group 2 — Accessibility (WCAG AA)

5. **Color is never the only signal.** Any meaning carried by color (attribute kind, scope, role, status, author identity) is **also** carried by text, icon, shape, or label. (E.g. the five attribute colors always pair with their two-letter code / label; the scope of a figure is shown as a *word* not just a dot.)
6. **Contrast meets AA.** Text and meaningful UI elements meet WCAG AA contrast (≥4.5:1 body text, ≥3:1 large text and UI component boundaries) against their background — including the studio-paper and charcoal backdrops.
7. **Keyboard navigable.** Every interactive element is focusable and operable by keyboard in a logical order, with a visible focus indicator; no action is mouse/touch-only.
8. **Screen-reader legible.** Controls have accessible names; icon-only buttons have labels; images/decorative SVGs are hidden from AT; live regions announce toasts and async results.
9. **Reduced motion respected.** Animations (screen-in, sheet-in, pop-in) are gated by `prefers-reduced-motion`; nothing essential depends on motion to be understood.
10. **Text scales.** Layout survives 200% text zoom / large dynamic type without clipping or loss of function.

## Group 3 — The fork / variant / inheritance / copy-on-write mental model is legible

(*This is the v1 centerpiece, PLAN §5.2 — the UI must make an unfamiliar model obvious.*)

11. **Three scopes are visually distinct and consistently treated.** Global library (app-owned), account variant/custom, and routine-scoped placement each have a **consistent, distinct visual treatment** wherever a figure appears (library, assemble, timeline, add-sheet). The same scope never looks like two different things across screens.
12. **Lineage is shown.** A variant figure always shows its **base lineage** ("based on <base name>"), and a forked routine always shows its **provenance** ("forked from <origin>").
13. **Copy-on-write is explained at the moment it happens.** When a user edits a figure they don't own, the UI **tells them a variant was created** ("Copied as your variant") rather than silently diverging or silently failing.
14. **Frozen vs flowing is distinguishable.** The UI does not imply a choreo fork stays in sync with its origin (it is **frozen**), nor that editing your own shared figure leaves other routines untouched (it **flows** to all of them). Where the user could be surprised, microcopy states which behavior applies.
15. **"Affects every routine" is surfaced before a destructive-feeling edit.** Editing a shared figure that flows into multiple routines, and sharing a figure, carry microcopy that editing it affects every routine using it (else fork/variant).

## Group 4 — Feedback, toasts & state

16. **Standard toast conventions.** Confirmations use the toast pattern and include at least these required messages where applicable: **"Copied as your variant"** (copy-on-write), **"Undone"** (undo), and a **quota upsell** toast (4th owned routine). Toasts are announced to AT (see #8) and are dismissible / auto-dismiss without trapping focus.
17. **Undo is discoverable and honest.** A user can undo their **own** last change; the UI offers "Undone" feedback and, at most, a **soft "superseded" hint** if others built on it — never a hard refusal (PLAN §5.4).
18. **Every async/loading action has a state.** Pending, success, and error states are visible; the UI never looks idle while work is in flight (relevant for multi-doc sync, fork, export/import).
19. **Empty states are designed.** Every list/collection (routines, sections, figures, variants, annotations, members) has a purposeful empty state that guides the next action (e.g. empty Choreo list → **sample + start-from-template**), not a blank area.

## Group 5 — Online-first, loading & offline

20. **Online-first is honest.** Because data sync requires the document's DO, the UI shows a clear **"you're offline"** state for data while still loading the installed shell; it does not present stale data as live or hang silently (PLAN §7, §1.6).
21. **Multi-doc load is graceful.** Opening a routine that references several figure docs shows progressive/partial loading rather than blocking the whole screen on the slowest reference.

## Group 6 — Consistency, tokens & domain correctness

22. **Uses the design tokens.** Colors, type, spacing, radius, and the five attribute-kind colors come from the shared token set — no ad-hoc hex/px that duplicates or drifts from a token. (Exact tokens owned by the frontend agent; the rule is: reference, don't reinvent.)
23. **Visual language is consistent.** New surfaces match the established language (mono UI type, handwritten note type for human annotations, studio-paper canvas, icon style) unless the PR is an intentional, documented restyle.
24. **Attribute kinds are registry-driven, not hardcoded.** The attribute editor, lanes, chips, and info sheet render from the **merged ATTRIBUTE_REGISTRY** (standard + user-defined), respect **cardinality** (single vs multi), and honor `appliesToDances` (e.g. **Tango omits rise**) — adding a kind needs no new component (PLAN §3, §4.5).
25. **Role is a view, not an identity.** Leader/follower is presented as a **per-device view toggle**, never as a stored user role; screens don't ask the user to pick a permanent role (PLAN §1.5).
26. **Permissions gate the UI, per document.** Affordances reflect the viewer's **per-document role** — viewers see read-only, commenters can annotate but not edit structure, editors/owners can edit/invite — and disabled/absent affordances are explained, not just missing (PLAN §5.1).
27. **Count notation is correct.** Float counts render with the conventional fraction labels **e=.25, &=.5, a=.75** (and `ia`/`ai` for eighths), interpreted modulo the dance's phrase — never raw decimals in the user-facing timeline (PLAN §2.5, §3, Q-D3).
28. **Destructive actions confirm.** Delete of a routine/section/placement/figure/attribute/annotation uses a confirm step; soft-delete semantics mean nothing presents as a permanent hard delete to the user (PLAN §4.0, §2.1).
