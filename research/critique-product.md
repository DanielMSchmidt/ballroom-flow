# Product & Collaboration Critique — Weave Steps

Adversarial review of `docs/superpowers/specs/2026-06-24-weave-steps-design.md` from a collaboration-model and product/UX angle. Cross-referenced against `research/design-spec.md` (original microcopy).

---

## 1. Ranked Product / Collaboration Risks

### [BLOCKER] P1 — The "owner-only edit, fork-to-change" model fights the actual unit of the product: the couple

The spec treats a routine as a single-author artifact owned by one person, with everyone else reduced to commenters who must **fork** to change anything. But the product's own §1.2 says the unit is **"a couple… building and practising a routine together."** These two statements are in direct conflict, and the spec resolves it in favor of the architecture (single-writer CRDT zone, §5.3) rather than the humans.

Walk the canonical scenario the team lead asked about:

1. Anna (coach) tells the follower in a lesson: "Your step 4 is a heel turn, not a toe turn." The follower opens the app. She **cannot change the step** — she can only comment. The tag stays wrong.
2. The leader (owner) is the only one who can fix it. So every correction the follower or coach notices becomes a to-do item routed through one person's device. The follower is a second-class citizen in her own routine — and she does *half the dancing*.
3. If the follower forks to "edit her own copy," there are now **two Gold Waltzes**. The leader keeps editing the original; she edits the fork. There is no merge-back (explicitly cut, §10, Q-S0). Within a week the couple has divergent copies and no source of truth. This is the worst possible outcome for a 2-person tool.

The spec acknowledges the tension (§5.3, "THE CENTRAL TENSION") and even admits the CRDT is "overkill for a single writer," but then keeps the single-writer rule anyway and labels the fork as "the editing mechanism." **The fork is being asked to do a job it cannot do** (let two collaborators co-develop one routine) and the spec papers over it with provenance display ("forked from Gold Waltz").

The microcopy that spawned this — *"To change steps, anyone can duplicate the choreo and edit their own copy"* — reads in the original prototype like a **graceful-degradation fallback for non-members / read-only viewers**, not the primary workflow for the couple who owns the routine. The spec has elevated a v0 prototype stub into a load-bearing product principle. That is the single biggest product error in the document.

**What a real couple wants:** one shared routine that **both partners can edit**, with the coach as a commenter (or a time-boxed editor during a lesson). Fork is for "I want to try a variation" / "save before nationals" / a stranger remixing a public routine — a branching feature, not the daily edit path.

### [BLOCKER] P2 — Fork creates divergence with no reconciliation story, and the spec cut the only thing that would save it

§5.4 + §10 cut merge-back, diff, and three-way merge — but fork *is* the editing mechanism (§4.6). So the spec ships a workflow whose normal use **guarantees** unmergeable divergent copies, and then declares the fix out of scope. You cannot ship "fork to edit" without *some* reconciliation, even a crude one (e.g. "this fork is now the canonical copy; archive the origin" or "copy these tags back manually"). As specified, the model is a divergence generator. Either restore co-editing (P1) or you must restore at least a primitive merge/promote path.

### [MAJOR] P3 — Onboarding / invite is the cold-start path and it's still mostly a stub

§4.0 promotes invite to "v1 — invite by link (signed token → Membership)" and §5.5 sketches token redemption. But the **stranger-to-collaborator** path is underspecified and has real holes:

- **Who picks the invitee's role?** §5.5 says "role chosen by the owner." But the wireframe Profile has a `defaultRole`. If the owner invites "as partner" but the invitee is actually a coach, who corrects it? No role-edit UI in v1 (§4.6 defers it). So a mis-set role is permanent until removal/re-invite.
- **First-run for the *invitee*.** The invitee clicks a link, hits Clerk sign-in (new account), then… lands where? The spec's onboarding (§4.0: "pick displayName, role, identity color") and the invite redemption aren't sequenced. Does identity-color selection happen before or after they see the shared routine? Color collision (P5) is most likely *exactly here* — a new member picking a color already used.
- **No invite management depth.** "Show pending invites" is listed but there's no expiry-resend, no "revoke a link," no indication of what an expired link shows the clicker. For a 3-person tool this is fine to keep minimal, but the *failure copy* ("this invite expired / was revoked") is unspecified and is the first thing a real invitee may hit.

