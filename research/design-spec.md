# Ballroom Builder — Design Enumeration

Faithful documentation of the prototype at `docs/design/Ballroom Builder.dc.html`. This is a single-file "dotcomponent" (`.dc`) prototype: a 394×852 phone frame rendering one of several screens at a time, driven by a JS `Component` class whose `renderVals()` returns every `{{ binding }}` used in the template. Screens are mutually-exclusive `<sc-if>` blocks; lists are `<sc-for>`. Theme is configurable via three props: `accent` (color, default `#2f5d8f`), `noteStyle` (`Handwritten`/`Typed`), `backdrop` (`Studio paper`/`Cool gray`/`Charcoal`).

Domain: a tool for ballroom dancers (Standard/Smooth style — Waltz, Viennese Waltz, Quickstep, Foxtrot, Tango) to build a competition/practice **routine** (a "choreo") as an ordered set of **sides** (floor segments) → **figures** → **steps**, and to annotate each step across five technique dimensions (Rise & fall, Body position, Footwork, Sway, Turn). Partners and coaches collaborate via per-step comment **threads** and a **journal** of lessons/practice notes that link back to choreography.

---

## Global structure

- **Status bar** (cosmetic): "9:41", signal/wifi/battery icons.
- **Screen area**: exactly one screen shown, keyed off `tab` (`choreo`/`journal`/`profile`) and, within choreo, `choreoView` (`list`/`assemble`/`figure`/`step`/`thread`/`share`), plus journal's `editingEntryId`.
- **Tab bar** (3 tabs) shown except on step, thread, share (within choreo) and the journal entry editor.
- **Overlays** (absolute, on top of any screen): Add-figure sheet, Info sheet, New-choreo sheet, Link picker, Toast.

The five technique dimensions recur everywhere with fixed colors:
| Key | Header label | Short header | Color |
|---|---|---|---|
| `rise` | RISE & FALL | Ri / RISE | `#1f8a5b` (green) |
| `body` | BODY POSITION | Bo / BODY | `#8a5cab` (purple) |
| `foot` | FOOTWORK | Fw / FOOT | `#a9742c` (brown) |
| `sway` | SWAY | Sw / SWAY | `#c0563f` (red) |
| `turn` | TURN | Tn / TURN | `#5b6b8a` (blue-gray) |

---

## Screens & components

### 1. Choreo List (`scList`) — tab: Choreo, default
- **Purpose**: list all choreographies the user owns/has; entry point to create or open one.
- **Header**: title "My Choreos"; round "+" button (`onNewChoreo` → New Choreo sheet).
- **List** (`choreoList`, `c`): each card has colored icon (color derived from dance: Waltz blue, Quickstep green, Foxtrot purple, Tango red, Viennese blue-gray), `{{ c.title }}`, then `{{ c.dance }} · {{ c.barLabel }} · {{ c.created }}`, chevron. `barLabel` = "N bars" or "no figures yet" when 0. Tapping (`c.onOpen`) opens that choreo in Assemble (reading mode).
- **No empty state** for zero choreos (seed always has 3).

### 2. Assemble (1A) (`scAssemble`) — the routine overview
- **Purpose**: see/edit the whole routine as sides → figures → steps. Two sub-modes: **reading** and **editing** (`assembleEdit` / `assembleView`), shown as subtitle "reading"/"editing".
- **Header**: back (→ list), title `{{ routineTitle }}`, mode subtitle, edit-toggle button (`onToggleAssembleEdit`; dark when editing), share button (`onOpenShare`).
- **Reading view** (`readingGroups`, `grp` per side):
  - Side divider showing `{{ grp.sideName }}` (uppercased).
  - Per figure (`fig`): colored dot (accent for library, brown `#a9742c` for custom), `{{ fig.name }}`, "custom" badge if custom, `{{ fig.countLabel }}` (counts joined, e.g. "1 2 3").
  - Mini column header of tappable dimension abbreviations Ri/Bo/Fw/Sw/Tn — each opens the **Info sheet** for that dimension.
  - Per step (`step`): `{{ step.count }}`, `{{ step.action }}`, then the five slot chips (`s_rise`…`s_turn`, each `.set`/`.unset`/`.label`); unset = small empty circle.
  - Inline **comments preview**: up to 2 latest comments (`latestComments`, colored dot + `{{ c.text }}` truncated to 44 chars), "+{{ moreCount }} more" link and "+ add comment" — both open the thread. If none: just "+ add comment".
