# QA probe library

Learned regression heuristics for the `qa-explorer` agent. Every probe here was either paid
for by a real escaped bug or seeded from this repo's incident history
(`ballroom-flow-failure-archaeology`). **Every applicable probe is mandatory on every QA
run.**

Maintenance contract:

- **`/qa-retro` appends** a probe whenever a fixed bug reveals a class the explorer would
  have missed. Probes are **generalized to the class**, never the single instance
  ("every signed-out entry point × every viewport", not "the invite link on Safari").
- Keep it curated: merge duplicates into the broader probe; a probe stays even after a
  permanent Playwright test covers its instance (the probe hunts *siblings*, the test pins
  the instance).
- Format per probe: **what to do → what must hold**, plus provenance.

---

## Seed probes (2026-07-15, from incident history)

### P-01 — Role revocation must bite a live socket
Two contexts: owner + editor co-editing the same routine. Owner demotes/removes the editor
**while the editor's session stays open**. → The demoted client's further edits must not
apply (and the UI must degrade honestly), *without* requiring a reconnect.
*Provenance: 99fa1b9 — role was frozen in the hibernation attachment at handshake.*

### P-02 — Roles are enforced by effect, not by affordance
For each of viewer/commenter/editor on a shared doc: don't just check which buttons are
hidden — attempt the effect anyway (keyboard shortcuts, deep-link to edit surfaces, direct
`fetch` to the REST routes with that user's minted JWT). → Server must refuse; state must
not change for other members.
*Provenance: eb04a33 (mislabelled frames), 089dbc0 (REST upsert self-escalation).*

### P-03 — The owner is a member too
Every surface that lists people (members, authors, presence, journal authorship): does the
**owner** appear correctly? Owners have no membership row and are elevated implicitly.
*Provenance: 92ace53 — author sets built from listMembers silently excluded the owner.*

### P-04 — Create, then reload immediately
After creating anything (routine, section, placement, figure, annotation, journal entry):
reload within ~1s. → It is still there. Then reload again after the sync settles.
*Provenance: PR #58 — client-side initial seed lost on reload.*

### P-05 — Watch the first paint of a loaded doc
Opening an already-populated doc: watch for a flash of empty/stale content, a "live"
indicator flipping before catch-up completes, or edits made during hydration being dropped.
*Provenance: PR #57 — "live" flipped on socket open before catch-up.*

### P-06 — Move under concurrency
User A reorders a placement while user B concurrently edits that same placement's content.
→ Both survive: new position AND B's edit. Repeat for section reorder.
*Provenance: PR #107 — splice-reorder lost concurrent edits on the moved item.*

### P-07 — Undo is per-person
A edits, B edits, A hits undo. → Only A's change reverts; B's work is untouched — on both
screens. Try across surfaces (choreo edit vs figure edit vs annotation).
*Provenance: undo soundness critical 3725ec9; per-person undo is a documented promise.*

### P-08 — Signed-out entry points, on mobile
Every URL a stranger can plausibly receive (`/invite/:token`, shared routine/figure links,
deep links into read views): open it in a signed-out context on the mobile profile, complete
sign-in, and confirm you land where the link pointed with the promised role.
*Provenance: class risk around invite redemption; sign-in return-to is easy to regress.*

### P-09 — Quota edges, through the UI
Free tier allows 3 owned routines. Create 3, then attempt the 4th every way the UI offers
(new, fork, template). → Blocked with an honest message, not a silent failure or a
half-created ghost. Check the fork path especially.
*Provenance: quota is enforced at the boundary; fork is the sneaky creation path.*

### P-10 — Dance gates in the attribute editor
Attribute kinds are data with dance gates — e.g. **Tango omits `rise`**. In the editor and
read views for a Tango figure, `rise` must not be offered or rendered; other dances keep it.
Check cardinality limits by trying to add one-too-many of a kind at the same count.
*Provenance: documented registry rule (CLAUDE.md §3); easy to regress in new surfaces.*

### P-11 — Live figures announce themselves
Edit a figure that is placed in ≥2 choreos. → Before/while editing, the "used in N choreos"
visibility is present; the edit propagates to the other choreo (second context); editing a
**catalog** figure spawns a variant owning only the touched beats, and an untouched beat
still receives later catalog changes.
*Provenance: the v5 model's core promise (docs/concepts/figures.md § Variants).*

### P-12 — Offline promise, literally
With a doc already open: go offline (context.setOffline(true)), keep editing, reload nothing,
come back online. → Edits replay and both clients converge. Then the harder variant: edit
offline, reload the tab while still offline (documented: already-opened docs are editable
offline — what does a reload do?).
*Provenance: docs/concepts/collaboration.md offline promise; replay is the risky half.*