### [MAJOR] P4 — Discoverability / cold-start: a new owner lands in an empty Assemble-edit with no scaffolding

The original prototype always seeds 3 choreos and a populated "Gold Waltz" (design-spec line 33, 183) — so the prototype **never shows a true first-run**. The spec adds empty states (good) but stops there. A brand-new user who creates their first Waltz lands in Assemble-edit with zero sides, zero figures, facing a Ri/Bo/Fw/Sw/Tn vocabulary they may not know. The "aha" of this app — *a fully-tagged routine you and your partner reason about together* — is **never demonstrated** to a new user.

There is no sample/demo routine, no template, no "start from a common Gold Waltz skeleton." Given the authoring burden (every step, every count, every tag, by hand, on a phone), the empty-state cliff is steep. **This most threatens adoption** alongside P1: the tool is only valuable once a routine is fully entered, and nothing helps the user cross that initial entry chasm. A read-only **sample routine** shipped in the bundle (it's already static seed data!) would let a user "get it" in 10 seconds and is nearly free.

### [MAJOR] P5 — Mobile-first authoring of counts/actions/tags is the real daily workflow and the interaction model is unproven

The core loop (§1.4) is "tag each step's technique slots" — and the spec *adds* count/action editing (§4.4, correctly identified as a wireframe gap). But this is now a lot of fiddly text + 5 single-selects **per step**, on a phone, often right after a lesson when hands are tired and memory is fading. Concerns:

- **Volume.** A Waltz figure is ~3–6 steps; a routine is ~15–30 figures. That's 100+ steps × (count + action text + up to 5 tag taps). Entering a full routine on a phone is a slog. The spec never estimates this or designs a fast-entry path (bulk tag, copy-tags-from-previous-step, "same as leader" mirroring, voice entry deferred to v1.1).
- **Lanes view was cut (§4.3, §10).** Lanes is the one layout that shows *one technique dimension across all steps at once* — which is exactly how a coach reasons ("show me all your sways") and how you'd batch-tag efficiently. Cutting it removes the only fast cross-step tagging affordance and the most coach-friendly read view. This is defensible as YAGNI for build cost, but it's cut precisely where mobile data-entry pain is highest. Reconsider lanes as the **fast-tagging** surface, not a third decoration.
- **In-lesson reality.** A coach talks fast. Realistically the dancer captures a **voice memo or a quick text note**, not structured tags, during/just-after a lesson. Media is deferred to v1.1 (§6) — meaning the v1 capture path for the highest-value moment (the lesson) is *typing prose into a journal entry*. That may be the actual product, and structured tagging is the slow weekend activity. The spec should validate which of these is the real core loop before optimizing the tagging UI.

### [MAJOR] P6 — Are slot tags "structure" (owner-only) or "annotation" (shared)? The spec's answer maximizes friction

§5.3 / Q-C1 puts technique tags in the **owner-only** zone, so a coach who sees a wrong tag must *comment* "more sway L on 2" and wait for the owner to apply it. This is the P1 problem in miniature and it's the most common interaction in the app. Tags are precisely the thing a **coach** is most expert about and most wants to set directly. Forcing coach corrections through comment→owner-applies is high-friction busywork. Tags should very likely be in the **shared/multi-writer** zone (the CRDT handles last-writer-wins per cell cleanly — the spec even says so). The spec's own recommendation here optimizes for invariant-cleanliness over the coach's actual job.

### [MINOR] P7 — Identity color across choreos: coherent for 2, fragile at 3+ and for shared coaches

Per-user global color (§2.1) is elegant for a couple. Edge cases the spec under-handles:

- **Coach shared across many couples' routines.** Anna coaches 6 couples. Her one global color (#b89400 amber) competes with 6 different leader/follower palettes. In couple A she's distinct; in couple B a partner already uses amber. Q-A2 only "warns on collision *within a routine*" — but Anna can't recolor per-routine (color is global), so the warning has no resolution path for the *new* member. Either color must be per-membership (contradicting the global-color microcopy) or collisions are simply tolerated with initials as the disambiguator (then color is decorative, not identifying).
- **3+ people** (couple + 2 coaches, or a coach + a guest pro) makes the 6-swatch palette + global-uniqueness assumption strain. Fine to accept for v1, but say so explicitly and lean on **initials/labels as the real identity signal**, color as secondary (which §8 accessibility already implies).

### [MINOR] P8 — Journal polymorphic Link is over-engineered for v1 and the v1 cut may cripple it

The polymorphic Link (`step | figure | attribute` × `routine | dance | global` scope) is a 9-cell matrix in the model (§2.1) of which **one cell** ships. Modeling all 9 "for additivity" is speculative generality the spec elsewhere preaches against (YAGNI). More importantly, **step-only linking may make the journal nearly useless**: the high-value journal note is *"my frame collapses on every Natural Turn"* — a **figure-wide** insight — or *"all my left sways are too big"* — an **attribute-wide** insight. Those are exactly the cuts (§10). A journal where you can only pin a note to one specific step instance is a weak version of the feature; the genuinely useful anchors are the deferred ones. Either the journal's v1 value is lower than the spec implies, or "by figure" linking should be pulled into v1.

### [MINOR] P9 — Export exists, import doesn't — and fork+no-merge makes import the missing safety valve

§8 ships JSON export, defers import. Combined with the fork-divergence problem (P2), there's no way to *bring a copy back*. A printable/human-readable chart export (Q-SC3) is also probably higher value to dancers than JSON (dancers print step charts). Minor, but the chosen export format optimizes for developers, not dancers.

---

## 2. Spec Decisions I'd Change

1. **Flip the collaboration model to shared editing for the couple (P1).** Make both `partner` and `owner` `edit`-capable on structure and tags by default; keep the coach as `view+note` (or grant a per-lesson edit window). Recast **fork** as an explicit "save a variation / branch" action, not the primary edit path. This is *cheaper* to build than it sounds — the CRDT/DO already supports multi-writer merge; you'd be *removing* the per-zone auth gate complexity (§5.3) for the structure zone, not adding it. The spec's own architecture (TinyBase MergeableStore, §6) was chosen for co-editing; let it do its job. (Directly resolves Q-S0, Q-C1, Q-C4 in one move.)

2. **Move technique tags into the shared/multi-writer zone (P6, Q-C1).** Even if structure stays owner-gated, tags are the coach's domain — make them shared. LWW-per-cell is already the plan.

3. **If fork must remain the edit path, add a minimal reconcile/promote (P2).** At least: "Make this fork the canonical routine" (archives origin, repoints memberships) so the couple can recover a single source of truth without manual re-entry.

4. **Ship a read-only sample routine in the bundle and offer "start from template" (P4).** The seed "Gold Waltz" already exists as static data. Surface it as a demo so new users see a fully-tagged routine immediately, and offer it (and per-dance skeletons) as a creation starting point.

5. **Reconsider Lanes view as the fast-tagging / coach-read surface (P5), or commit to a fast-entry pattern** (copy-tags-from-previous-step, batch-apply). The mobile authoring volume needs *one* concrete speed affordance in v1.

6. **Decide the lesson-capture core loop before polishing tags (P5).** If the real v1 value is "capture what the coach said," then a quick text (and v1.1 voice) journal note linked to a figure is the hero flow — and structured tagging is secondary. Validate with a dancer before building the tag editor as the centerpiece.

7. **Sequence the invitee onboarding explicitly (P3),** including role assignment, color-pick timing + collision handling, and failure copy for expired/revoked links.

8. **Cut 8 of the 9 Link variants from the *model*, not just the UI (P8)** — model only `{type:"step", scope:"routine"}` and `{type:"figure", scope:"routine"}`, and pull **figure-wide linking into v1** so the journal is actually useful. Drop the dance/global scope speculation entirely until proven.

9. **State that initials/labels are the primary identity signal and color is secondary (P7),** resolving the coach-collision edge case without per-routine color.

---

## 3. New / Sharper User-Facing Open Questions (missed by §11)

The spec's §11 has 34 questions but frames the collaboration model as essentially settled (two-zone, fork-to-edit) and only asks for *confirmation*. These reframe the actual product bets:

- **★ Q-NEW-1 — Should both partners be able to edit one shared routine, or is one partner the sole author?**
  *Why:* This is THE product question and §11 buries it as Q-S0/Q-C4 ("confirm the two-zone model"), assuming fork-to-edit is correct. It is the difference between a couple's shared tool and a single-author tool with read-only partners. Drives the entire permission model, the value of fork, and whether divergence is even a risk.
  *Options:* (a) **Both partners edit one routine** [recommend]; coach comments. (b) Owner-only structure, partner edits *tags* only. (c) Owner-only everything, fork to change [current spec].

- **★ Q-NEW-2 — When a couple genuinely diverges (two ideas for a figure), what do they do?**
  *Why:* The spec's only answer is "fork, no merge." A real couple needs to either (i) discuss-then-one-edits, (ii) try both and pick, or (iii) branch-and-merge. The answer determines whether fork needs reconciliation (P2) at all.
  *Options:* (a) Shared edit + comment to negotiate (no fork needed). (b) Fork + manual "promote to canonical." (c) Full branch/merge [out of scope, too heavy].

- **Q-NEW-3 — What is the *capture* path during/right after a lesson?**
  *Why:* The most valuable, time-sensitive moment in the product. If structured tagging is too slow for the lesson context (P5), the real v1 hero is a quick note, and the tag editor is a calm-weekend tool.
  *Options:* (a) Quick text journal note linked to a figure (v1), voice in v1.1. (b) Structured per-step tagging is the capture path [current spec assumes this].

- **Q-NEW-4 — Should there be a demo/sample routine and creation templates?**
  *Why:* Cold-start (P4) is the adoption cliff; the seed data already exists.
  *Options:* (a) Read-only sample + "start from template" [recommend]. (b) Empty state only [current].

- **Q-NEW-5 — Can the coach edit tags directly (at least during a lesson), or only comment?**
  *Why:* The coach is the tag expert; comment→owner-applies is the app's most frequent friction (P6).
  *Options:* (a) Coach edits tags [recommend]. (b) Coach gets a time-boxed edit window. (c) Comment only [current].

- **Q-NEW-6 — Is the journal useful with step-only links, or does it need figure-wide linking in v1?**
  *Why:* The high-value journal insights are figure-/attribute-wide (P8); the v1 cut may gut the feature.
  *Options:* (a) Add figure-wide link to v1 [recommend]. (b) Step-only, accept reduced value [current].

- **Q-NEW-7 — How does identity color behave for a coach shared across many couples (collision with no per-routine override)?**
  *Why:* Global color + within-routine-uniqueness warning have no resolution for a colliding *new* member who can't recolor per routine (P7). §11 Q-A2 misses the global-vs-per-routine contradiction.
  *Options:* (a) Color is decorative; initials identify [recommend]. (b) Per-membership color (drops the global-color microcopy). (c) Tolerate collisions silently.

- **Q-NEW-8 — What does an invitee see on an expired/revoked/already-redeemed link, and when do they pick their color?**
  *Why:* First touch for every new collaborator; entirely unspecified (P3).

---

## Bottom line

The spec is technically excellent and the architecture is sound — but it has **optimized the collaboration model around the architecture's single-writer convenience instead of around how a dancing couple actually works.** A leader and follower co-own a routine; making one of them read-only and telling the other to "fork to change" will produce divergent copies and frustration, and it makes the coach (the tag expert) a second-class commenter. Combined with a steep empty-state cliff and a heavy mobile data-entry burden with no fast path, the realistic outcome is **a beautiful notation tool that one person sets up and nobody maintains.** The single thing most threatening adoption: the cost of getting a routine fully entered and kept current exceeds the value, *because the people who'd share that cost (partner, coach) can't directly edit.* Fix the collaboration model first; everything else is secondary.