- **Editing view** (`sides`, `side`):
  - Collapsible side header (green) with chevron, `{{ side.name }}`, `{{ side.barLabel }}` ("N bar(s)"). `side.onToggle` collapses/expands; collapse state in `state.collapsed`.
  - Expanded: figure cards (`fig`) — dot, `{{ fig.name }}`, custom badge, `{{ fig.countLabel }}`, chevron; tap opens figure timeline. Dashed **"add figure"** button (`side.onAdd` → Add-figure sheet for that side).
  - Dashed **"add side"** button (`onOpenAddSide`); when open, inline panel "WHAT KIND OF SIDE?" with three buttons: **Long / Short / Corner** (`onAddLong`/`onAddShort`/`onAddCorner`). New side auto-named "1st/2nd/… Long Side", "… Short Side", or "Corner"/"Corner N".

### 3. Figure Timeline (1B / 2A) (`scFigure`)
- **Purpose**: view/edit one figure's steps and their five technique slots.
- **Header**: back (→ assemble), `{{ figTitle }}`, `{{ figSideName }}`, **lanes toggle** (`onToggleLanes`), **edit toggle** (`onToggleEdit`). `figMode` ∈ `view`/`edit`/`lanes` (toggles flip back to `view`). Opening a figure from Assemble sets mode from `assembleEdit` (edit if assembling was in edit mode, else view).
- **View mode** (`modeView`): column header "STEP & COUNT" + Ri/Bo/Fw/Sw/Tn. Each step row: `count`, `action`, optional thread badge `{{ threadCount }}` (yellow), the five slot chips, expand chevron. Tapping a row (`step.onToggle`) inline-expands `expandRows` (5 rows: label colored, value or "— not set"). Footer note: "tap a step to read its detail · switch to Edit to tag".
- **Edit list view** (`modeEdit`): same rows but tapping (`step.onOpen`) opens the Step Detail / Tag editor. Footer: "empty dot = nothing logged yet · tap a step to edit its slots".
- **Lanes view** (`modeLanes`): horizontal lanes — left column step (count+action), then one cell per dimension (RISE/BODY/FOOT/SWAY/TURN), filled chip or small dot. Tapping a step (`step.onOpen`) opens Step Detail. Footer: "a lane per level of information · tap any step to tag it".

### 4. Step Detail + Tag Editor (2B / 2C) (`scStep`)
- **Purpose**: set the five technique slots for one step ("Tag · step N"); jump to its thread.
- **Header**: back (`onCloseStep` → figure), title "Tag · step {{ dStep.n }}", "done" (also `onCloseStep`).
- **Step card**: count badge, `{{ dStep.action }}`, `{{ dStep.figName }}`, yellow thread button showing `{{ stepThreadCount }}` (`onOpenThreadFromStep` → thread).
- **Five slot sections** (`dRise`/`dBody`/`dFoot`/`dSway`/`dTurn`, each `.opts` of `opt`): header (colored) + "pick one"; chips toggle selection (`opt.onClick`). Re-tapping selected clears it (`setSlot` toggles to null). Option sets:
  - Rise (5): lowering, body rise, foot rise, continue, up
  - Body (5): CBMP, CBP, Closed, Promenade, Wing
  - Foot (4): HT, T, TH, heel pull
  - Sway (3): to L, to R, none
  - Turn (7): ¼ L, ¼ R, ⅜ L, ⅜ R, ½ L, ½ R, none

### 5. Thread (3B) (`scThread`)
- **Purpose**: per-step comment thread between partners/coach.
- **Header**: back (`onBackFromThread` → returns to `threadReturnView`, either figure or assemble), `{{ tTitle }}` (e.g. "Whisk · step 2"), `{{ tSub }}` (e.g. "action · rise · sway L · turn").
- **People legend**: colored dots for Me, Lena, Anna (`peopleLegend`).
- **Comments** (`comments`, `c`): colored left border by author; head "Name (role) · time", `{{ c.text }}` in note font. Author colors: Me = profile color, Lena `#cf5aa0`, Anna `#b89400` (role "coach").
- **Reply bar**: text input "reply…" (`replyText`/`onReplyChange`), send button (`onAddReply`; appends `{author:'me',time:'just now'}`).

