# Class 11/12 Stream Selection — Handoff

**Read this first if you are picking this work up with no memory of the conversation that started it.**
You have the repo and this file. That is enough. Everything below is either verifiable in the repo or
was measured against the live database and recorded here.

**This is a separate feature from the content-platform rebuild.** See `docs/REBUILD_HANDOFF.md` for
that work (chapter identity, manifests, the non-STEM taxonomy). The two share infrastructure —
this feature was seeded on top of the live-database wipe documented in that file's §9, and its earliest
data (the flawed `exam_categories.streams` column) was created while restoring what that wipe removed
(REBUILD_HANDOFF.md §10) — but the feature itself, its phases, and its own open items are tracked here,
not there. If you're looking for chapter manifests or Study Notes, you're in the wrong file.

Last updated: 2026-08-13. **Phases 1, 2 and 3 done** (data model, onboarding UI, admin editor — the
last of these also fixed a grant bug that still affects the content-engine thread, see §11).
Phase 4 (downstream consumption) not started.
Branch: `nonstem-stage-a-taxonomy`, same as the content rebuild (never pushed to `origin/main`).

---

## 1. What this feature is

Class 11/12 students on CBSE or Kerala State pick a stream (Science/Commerce/Humanities) and, within
it, a language and subject combination that genuinely differs by board — not a simple flat subject
list. The owner supplied real curriculum facts (verbatim in
[`docs/curriculum-streams-reference.json`](curriculum-streams-reference.json), and later a more precise
canonical spec directly in the task text) and asked for a unified data model, an onboarding UI, an
admin editor, and downstream consumption (Practice Generator, Syllabus, etc. scoped to a student's
actual chosen subjects instead of the full board list).

**The curriculum facts, as currently modeled (§4 below is the authoritative live data — read that, not
this summary, before changing anything):**