### 6. Share (5C) (`scShare`)
- **Purpose**: see who a choreo is shared with; collaboration model.
- **Header**: back (→ assemble), "Share · {{ routineTitle }}".
- **OWNER** section: avatar (initial), `{{ owner.name }}`, `{{ owner.role }}` ("leader · can edit").
- **SHARED WITH** (`shared`, `m`): "Lena (partner)" — "view + note"; "Anna (coach)" — "view + note".
- **Explanatory card (verbatim)**: "Partners see each other's notes. To change steps, anyone can duplicate the choreo and edit their own copy."
- **Buttons**: "Duplicate to edit my version" (`onDuplicate` → toast "Copied — edit your own version"); "+ invite someone" (`onAddNote` → toast "Invite link copied").

### 7. Journal List (5A) (`scJournal`) — tab: Journal
- **Purpose**: list of journal entries (lessons / practice notes).
- **Header**: "Journal", "+ entry" button (`onNewEntry`).
- **Filter chips**: **all** (selected), **lessons**, **practice**, **by figure**. (Chips are visually present but have **no onClick handlers** — non-functional in prototype.)
- **Entries** (`journal`, `e`): author avatar, `{{ e.title }}` ("Kind · who", e.g. "Lesson · Anna", "Practice · solo", "Practice · w/ Lena"), `{{ e.date }}`, `{{ e.text }}` (note font, truncated), tag chips (`tags`, `t`: label + tone-styled colors: `step`=blue, `sway`=red, else neutral). Tap opens entry editor.

### 8. Entry Editor (3A) (`scEntry`)
- **Purpose**: create/edit a journal entry and link it to choreography.
- **Header**: back (`onBackEntry`), `{{ eTitle }}` ("Kind · date"), "save" (`onSaveEntry` → toast "Saved to journal").
- **Author row**: avatar, name, role (coach gets "coach · 45 min", partner "partner", self "leader · practice"/"…lesson").
- **Textarea**: placeholder "What changed today?" (`draftText`/`onDraftChange`).
- **LINKED TO** (`eLinks`, `l`): each link chip `{{ l.label }}` with remove ✕ (`l.onRemove`). Dashed add: "+ link to a step, figure or attribute" (`onAddLink` → Link picker). Link label formats: place "↳ Fig · step N", figure "↳ all Xs · scope", attribute "↳ value · scope".
- **Media row** (all → toast "Attach — coming soon"): **voice**, **photo**, **video**.

### 9. Profile (3C) (`scProfile`) — tab: Profile
- **Purpose**: identity and personal note color.
- **Header**: "Profile".
- **Identity**: large avatar (initial), `{{ pName }}`, "{{ pRole }} · shares 2 choreos" (the "2" is hard-coded literal text).
- **YOUR NOTE COLOUR**: 6 swatches (`swatches`, `sw`) — `#3b7dd8`, `#1f8a5b`, `#cf5aa0`, `#a9742c`, `#c0563f`, `#5b6b8a`; selected one ringed + check (`sw.onPick`).
- **Preview** card: "Preview · your notes" / "this is how your notes appear to others" (bg/ink derived from chosen color).
- **Explanatory note (verbatim)**: "Each member picks their own colour; it stays consistent across every shared choreo."
- No editable name/role, no sign-out, no settings.

---

## Overlays / Sheets

### Add-figure Sheet (`addSheetOpen`)
- Opened from Assemble-edit "add figure" (`side.onAdd`). Header "Figure library", "{{ addSheetDance }} · add to {{ addSheetSideName }}". Backdrop tap closes.
- **Library view** (`notComposeFigure`): filter input "filter figures…" (`libFilter`/`onLibFilter`); list (`libFigures`, `lib`): dot (custom brown/library accent), name, custom badge, "+". Tapping adds the figure to the side (`lib.onAdd` → `addFigure` → toast "Added X"). Empty state (when filter matches nothing): "No figures match — create your own below". Button "Create my own figure" (`onStartCompose`).
- **Compose view** (`composeFigure`): back arrow (`onCancelCompose`), "New custom figure", "FIGURE NAME" input placeholder "e.g. Open Telemark", note "The figure will be added with a placeholder step. You can annotate and tag it fully from the timeline.", buttons "cancel" / "add to routine" (`onSaveCompose`, source `custom`).
- The library figure list per dance is hard-coded (see `danceFigures`). New figures get pre-built steps for a few known names (Wing, Outside Change, Double Reverse Spin, Chassé), else a **generic 3-step placeholder** (triple "1/2/3" for Waltz/Viennese, "S/Q/Q" otherwise).

### Info Sheet (`infoSheetOpen`)
- Opened by tapping any Ri/Bo/Fw/Sw/Tn header/abbrev (`onInfoRise`…). Shows colored dot + `{{ infoContent.name }}`, long `{{ infoContent.desc }}` (teaching copy), then "VALUES" list (`values`, `val`: `{{ val.v }}` term + `{{ val.d }}` definition). Close ✕ (`onCloseInfo`). Content is the technique glossary (full text in `famInfo`, see Domain notes).

### New Choreo Sheet (`newChoreoOpen`)
- "New choreography". **DANCE** chips (`newChoreoDances`): Waltz, Viennese Waltz, Quickstep, Foxtrot, Tango (one selected). **NAME** input placeholder "e.g. Gold Waltz — comp routine". Buttons "cancel" / "create choreo" (`onCreateChoreo` → creates with bars:0, created "today", opens it in Assemble-edit).

### Link Picker (`lpOpen`) — multi-step wizard
- Header with optional back (`lpCanBack`/`onLpBack`), `{{ lpTitle }}`, close ✕.
- **Type step** (`lpIsType`): three cards —
  - **Specific place** — "e.g. step 2 of Natural Turn · 1st Long Side" (`onLpPlace`)
  - **A figure** — "e.g. all Whisks, all Natural Turns" (`onLpFigure`)
  - **An attribute** — "e.g. all CBMPs, all left turns, all left sways" (`onLpAttr`)
- **List steps** (`lpIsList`, items list): wizard walks:
  - place: side → figure → step (picks a specific step) → adds link.
  - figure: pick figure (deduped by name) → **scope**.
  - attribute: pick category (Body/Rise/Foot/Sway/Turn) → pick value → **scope**.
  - **scope** options: "This choreo only", "All {Dance} choreos" (same dance), "Every dance" (wherever this appears).
- This reveals the linking model: a journal note can be attached to a single step, to all instances of a named figure, or to all steps bearing a given attribute value — each at choreo / dance / global scope.

### Toast (`toastShown`) — collected messages (verbatim)
- "Added {SideName}" / "Added {FigureName}"
- "Saved to journal"
- "Copied — edit your own version"
- "Invite link copied"
- "Attach — coming soon"

---

## Tab bar
| Tab | Label | Maps to |
|---|---|---|
| `onTabChoreo` | Choreo | Choreo List (resets `choreoView` to `list`) |
| `onTabJournal` | Journal | Journal List |
| `onTabProfile` | Profile | Profile |
Active tab uses accent color/bold; inactive gray. Hidden on step, thread, share, and entry-editor screens.

---

## Navigation graph (best-effort)
- **Choreo tab** → List.
  - List `+` → New Choreo sheet → "create choreo" → Assemble (edit).
  - List card tap → Assemble (reading).
  - Assemble: edit-toggle ⇄ editing/reading; share → Share (back → assemble); figure card / reading figure → Figure Timeline.
  - Assemble-edit: "add figure" → Add-figure sheet (→ Compose); "add side" → inline Long/Short/Corner.
  - Figure Timeline: lanes/edit toggles ⇄ view; in edit/lanes, step tap → Step Detail; in view, inline expand; back → Assemble.
  - Step Detail: thread button → Thread; done/back → Figure.
  - Thread: back → returns to figure or assemble (`threadReturnView`); also reachable from Assemble reading comments.
- **Journal tab** → Journal List.
  - "+ entry" → Entry Editor (new); entry tap → Entry Editor (edit).
  - Entry Editor: "+ link…" → Link Picker (multi-step); save/back → Journal List.
- **Profile tab** → Profile.

---