- **Classes 8–10, both boards**: no streaming, no choice. Out of scope for this feature entirely.
- **CBSE 11–12**: one mandatory subject (English Core). Per stream, some subjects are **locked**
  (currently: Physics + Chemistry for Science only — see §6, a live correction from the original "CBSE
  locks nothing" model) and the rest are a genuine free pick from a pool. An optional, ungraded 6th
  subject is available from a pool shared across all three CBSE streams.
- **Kerala State 11–12**: two mandatory languages (English + a choice of second language). Per stream,
  3 subjects are locked (the "common core") plus one more chosen from a small pool (the "course code"
  choice — e.g. Science's Biology vs Computer Science pick). No optional 6th subject; Kerala totals
  exactly 6 subjects (2 languages + 4 stream subjects), no more.

## 2. Decided architecture

**Two new tables**, not an extension of `exam_categories.streams` (the column that data originally
landed in — see §5). `exam_categories` is a general-purpose board/class/competitive catalog serving
unrelated concerns; the admin editor (Phase 3) naturally edits "one stream" as a unit, which wants a
real row, not a field in nested jsonb.

- **`stream_configs`** — one row per (board, class tier, stream). `stream_mandatory` (locked subjects,
  may be empty), `choice_slots` (the graded pick — usually one slot), `optional_slots` (CBSE's ungraded
  6th, empty for Kerala), `named_combinations` (admin-addable labels for a choice pick, e.g. Kerala
  Science's "Course Code 1"). Keyed by `class_tier = '11-12'`, not separately per Class 11 and Class 12
  — the curriculum is identical across both years, so this avoids a duplication/drift risk the original
  seed had.
- **`board_language_config`** — one row per board. `mandatory_languages`, and `choice_language_slot`
  (**null** for a board with no second-language choice — CBSE; **populated** for one that has it —
  Kerala). **UI must branch on this field's nullness, never on a board-name string** — that's the whole
  reason it's split out from `stream_configs` rather than folded in.

Both tables: read-open RLS policy, write-closed (no permissive policy at all — matches
`chapter_manifests`' pattern), two admin RPCs (`admin_upsert_stream_config`,
`admin_upsert_board_language_config`) gated by `assert_verified_admin`, same as every other admin write
surface in this project.

`users` gained two additive, nullable columns: **`subjects text[]`** (the flattened, consumer-friendly
list — NULL for every student who hasn't completed stream selection; **nothing reads it yet**, that's
Phase 4's job) and **`academic_track jsonb`** (the structured choice: `{board, stream, language_choice?,
chosen_slot_subjects, optional_6th?}`).

## 3. What already exists and works

| Thing | Where | State |
|---|---|---|
| `stream_configs` + `board_language_config` schema, RPCs, RLS | migration `20260813040000` | Applied to live, both-halves verified (§7) |
| `stream_configs.description` (Phase 1 gap fix) | migration `20260813060000` | Applied, backfilled from real source text |
| `users.subjects` / `users.academic_track` | migration `20260813050000` | Applied; extends `upsert_own_user`/`update_own_user`, does not add a new RPC |
| Pure selection logic + admin validation (no React) | `src/lib/streamSelection.js` | 40 tests passing — see §8, §10 |
| Data-fetching hook | `src/hooks/useStreamConfig.js` | Holds the onboarding flow at the Board step until the fetch resolves |
| Onboarding UI (5 new step types) | `src/pages/OnboardingPage.jsx` | Built, real end-to-end Playwright proof (§8) |
| `stream_selection_enabled` feature flag | `src/lib/featureFlags.js` `FLAGS.STREAM_SELECTION` | Registered and gated in the UI; **currently ON in the live DB, for testing** — turn off before considering this "launched" if that matters |

## 4. The live curriculum data, exactly as seeded (read this before touching any row)

**6 `stream_configs` rows** (`board_key`, `stream_key` → `stream_mandatory` / `choice_slots.count` /
`choice_slots.choose_from` / `named_combinations`):

| Board | Stream | Locked | Choice | Named combos |
|---|---|---|---|---|
| CBSE | science | `Physics, Chemistry` | pick 2 of `Mathematics, Biology, Computer Science` | none |
| CBSE | commerce | *(none)* | pick 4 of `Accountancy, Business Studies, Economics, Applied Mathematics` (4-of-4 = auto-select-all) | none |
| CBSE | humanities | *(none)* | pick 4 of `History, Political Science, Geography, Sociology, Psychology, Economics` | none |
| Kerala State | science | `Physics, Chemistry, Mathematics` | pick 1 of `Biology, Computer Science` | **Course Code 1** = +Biology, **Course Code 5** = +Computer Science |
| Kerala State | commerce | `Business Studies, Accountancy, Economics` | pick 1 of `Computer Applications, Mathematics, Statistics, Political Science` | **none — see §9** |
| Kerala State | humanities | `History, Economics, Political Science` | pick 1 of `Sociology, Geography, Psychology, Journalism` | **none — see §9** |

CBSE's three streams also share one **optional, ungraded 6th subject** pool:
`Physical Education, Fine Arts, Informatics Practices, Legal Studies, Psychology, Home Science`
(a subject already picked in the stream's choice slot is filtered out of this pool **at render time**,
in `availableOptionalSubjects()` — the stored config has no per-student state to do this itself, see §8).

**2 `board_language_config` rows**:

| Board | Mandatory | Choice |
|---|---|---|
| CBSE | `English Core` | none (`choice_language_slot` is `null`) |
| Kerala State | `English` | pick 1 of `Malayalam, Hindi, Arabic, Urdu, Sanskrit, Syriac` |

**Do not hand-edit these facts without re-reading §6 and §9** — the CBSE Science lock and the Kerala
Commerce/Humanities empty `named_combinations` are both deliberate, owner-confirmed states, not
placeholders waiting to be "cleaned up."

## 5. History: how the data got here (the flawed first attempt, kept for context)

The very first seed of this feature landed in `exam_categories.streams` (a jsonb column added in
migration `20260813030000`, back when this was being modeled as an extension of the general categories
table). That shape had real, measured defects — found by a Part-1-style "verify before building UI"
check, not assumed:

- **CBSE over-locked subjects.** Physics/Chemistry (Science) and Accountancy/Business
  Studies/Economics (Commerce) were baked into a per-stream `mandatory_core`, when the owner's model
  was "English is the only mandatory subject, the rest is a free pick."
- **Kerala Commerce wasn't in "combination block" shape** — it used the CBSE-style
  mandatory/options split instead of the named-blocks array Science had.
- **Two fields were prose strings, not arrays** (CBSE Humanities' `options`, Kerala Humanities'
  `combinations`) — unusable for a card/radio UI.

That column is now **deprecated via a SQL comment, not dropped** (additive-only rule) — nothing reads
it as of `20260813040000`. The real model is `stream_configs`/`board_language_config` (§2, §4). If you
find code or a migration still referencing `exam_categories.streams`, that is stale and should be
pointed at the new tables instead.

## 6. Live data correction: CBSE Science locks Physics/Chemistry

Owner instruction, after Phase 2 shipped. Real-world CBSE Science policy: Physics and Chemistry are
compulsory at most schools, unlike Commerce/Humanities' genuinely free pool — the original "CBSE locks
nothing but English" model (itself already a correction from an even more over-locked first draft, §5)
needed this one stream-specific exception.

Changed via the real `admin_upsert_stream_config` RPC (existing row's id fetched first, updated in
place — not a new row): `stream_mandatory` is now `["Physics","Chemistry"]`; the choice slot shrank
from "pick 4 of 5" to "pick 2 of the remaining 3" (`Mathematics`, `Biology`, `Computer Science`),
keeping the total non-language subject count at 4. `optional_slots` and `description` untouched. The
other 5 rows confirmed unchanged.

No code changes were needed — `streamSelection.js`'s functions are generic on `slot.count` /
`stream_mandatory`, never hardcoded to a specific count. Verified live: a real Playwright run through
CBSE Class 11 → Science shows `English Core | Physics | Chemistry` as locked chips, then `Choose 2 more
subjects (0/2 selected)` over the remaining pool. Test fixtures in `streamSelection.test.js` updated to
match, plus 3 new tests asserting the lock directly.

## 7. Phase 1 — unified data model (DONE)

Full evidence originally logged 2026-08-13; summarized here, detail in git log for commits
`5e25b67`/`fd3a9a0` and this file's predecessor sections in `REBUILD_HANDOFF.md`'s history if you need
the verbatim original write-up.

- **Table decision** (`stream_configs` + `board_language_config`, not extending `exam_categories`):
  proposed and built, reasoning in §2.
- **Verified both halves in a rolled-back transaction before applying anything**: unverified caller
  denied, bad `stream_key` rejected, real admin creates a row, and — the one that matters most — the
  **raw partial-unique-index blocks a duplicate identity via a direct INSERT that bypasses the RPC
  entirely**, proving the constraint protects even if a future bug or a manual edit skips the RPC. All 6
  assertions passed, for both new tables.
- **Applied for real**, independently reverified (`migration list` + a schema-existence query, not
  trusting the CLI's own "Finished" message — it printed a red herring about a certificate file that
  turned out to be an unrelated post-push caching step).
- **Seeded from the task's canonical curriculum text**, not the flawed `exam_categories.streams` data,
  via the real RPCs. Verified through the **real anon HTTP client path**, not just reading rows back —
  8 structural assertions, anon write and anon RPC call both confirmed blocked (401).
- **The evidence question the task asked directly**, answered: same-subject exclusion between a stream's
  choice slot and the optional-6th pool is enforced in the **UI**, not the data — a static stored pool
  cannot know what a given student already picked. Recorded in the `optional_slots` column comment.

## 8. Phase 2 — onboarding UI, save path (DONE)

- `src/lib/streamSelection.js` — pure logic, no React, specifically so the two owner-mandated
  requirements have a **real test proving them**, not a comment claiming them:
  - `availableOptionalSubjects()` excludes whatever was already picked in the stream's choice slot.
  - `matchedCombinationName()` returns `null` — never an invented name — when `named_combinations` is
    empty (Kerala Commerce/Humanities, permanently until real data arrives — see §9).
  - 22 tests, all passing.
- `src/hooks/useStreamConfig.js` — fetches both tables for a board+tier; `loading` holds the onboarding
  flow at the Board step until the fetch resolves, so a slow fetch can never let a student advance past
  where the Stream step should have been inserted.
- `src/pages/OnboardingPage.jsx` — 5 new step types (`stream`, `language`, `streamSubjects`,
  `optionalSixth`, `confirm`), inserted between Board and the competitive-exam step. Gated purely on
  data (`streamsApply` / `needsLanguageChoice` / optional-slot presence) and the feature flag — **never**
  a board-name string comparison.
- `src/context/AuthContext.jsx` — `completeOnboarding` optionally passes `subjects`/`academicTrack`
  through; absent for every non-stream signup, so no other flow changes.
- `users.subjects`/`academic_track` (§2) extend the **existing** `upsert_own_user`/`update_own_user`
  RPCs rather than adding a new write path — those RPCs are hard-coded field allow-lists (confirmed by
  reading them, not assumed), and onboarding already saves through that exact call.

### Two real bugs an actual click-through run caught, not code review

1. **The flag was created but nothing checked it.** Confirmed by `grep` before assuming otherwise —
   `getFeatureFlag`/`FLAGS` appeared nowhere in the first draft of `OnboardingPage.jsx`. Fixed by gating
   `streamsApply` on `useFeatureFlag(FLAGS.STREAM_SELECTION)`.
2. **Kerala's board key never matched.** Onboarding stores UPPER_SNAKE keys (`KERALA_STATE`);
   `stream_configs.board_key` uses the display form (`Kerala State`). Comparing them directly meant
   Kerala silently **skipped the entire stream sequence** — CBSE only "worked" in the first walkthrough
   pass by coincidence, because its onboarding key and board_key happen to be the identical string. This
   exact bug class was already solved once, in `categories.js`'s `resolveBoard()`/`BOARD_KEY_ALIASES`
   (added after a prior incident: "state-board students resolved to no combo at all"). Reused it rather
   than re-solving the same problem. **Would not have been caught without a real run against both
   boards** — the CBSE-only path never exercises the mismatch.

### Real end-to-end evidence (Playwright against the live dev server)

**CBSE Class 11 → Science**: no Language step; "Choose your subjects" shows `English Core` (+ now
`Physics`/`Chemistry`, post-§6) locked, `Choose 2 more subjects` over the remaining pool.

**Kerala Class 11 → Science**: dedicated Language step (`English` locked + a 6-item second-language
choice); subjects step shows 3 locked + a real 1-of-2 choice; Confirm shows a genuine **`Course Code 1`**
badge (a real `matchedCombinationName` hit) and the full resolved list.

**Full completion checked in the database, not just the UI** — ran a synthetic Kerala Class 11 / Science
/ Malayalam / Computer Science signup to `/dashboard`, then queried the real row:

```
academic_track: { board: "Kerala State", stream: "science",
                   language_choice: "Malayalam", chosen_slot_subjects: ["Computer Science"] }
subjects: ["English","Malayalam","Physics","Chemistry","Mathematics","Computer Science"]
onboarding_completed: true
```

`academic_track.board` is the **resolved** form, proving the board-key fix reaches all the way to what's
persisted, not just UI gating. Test row deleted after verification.

421 tests pass (402 content-rebuild + 19 stream-selection at the time), build clean.

## 9. Open items

1. **Kerala Commerce/Humanities `named_combinations` are empty and stay that way** until the owner
   supplies the real named DHSE combination blocks (Science has 2 real ones; Commerce/Humanities never
   had this data even in the original source JSON — inventing names would be fabricating a curriculum
   fact a student relies on). The Phase 3 admin editor's `named_combinations` list is specifically
   designed so these can be added later **without a schema change** — see §2.
2. **Phase 3 (admin editor) DONE** — `7d2179f`, live-verified. **Admin → Platform → Streams**
   (`src/admin/AdminStreamConfig.jsx`, registered in `AdminPlatformHub.jsx`). Per-board grouping,
   per-stream editor (locked-subject chips, choice/optional slot editors, named-combinations list),
   board-language editor whose "second-language choice" toggle stores **actual null** when off (the
   thing `needsLanguageChoice()` branches on), live validation, changelog on every save.

   **Validation lives in `src/lib/streamSelection.js`** (`validateStreamConfigDraft`,
   `validateBoardLanguageDraft`), not in the component — same reason the two student-side rules do:
   it's unit-tested against the real live configs and shared with the reader rather than being a
   second definition that drifts. Errors block the save (`count > choose_from.length`, empty pool,
   a subject both locked and choosable, bad `stream_key`); named-combination problems only **warn**,
   because Kerala Commerce/Humanities legitimately ship zero combinations and an admin may save one
   before adding the subject it refers to. A regression test asserts an empty `named_combinations`
   array stays completely silent — no nudge, no auto-fill (the "no fabricated DHSE block names" rule).

   **Two deliberate gaps, surfaced in the UI rather than faked:** no deactivate (the RPC has no
   `p_is_active`) and no delete (there is no `admin_delete_stream_config` RPC at all). Both need a
   migration if wanted.

   ⚠️ **A grant bug was found here that also affects the content-engine thread** — see §11.
3. **Phase 4 (downstream consumption) not started.** `useStudentScope()`, Practice Generator, Syllabus
   page scoping to a student's actual `subjects`/`academic_track` instead of the full board list; a
   "Complete your profile" nudge banner for existing 11-12 profiles with no `academic_track`; a
   Classes 8-10 regression check (must remain completely untouched — confirm no stream step ever
   appears for them).
4. **`stream_selection_enabled` is currently ON in the live DB**, for testing during Phase 2/3
   development. Decide before considering this feature launched whether it should be off until Phase 4
   also lands, or on incrementally.
5. **A genuine, unrelated security finding was discovered while building this feature** (extending
   `upsert_own_user`). It is NOT part of this feature's scope and is tracked in
   `docs/SECURITY_INCIDENTS.md`, not here — go there for it, not this file.

---

## 10. Phase 3 — admin editor (DONE)

**Admin → Platform → Streams.** `src/admin/AdminStreamConfig.jsx`, registered as a tab in
`src/admin/AdminPlatformHub.jsx`. Reads both tables directly (they are read-open), writes through
`admin_upsert_stream_config` / `admin_upsert_board_language_config`, logs to the changelog on every
save. See §9 item 2 for the behaviour summary and the two deliberate gaps (no deactivate, no delete).

**Verified against live, not just unit-tested** — the same standard Phase 2 was held to, and it paid
off again (§11). With a genuine Firebase admin session driven through the real UI:

| Check | Result |
|---|---|
| All 6 live stream rows + both language configs render | PASS |
| CBSE shows "No second-language choice — students are not asked" (null slot) | PASS |
| Kerala shows "Second-language choice: pick 1 of 6" | PASS |
| CBSE Commerce flagged `auto-select-all` (4-of-4) | PASS |
| Kerala Science shows its two named combinations | PASS |
| Unsatisfiable slot (pick 9 of 3) → Save disabled, "1 issue to fix" | PASS |
| Unreachable named combination → warning shown, Save stays **enabled** | PASS |
| Real save round-trip → "Saved with 1 warning" | PASS |
| Browser console errors | none |

Live data was left exactly as §4 documents it — the walkthrough's own test edit to CBSE Science's
`named_combinations` was reverted to `[]` and all 6 rows re-verified afterwards.

---

## 11. ⚠️ The grant bug — affects the content-engine thread too

**Found by the Phase 3 click-through, not by code review.** The editor's first real save failed with:

```
Save failed: permission denied for function admin_upsert_stream_config
```

`20260813040000` had granted both stream RPCs `EXECUTE` to **`authenticated` only**. That looks
tighter than the rest of the admin surface. In this project it means **nobody at all**:

> Auth here is **Firebase, not Supabase Auth**. A Firebase ID token carries no `role` claim, so
> PostgREST never switches the request role — **every request runs as `anon`**, signed in or not.
> A grant to `authenticated` alone can never be exercised by the real app.

Isolated rather than assumed. One genuine Firebase ID token for a real superadmin, three RPCs
differing only in their grant, same instant:

| RPC | Grant | Result |
|---|---|---|
| `admin_list_onboarding_options` | `{anon,authenticated}` | **200**, real data |
| `admin_upsert_stream_config` | `{authenticated}` | **401** `42501 permission denied` |
| `admin_upsert_chapter_manifest` | `{authenticated}` | **401** `42501 permission denied` |

Fixed for the two stream RPCs in `20260813080000_stream_admin_rpc_grants.sql` by granting `anon` as
well, matching every other admin RPC here. **This does not loosen security** — the real gate is the
`assert_verified_admin(p_caller)` call in each body, untouched. Re-verified live after the change:

- anon, no Firebase identity → `42501 Access denied: unverified caller`
- real JWT for a non-admin uid → `42501 Access denied`
- real admin JWT with a spoofed `p_caller` → `42501 Access denied: caller mismatch`
- genuine superadmin → **200**, row written

**STILL BROKEN, not fixed here:** `admin_upsert_chapter_manifest` and `admin_approve_chapter_manifest`
carry the identical grant and are equally unreachable from the app today. They belong to the
content-engine rebuild (`docs/REBUILD_HANDOFF.md`), a separately phase-gated project, so they were
reported to the owner rather than changed across a project boundary. **Whoever picks up that thread's
admin surface must apply the same one-line grant fix first, or every save there will 401.**

**General rule for this codebase:** never grant an RPC to `authenticated` alone. Grant to
`anon, authenticated` and gate inside the body with `assert_verified_admin` / `assert_verified_self`.

---

## 12. ⚠️ Subject-catalog drift: stream_configs vs Categories (OPEN — blocks Phase 4)

**Audited 2026-08-13, on owner request, before building admin student-edit on top of it.**
**Finding: they are two independent sources with no shared key, no constraint, no validation — and
they have already drifted.**

### Three sources of "what subjects exist", not one

| # | Source | Edited via | Consumed by |
|---|---|---|---|
| A | `exam_categories.subjects` (DB) | Admin → Categories | `loadCategories()` → `getSubjectsForExam()` → Practice Generator, Syllabus (`useSyllabusSubjects`), Admin Content Intake, Admin Study Notes, Admin Paper Gen |
| B | `stream_configs` + `board_language_config` (DB) | Admin → Streams (new, §10) | Onboarding → `users.subjects` / `users.academic_track` |
| C | `FALLBACK_CATEGORIES` / `SCHOOL_SUBJECTS_11_12` (hardcoded, `src/lib/categories.js:22-23`) | code only | boot fallback when the DB read fails |

Nothing links A and B. `admin_upsert_stream_config` validates `stream_key` but never checks that a
subject name exists anywhere. The Streams editor's subject fields are free text.

### Measured drift, live, today

Subjects onboarding can assign that **do not exist in Categories** for that board + class 11/12:

| Board | Count | Subjects |
|---|---|---|
| CBSE | 12 | Applied Mathematics, **English Core**, Fine Arts, Geography, History, Home Science, Informatics Practices, Legal Studies, Physical Education, Political Science, Psychology, Sociology |
| Kerala State | 14 | Arabic, Computer Applications, Geography, Hindi, History, Journalism, Malayalam, Political Science, Psychology, Sanskrit, Sociology, Statistics, Syriac, Urdu |

**26 total.** The sharpest case: onboarding assigns **`English Core`** while Categories has
**`English`** — the same real subject under two names, already live.

### Why this blocks Phase 4

Phase 4's entire job is to scope Practice Generator / Syllabus to a student's actual `subjects`
instead of the full board list — i.e. to feed **B's values into A's consumers**.
`getSubjectsForExam()` resolves against A. A CBSE Science student whose stream gave them
`Applied Mathematics`, or any student carrying `English Core`, lands on a subject the content side
has never heard of: no syllabus nodes, no content, no PYQs — a silently empty screen, with nothing
in the UI to explain why. Same failure class as the Content Library/Syllabus desync: two catalogs of
one concept, no source of truth.

### Proposal (NOT yet decided — owner to choose)

**Recommended: make Categories the subject vocabulary of record; make `stream_configs` reference it
rather than restate it.** Streams decide *which* subjects a stream offers and how many are picked;
Categories decides *what subjects exist*. Enforce in three places, cheapest first:

1. **Editor** — the Streams editor's subject inputs become pickers sourced from Categories for that
   board+class, not free text. Free text is how all 26 got in.
2. **RPC** — `admin_upsert_stream_config` rejects any subject absent from the board+class catalog,
   alongside its existing `stream_key` check, so SQL and manual writes can't bypass the UI.
3. **Reconciliation** — the 26 existing names can't just start failing (the live rows would become
   unsaveable). Each is either **added to Categories** (Psychology, Sociology, Legal Studies,
   Malayalam… are real subjects the catalog simply lacks) or **renamed to match** (`English Core` →
   `English`). Needs an owner pass: these are curriculum facts, not cleanup.

Rejected alternatives: making B canonical (Categories also serves 8–10, competitive exams and all
content tooling; streams cover only 11–12 on two boards), and a third shared `subjects` table
(cleanest long-term, largest migration — revisit if a fourth consumer appears).

### §12a. Reconciliation decision table — AWAITING OWNER REVIEW

**21 unique subjects** (the "26" in §12 counts board-subject *pairs*; 5 subjects appear on both
boards). Recommendation pre-filled per subject; owner to correct before anything is applied.

**Adds go to the `Class 11` AND `Class 12` rows for that board only** — not the board-level row, not
6–10. "Already in catalog" means the exact string is already used somewhere in `exam_categories`, so
adding it introduces no new vocabulary and carries no naming risk.

| # | Subject | Board(s) | Where it's used | Already in catalog? | **Recommendation** |
|---|---|---|---|---|---|
| 1 | **English Core** | CBSE | language, mandatory | no | **RENAME → `English`** ⚠️ |
| 2 | Applied Mathematics | CBSE | commerce choice | no | ADD ⚠️ |
| 3 | History | CBSE, Kerala | CBSE humanities choice; Kerala humanities **locked** | yes (UPSC, CUET) | ADD |
| 4 | Geography | CBSE, Kerala | humanities choice (both) | yes (ICSE rows) | ADD |
| 5 | Political Science | CBSE, Kerala | CBSE humanities choice; Kerala commerce choice + humanities **locked** | yes (CUET) | ADD |
| 6 | Sociology | CBSE, Kerala | humanities choice (both) | no | ADD |
| 7 | Psychology | CBSE, Kerala | CBSE humanities choice + optional-6th; Kerala humanities choice | no | ADD |
| 8 | Computer Applications | Kerala | commerce choice | yes (ICSE rows) | ADD |
| 9 | Statistics | Kerala | commerce choice | no | ADD |
| 10 | Journalism | Kerala | humanities choice | no | ADD |
| 11 | Informatics Practices | CBSE | optional-6th | no | ADD |
| 12 | Legal Studies | CBSE | optional-6th | no | ADD |
| 13 | Physical Education | CBSE | optional-6th | no | ADD |
| 14 | Fine Arts | CBSE | optional-6th | no | ADD |
| 15 | Home Science | CBSE | optional-6th | no | ADD |
| 16 | Hindi | Kerala | language choice | yes (18 rows) | ADD |
| 17 | Sanskrit | Kerala | language choice | yes (class-10 rows) | ADD |
| 18 | Malayalam | Kerala | language choice | no | ADD |
| 19 | Arabic | Kerala | language choice | no | ADD |
| 20 | Urdu | Kerala | language choice | no | ADD |
| 21 | Syriac | Kerala | language choice | no | ADD |

**Net: 1 rename, 20 adds.**

#### The three calls worth arguing about

1. **#1 `English Core` → `English` (the only rename).** CBSE's formal name for the compulsory paper
   is "English Core" (it also offers "English Elective"). Recommending the rename because Categories
   already has `English`, content/syllabus/PYQ will be filed under `English`, and two names for one
   paper is precisely the drift being fixed. **Counter-argument:** if English Elective is ever
   offered, `English` becomes ambiguous and you'd want both names back. Owner's call.
2. **#2 `Applied Mathematics` stays separate from `Mathematics`.** These are genuinely different
   CBSE subjects with different syllabi (041 vs 241), so this is an ADD, not a rename to
   `Mathematics`. Confirm — if you consider them one subject for content purposes, it becomes a
   rename and CBSE Commerce's pool shrinks accordingly.
3. **Structural: should languages and arts be in the Categories subject list at all?**
   Categories subjects drive the *content* tooling — Admin Content Intake, Study Notes, Paper Gen,
   Practice Generator dropdowns. Adding Syriac, Urdu, Fine Arts, Home Science etc. makes them
   selectable there for subjects the platform may never hold content for.
   - **(a) Add all 21 (recommended).** One vocabulary, no drift, unblocks Phase 4 immediately. The
     dropdown clutter is a UI concern, solvable later with a `content_bearing` flag on the subject.
   - **(b) Add only the academic core**, and treat languages/arts as valid-for-a-profile but
     not-content-bearing. More correct long-term, but needs a new schema concept now, and until it
     exists those subjects are exactly the "in a profile, unknown to the catalog" state being fixed.

   Recommending **(a)** — fix the drift completely now, refine presentation later.

---

## 13. §12 drift — RESOLVED

`9326eb0`. Owner decisions from §12a implemented exactly: `English Core` → `English` (rename),
11 subjects added to Categories as **core** (Applied Mathematics, History, Geography, Political
Science, Sociology, Psychology, Computer Applications, Statistics, Journalism, Informatics
Practices, Legal Studies — the last two moved from the original "deferred" proposal to core on
owner correction: full examined CBSE subjects, not enrichment), 9 subjects **deferred** behind a
new `content_bearing` flag (6 languages + PE/Fine Arts/Home Science).

**New table: `public.subjects`** (migration `20260813100000`) — the vocabulary of record, 40 rows
(33 content-bearing, 7 hidden). Separates "does this subject exist" (a row here) from "do we serve
content for it" (`content_bearing`) from "which board+class offers it" (`exam_categories`,
unchanged) from "which stream offers it" (`stream_configs`, unchanged).

**Enforced, not just documented** (migration `20260813110000`): `admin_upsert_stream_config` and
`admin_upsert_board_language_config` now call `assert_known_subjects()` against `public.subjects`
before writing — locked subjects, both slot kinds, and named-combination `resulting_subjects` all
checked, including the retired `English Core` string. A typo or unknown name is rejected at write
time with a clear message, not just visible on the next audit. Live-verified: all 6 real stream
rows still validate clean; `Malayalam`/`Syriac`/`Urdu` (content_bearing=false) still accepted —
proving the check is against the vocabulary, not the content-facing catalog.

**`src/lib/categories.js`** — `getSubjectsForExam()` now filters to `content_bearing` by default.
All 6 existing call sites (Practice Generator, Syllabus, Content Intake, Study Notes, Paper Gen)
get clean dropdowns with **no call-site change**. `{ includeNonContent: true }` opts into the full
set. Fails open on a fetch failure — an empty vocabulary means no filtering, not a blanked screen.

**Admin → Platform → Subjects** (new tab, `src/admin/AdminSubjects.jsx`) — add/edit subjects, no
delete (would recreate a dangling reference; retire via `content_bearing = false` instead). The
Streams editor's subject inputs (`AdminStreamConfig.jsx`) are now **pickers sourced from this
vocabulary**, not free text — free text is how the original 21 got in.

**Re-measured live after the fix**: drift is now exactly the 9 intentionally-deferred subjects
(languages + activities), not leftover drift — the design's intended remainder.

**Next**: admin student-edit (add stream/subject editing to `admin_update_user`, writing `subjects`
+ `academic_track`), then content-engine Phase 2.