## Domain / product microcopy (verbatim, encodes decisions)
- Collaboration/permissions (Share): **"Partners see each other's notes. To change steps, anyone can duplicate the choreo and edit their own copy."** → Notes are shared & visible; the choreography structure itself is not co-edited — editing means forking (duplicate). Access shown as "view + note" for partner & coach; owner "can edit".
- Note color (Profile): **"Each member picks their own colour; it stays consistent across every shared choreo."** → Per-user identity color, global, used to attribute notes/comments.
- Figure compose: **"The figure will be added with a placeholder step. You can annotate and tag it fully from the timeline."**
- Timeline footers: "tap a step to read its detail · switch to Edit to tag"; "empty dot = nothing logged yet · tap a step to edit its slots"; "a lane per level of information · tap any step to tag it".
- **Technique glossary** (Info sheet, `famInfo` — verbatim teaching copy):
  - **Rise & fall** (#1f8a5b): "The vertical movement of the body through each bar. In Waltz the couple begins to rise at the end of count 1, continues rising on 2–3, then lowers at the very end of count 3 into the next bar." Values: commence ("Begin to rise at the end of this step"), body rise ("Torso rises while the heel stays in contact with the floor"), foot rise ("Heel lifts — now fully on the toes"), up ("Remain on the toes (heel off the floor)"), continue ("Continue the existing rise or fall through this step"), lowering ("Begin to lower at the end of this step — heel returns to the floor"), body lower ("Upper body lowers before the foot settles"). *(Note: Info sheet lists 7 values incl. "body lower", but the Tag editor offers only 5 rise options — see gaps.)*
  - **Body position** (#8a5cab): "The spatial relationship and orientation of the partners' bodies… essential for connection and footwork." Values: Closed, Promenade (PP), CBMP ("Counter Body Movement Position — foot placed across the line of the opposite foot"), CBP ("Counter Body Movement — body turns away from the moving foot"), Wing ("A Waltz-specific position…").
  - **Footwork** (#a9742c): "Which part of the foot contacts the floor… creates the characteristic rise and fall." Values: HT (Heel then Toe), T (Toe only), TH (Toe then Heel), heel pull.
  - **Sway** (#c0563f): "The inclination of the body to one side… never forced… always away from the centre of the turn." Values: to L, to R, none.
  - **Turn** (#5b6b8a): "The amount of rotation during a step, measured as a fraction of a full turn. Turning is gradual." Values: ¼ L (90°), ¼ R, ⅜ L (135°), ⅜ R, ½ L (180°), ½ R, none.
- **Slot short-labels** (`shorten`, used in chips): lowering→lwr, body rise→rise, foot rise→f↑, continue→cont, up→up, commence→com, Closed→Cl, Promenade→PP, Wing→Wg, to L→L, to R→R, none→—, heel pull→H.pl; others = spaces stripped.
- **Bar counting rule**: "bars" for a figure/side = number of steps whose `count === '1'`. So a bar boundary is implied by the "1" beat; "&" and other beats don't start a bar.
- **Seed dances & figure libraries** (`danceFigures`): Waltz (Natural Turn, Reverse Turn, Spin Turn, Whisk, Chassé, Wing, Outside Change, Double Reverse Spin, Hover Corté, Fallaway Reverse); Viennese Waltz (Natural/Reverse Turn, Forward/Backward Change); Quickstep (Quarter Turn, Natural Turn, Lock Step, Fishtail, Running Finish, Tipple Chassé, Fallaway); Foxtrot (Feather Step, Three Step, Natural/Reverse Turn, Fallaway Reverse, Weave, Hover Feather); Tango (Walk, Progressive Link, Closed Promenade, Rock Turn, Fallaway Promenade, Four Step).
- **Seed routine** "Gold Waltz" (Waltz) with sides: 1st Long Side (Natural Turn, Spin Turn), 1st Short Side (Whisk, Chassé[custom]), 2nd Long Side (Reverse Turn, Whisk, Wing). Steps carry pre-set slots (e.g. Natural Turn step 1 "RF forward", rise commence, foot HT, turn ¼ R).
- **Seed people**: Daniel (me, leader, color #3b7dd8), Lena (partner, #cf5aa0), Anna (coach, #b89400).

---

## Consolidated Entity / Field inventory

| Entity | Fields (from bindings/seed) | Notes |
|---|---|---|
| **Choreo / Routine** | `id`, `title`, `dance`, `bars` (derived count), `created` (string date label), `sides[]`; derived: `color` (by dance), `barLabel`, `owner`, `sharedWith` | "Choreo" (list/card) and "routine" (inside) are the same object. `bars` recomputed from steps where count=='1'. |
| **Side** | `id`, `name` (e.g. "1st Long Side", "Corner"), `figures[]`; UI: `collapsed`/`expanded`, `barLabel` | Three kinds: Long / Short / Corner; auto-named by ordinal. |
| **Figure** | `id`, `name`, `source` (`library`/`custom`), `steps[]`; derived: `countLabel`, `isCustom`, `threadCount` per step | "custom" badge; library figures depend on the choreo's dance. |
| **Step** | `id`, `count` (e.g. "1","&","2","S","Q"), `action` (text, e.g. "LF forward"), `rise`, `body`, `foot`, `sway`, `turn` (each nullable enum), derived `n` (1-based index), thread key `figId|n` | The five slots are single-select enums (the "tags"). |
| **Slot/Attribute dimension** | key (`rise`/`body`/`foot`/`sway`/`turn`), display name, color, `desc`, `values[]` ({value, definition}) | Reference/glossary data (`famInfo`). |
| **Thread** | keyed by `figureId|stepNumber`; list of comments | Lives per step. |
| **Comment** | `author` (`me`/`lena`/`anna`/id), `time` (string), `text` | Author → name/color/role/initial via `authorMeta`. |
| **Journal Entry** | `id`, `kind` (`Lesson`/`Practice`), `who` (e.g. "Anna","solo","w/ Lena"), `author`, `date` (string), `text`, `links[]`, `tags[]`; derived `title`, `initial`, `avatarColor` | Media (voice/photo/video) referenced but unimplemented. |
| **Entry Link** | `type` (`place`/`figure`/`attr`), for place: `fig`,`step`,`side`; for figure: `name`; for attr: `cat`,`value`; all may carry `scope` (`choreo`/`dance`+`dance`/`all`) | The link model from the Link Picker. |
| **Tag (journal)** | `label`, `tone` (`step`/`sway`/`plain`/…) → styled chip | Display-only categorization on entries. |
| **Person / Member** | `name`, `role` (`leader`/`partner`/`coach`), `color`, `initial`, `access` (`can edit`/`view + note`) | Identity color is per-user, global. |
| **Profile (current user)** | `name`, `role`, `color` | Only color is editable in UI. |
| **App/UI state** | `tab`, `choreoView`, `assembleEdit`, `figMode`, `openChoreoId`, `openFigureId`, `openStepId`, `expandedStepId`, `collapsed{}`, `threadStepKey`, `threadReturnView`, `editingEntryId`, `draft`, `linkPicker`, `libFilter`, `composeFigure`, `addSheetSide`, `addSideOpen`, `newChoreo`, `replyText`, `toast` | Pure prototype state; no persistence. |

---

## Gaps / things the design does NOT address

- **No auth / onboarding / sign-up / login** screens. User identity is assumed (seed "Daniel").
- **No settings screen** (theme props exist only as `.dc` editor props, not in-app); no sign-out, no account management.
- **No editable name/role** — Profile only edits note color; "shares 2 choreos" is hard-coded.
- **No reorder UX**: how figures/steps/sides are reordered (drag handles?) is not shown. Figures append; sides append.
- **No delete flows**: no delete for choreo, side, figure, step, journal entry, or comment. Only link removal exists.
- **No step editor for `count`/`action`**: counts and step actions are seeded; the UI lets you tag the five slots but not edit a step's beat/count or its action text, nor add/remove steps within a figure (compose only adds whole figures with placeholder steps).
- **No search** anywhere (choreo list, journal). Journal **filter chips (lessons/practice/by figure) are non-functional** (no handlers).
- **Journal links don't drive navigation**: tapping a journal entry's tag/link doesn't jump to the linked step (no handler from journal to choreo).
- **Info sheet vs editor mismatch**: Rise info lists 7 values (incl. "body lower", "continue") but the tag editor offers only 5 (lowering, body rise, foot rise, continue, up — missing "commence" and "body lower" though seed data uses "commence"). Turn editor includes "none"; info omits it. Body editor uses "Promenade"/"CBMP" while info labels "Promenade (PP)". These inconsistencies need reconciling into one canonical enum.
- **No offline indicator / sync state / loading / error states**; all data is in-memory seed, no real persistence or networking.
- **Invite flow** ends at a toast ("Invite link copied") — no actual invitee management, no removing a shared member, no role/permission editing.
- **Duplicate-to-edit** is a toast only; no real fork/version model UI (versions, comparing copies, merging) despite being the stated editing mechanism.
- **Media attachments** (voice/photo/video) are stubs ("coming soon").
- **Comment editing/deleting**, threading depth, read/unread, notifications — none addressed.
- **No multi-select / bulk** operations, no undo.
- **Empty states**: only the figure-library filter has one ("No figures match…"); no empty states for zero choreos, zero journal entries, empty side, or step with no comments beyond the "+ add comment" affordance.
- **Corner side** kind exists in the add-side picker but its semantics (vs Long/Short, e.g. for floorcraft) aren't explained.
- **`barLabel` "no figures yet"** for a brand-new choreo, but newly created choreos jump straight to assemble-edit with no figures — first-run guidance is minimal.
