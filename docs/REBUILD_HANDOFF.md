# Content Platform Rebuild — Handoff

**Read this first if you are picking this work up with no memory of the conversation that started it.**
You have the repo and this file. That is enough. Everything below is either verifiable in the repo
or was measured against the live database and recorded here.

Last updated: 2026-08-13, Phase 1 done and applied to live. Phase 2 not yet started.
Branch: `nonstem-stage-a-taxonomy` (50+ commits ahead of `origin/main`, **never pushed**). This is git —
the live *database* is separate and is now ahead of it: `chapter_manifests` exists live via a direct
`supabase db push`, done on explicit owner instruction, independent of any git push.

**⚠️ READ THIS BEFORE TOUCHING THE LIVE DATABASE.** On 2026-08-13, after Phase 0, the owner ordered a
**full wipe of the live database** — all 62 tables in the `public` schema, keeping only `admins`
(both rows, unchanged: `info@acenzos.com` and `thaslimshajahans@gmail.com`, both `role='superadmin'`,
`is_active=true`). Every other table — `users`, `subscriptions`, all platform config
(`feature_flags`, `exam_categories`, `quota_config`, `platform_settings`, `email_templates`,
`plan_config`, `onboarding_category_display`), the audit log (`changelog`, 1,493 rows), and all
content/operational tables — is now at **0 rows**. See §9 for the full record. **The live site is
almost certainly non-functional for any visitor right now** — there is no exam catalog, no feature
flags, no logged-in users. This was deliberate and owner-confirmed, not an accident, but the next
session must know about it before assuming any table has data or that the live app currently works.
**One exception since:** `chapter_manifests` now exists (0 rows, schema-only) — the Phase 1 migration
was applied on top of this wiped state on the same day. See §6c.

---

## 1. What happened, and why there is a rebuild

A corpus of NCERT textbook PDFs was loaded into `knowledge_base` across several sessions. A full audit
on 2026-08-13 measured, over the 4,866 rows loaded on 2026-08-12/13:

| Dimension | Defect rate |
|---|---|
| board / class (`exam_type`, `class_level`) | **0%** |
| subject | **0%** |
| `content_type` (incl. per-family validity) | **0%** |
| duplicate rows | **0** |
| **chapter name** | **9.4%** (456 rows, 48 bad chapters) |

Board/class/subject were derived from the **file path**. Chapter was derived from **model prose**.
That contrast is the entire design input for the rebuild.

The owner then **wiped all content tables** (deliberate, no backup, confirmed twice):

| Table | Before | Now |
|---|---|---|
| `knowledge_base` | 9,243 | **0** |
| `syllabus_nodes` | 534 | **0** |
| `pyq_questions` | 2,215 | **0** |
| `study_notes` | 181 | **181 — untouched, still live** |

The two loader checkpoint files were deleted too, so a future load will actually run instead of
reporting "already done". **The 520 source PDFs on disk were not touched.**

### The root cause (this is the thing to understand)

`src/lib/syllabus.js:chapterKeyFor()` derived chapter identity **from the chapter name**:

```js
chapterKeyFor({ classLevel:'11', book:'Hornbill', chapterName:'The Portrait of a Lady' })
  -> 'c11_hornbill_the_portrait_of_a_lady'
```

Identity *was* the name, so a naming error *was* an identity error, and no representation existed in
which a name could be wrong. Three consequences, all measured:

- **rename** → new chapter minted (`World Climate and Climate Classification` vs `...Change`, 23 rows)
- **capture** → a wrong title lands on a *real* key. `keps101` (Political Theory ch1) was filed as
  `Equality` (ch3), silently merging 13 rows into a valid chapter where **no orphan report could see them**
- **invent** → a section heading is as valid a key as a chapter (`Critical Reflection` 28 rows,
  `Poorvi` — a *book* name — 33 rows)

Note: migration `20260812040000` already specifies **ordinal** keys (`c11_hornbill_01`). The helper
drifted to name-slugs. The migration comment and the code have disagreed since. The rebuild restores
the documented intent.

---

## 2. Decided architecture (owner-approved, do not re-litigate)

**Chapter identity**
- Identity is **ordinal-anchored and book-scoped** (`c11_hornbill_ch07`), never name-derived.
- `chapter_name` is a mutable label; alternate printed titles are **aliases on the same key**.
- Before any book's chapters load, extract a **contents-page manifest** (ordinal, printed title,
  page range). **The owner personally approves each book's manifest once** before its content loads.
- Per-file chapter assignment is **closed-set selection from the manifest**, never open generation.
- **Three signals must corroborate**: manifest ordinal chosen, printed chapter number observed in page
  headers, file ordinal parsed from filename. All three agree → accept. Two agree → accept + flag.
  Disagree → **do not write**, flag for owner review.
- Chunk→chapter assignment is **positional** (page range from the manifest), never heading-based.

**Single write path**
- Study Notes is the only write path for text/notes content. On save it **upserts `syllabus_nodes` in
  the same operation** — there is never a manual syllabus-seeding step, for any language or board.
- PYQ uploads resolve chapters against the same `syllabus_nodes`: snap to existing, or flag. A PYQ
  arriving before its subject has a syllabus **queues and waits** rather than flagging every question.
- Content Map and Content Library become **pure views** — zero independent storage.

**Background processing**
- Runner is a **headless Chromium worker** reusing the production extraction modules unchanged
  (see §4 for why a native Node port was rejected).
- Admin uploads one or many files and does not wait; more can be queued while others process.
- A **Status tab** shows in-progress / completed / failed / flagged, visible to the whole admin team.
- Idempotency and retry from the start.

**Language / medium (full scope, not deferred)**
- `medium` is a **real column** on `knowledge_base` and `pyq_questions`, not inferred later.
- Detection is script/character-set analysis **combined with subject** — a Malayalam-medium Science
  paper and a Malayalam-*language* paper share a script but mean different things. Confidence-scored,
  admin-confirmed, never auto-submitted blind.
- `syllabus_nodes` stays **canonical per subject** (not duplicated per language), with
  `chapter_name_local` (jsonb) for translated display names, so analytics/blueprint stay unified.
- Hindi (87 files, previously deferred): the text layer is legacy Kruti-Dev and decodes to garbage.
  Solve with **vision-based extraction** (read the rendered page as an image), not a custom font map.
- Students get a medium preference; all retrieval/generation paths scope by it.

**Non-STEM taxonomy** — already designed and *already in the code*, see §3.

---

## 3. What already exists and works (do not rebuild these)

| Thing | Where | State |
|---|---|---|
| content_type families (stem / literature / social / commerce) | `src/lib/contentExtraction.js` `SUBJECT_FAMILIES`, `familyForSubject()` | **Working.** Audit measured 0 cross-family leaks over 4,866 rows |
| 21-value union CHECK constraint | migration `20260812050000` | Applied |
| `book` column + partial index | migration `20260812040000` | Applied. Read its comment — it explains why `book` is deliberately **out** of the unique index (NULLs are distinct in Postgres) |
| corpus → subject/class/book mapping | `src/lib/corpusMapping.js` | **Working.** Audit measured 0 unmapped, 0 unknown-class, 0 files split across subjects |
| per-file deadline in the loader | `scripts/bulk-load-corpus.mjs`, commit `aaea035` | Working; never fired in 157 files |
| crash recovery (`newPage` relaunch) | same file, commit `6cfa8fc` | Working; fixed a run-killing uncaught exception |
| truncation diagnostic | `src/lib/contentExtraction.js`, commit `1e6e440` | **Unproven** — has never fired against a live failure |

---

## 4. Hard constraints discovered the expensive way

- **`syllabus_nodes` is UNIQUE on `(exam_type, subject, chapter_key)`** and has **no CREATE TABLE in
  the migration history** — it was created outside it. No baseline DDL is replayable.
- **The extraction pipeline is browser-bound.** `src/lib/pdfVision.js:152` calls
  `document.createElement('canvas')` to rasterise pages for vision. This is why the loader drives
  Playwright against a Vite dev server rather than running in plain Node. A native port was
  **considered and rejected** — it forks the pipeline, which is the exact drift the loader's own
  design notes exist to prevent.
- **Every request runs as `anon`.** Role/grant gates cannot work; only `verified_uid()` body checks do.
  Admin RPCs call `assert_verified_admin(p_caller)`, which resolves identity from the JWT and requires
  `p_caller` to match it plus an active `admins` row. **You cannot call admin RPCs from a script with
  the anon key** — `pyq_questions` had to be cleared by the owner via the Supabase SQL editor.
- **`CORPUS_DIR`** must point at the folder whose children are `10 NCRT`, `11 NCRT SC`, etc. It is set
  persistently at the Windows User level to
  `C:\Users\THASLIM\Downloads\easy with exam-20260804T081444Z-1-001\easy with exam`.
  **If it is wrong the loader silently loads nothing and reports success.** This has cost time twice.
- **Concurrency is 1.** The org's OpenAI limit is 30,000 TPM and `max_tokens` is billed as *reserved*.
  Do not raise it without raising the org limit.
- **Hornbill's poems are unnumbered and live inside the prose chapter PDFs** (`A Photograph` is in
  `kehb101`; `The Laburnum Top` and `The Voice of the Rain` are both in `kehb103`). Any "one file, one
  chapter" rule that ignores this **rejects correct content**. See `20260812040000`'s comment.

---

## 5. Phase plan and current position

| # | Phase | State |
|---|---|---|
| **0** | Schema + contract audit, manifest format, fixtures from known failures | **DONE — owner approved** |
| **1** | Chapter identity core: manifest extraction + corroboration wiring | **DONE — committed, proven, applied to live — see §6c** |
| **2** | Study Notes write path + atomic `syllabus_nodes` upsert + preview UI | **not started — awaiting owner approval to begin** |
| 3 | Background job infra: queue, worker, idempotency, retry | not started |
| 4 | Status tab UI | not started |
| 5 | PYQ resolution + flagging UI | not started |
| 6 | Content Map + Library rewritten as pure views | not started |
| 7 | Taxonomy wiring (families, book scoping, literature granularity) | not started |
| 8 | Verification, pilot reload, full reload | not started |
| 9 | Student-facing exam UI rework (Part 4) — investigate & propose first | not started |

Estimate for phases 1–8: **24–33 working days**, deliberately not compressed.

**Process rules the owner set:** report and get explicit approval at every phase boundary; both-halves
verification (deny + permit) on every piece; commit as you go; **never push or deploy without explicit
instruction each time**; if a decision is genuinely ambiguous, stop and ask rather than guess.

---

## 6. Phase 0 deliverable (done)

- `src/lib/chapterIdentity.js` — ordinal-anchored `chapterKeyFor()`, the corroboration rules
  (`decideAssignments`), alias handling, and positional chunk assignment (`chapterForPage`).
- `src/lib/__tests__/chapterIdentity.test.js` — **17 tests, all passing.** Fixtures are the *actual*
  measured failures, not invented cases. Every rejection test names the row count it prevents.

Both halves are covered: each real failure is **rejected**, and the correct cases — including
Hornbill's interleaved poems, which a naive rule would wrongly reject — are **accepted**.

### Manifest format

```jsonc
{
  "examType": "CBSE Class 11",
  "subject": "English",
  "book": "Hornbill",          // null for single-book subjects
  "prefix": "c",               // "k" for Kerala
  "approvedBy": "…", "approvedAt": "…",   // owner approval is required before load
  "entries": [
    { "ordinal": 1, "title": "The Portrait of a Lady", "pageStart": 1,  "pageEnd": 12,
      "numbered": true,  "band": "reading" },
    { "ordinal": 7, "title": "A Photograph",           "pageStart": 13, "pageEnd": 14,
      "numbered": false, "band": "reading" }
  ]
}
```

`numbered: false` marks interleaved items (unnumbered poems). They have no printed chapter number and
no file of their own, so their identity is **positional only** — the manifest page range must fall
inside the host file's page span. `band` carries the sort_order banding convention already used
elsewhere (Reading Skills 1–99, Writing Skills 100–199; NEET uses 1–14 / 100–113 / 900+).

---

## 6b. Two owner requests captured mid-Phase-1, not yet built

Both arrived while Phase 1 code was in progress. Neither was built immediately —
building UI mid-phase would break the phase-gate process the owner set — but
both are now **decided design**, and the engine change for the first is already
committed.

1. **Admin chapter picker at upload.** The admin should be able to pick a
   file's chapter from the approved manifest at upload time, rather than
   relying only on automatic corroboration. Owner asked for "add chapter
   name"; scoped instead as a **picker over the approved manifest's entries**,
   never free text — free text is exactly how `Poorvi` and `Critical
   Reflection` got in. **Implemented, uncommitted — see §6c**: `decideAssignments()` in
   `chapterIdentity.js` takes `adminSelectedOrdinal`. A decisive human pick
   settles a numbered proposal outright (even overriding a model that proposed
   the wrong chapter), but does **not** override interleaved/positional
   entries — an admin picking "chapter 1" says nothing about which of chapter
   1's interleaved poems a chunk belongs to. An ordinal outside the manifest
   still throws; the closed set holds even for the admin path. Covered by 4
   tests in `chapterIdentity.test.js`. **The UI dropdown itself is Phase 2/3
   work** (Study Notes upload screen) — the engine is ready for it now.

2. **Medium as an admin-manageable category.** "Add medium in admin
   categories — English medium, Malayalam, etc." `src/admin/
   AdminCategorySettings.jsx` already manages `exam_categories` rows keyed by
   `category_kind` (`board` / `competitive`); a `medium` kind fits the same
   pattern. **Not built yet** — it depends on the `medium` schema column and
   the script/character-set + subject detection logic from Part 2 of the
   original spec, which comes after Part 1 (this phase) stabilises. Recorded
   here so it surfaces again when Part 2 starts rather than requiring the
   owner to re-ask.

3. **Onboarding needs board + medium + a Class-11/12 "stream", and the
   stream's subject combinations must be admin-manageable, not hardcoded.**
   This is bigger than item 2 alone — it's not just "which language", it's a
   third dimension between class and subject. Classes 8–10 aren't streamed
   (everyone takes the same core subjects), but 11–12 genuinely are: a
   student picks Science / Commerce / Humanities, and CBSE vs Kerala State
   don't even agree on how that choice works —
   [`docs/curriculum-streams-reference.json`](curriculum-streams-reference.json)
   is the owner-supplied reference, preserved verbatim, and it matters that
   the two boards differ structurally, not just in subject names:

   - **CBSE lets a student mix and match** inside a stream — Science has a
     mandatory core (English, Physics, Chemistry) plus a pool of options
     (Maths, Biology, Computer Science, Physical Education, Psychology), and
     "PCM" / "PCB" / "PCMB" are just the common *combinations* people pick
     from that pool, not the only legal ones.
   - **Kerala State uses closed, named combinations** instead — "Biology
     Science" (Physics, Chemistry, Biology, Mathematics) or "Computer
     Science" (Physics, Chemistry, Mathematics, Computer Science) are the
     entire choice; there is no pick-your-own-options step, and it requires
     **two** languages (English + a second language) where CBSE requires one.

   A model that treats "stream" as one flat list of subjects per board would
   be wrong for CBSE (loses the mandatory-core-vs-optional-pool structure)
   and wrong for Kerala (loses the closed-combination structure) in two
   different ways. This needs real schema/UX design, not a quick admin
   dropdown — **not built, not designed yet**. Belongs in Part 2/3 alongside
   medium, after Part 1 core stabilises. The reference JSON also covers
   8–10, where the CBSE/Kerala subject differences (combined Science vs three
   separate Science subjects; IT mandatory vs optional) matter for content
   tagging even though there's no streaming to model there.

## 6c. Phase 1 build state — code committed (`121b01e`), migration PROVEN, not yet applied anywhere

Owner decisions locked in before Phase 1 started: `chapter_manifests` is a real table (not JSON in the
repo), every book's manifest requires owner approval before load, `knowledge_base` gained a `book`
column while the tables were empty (2026-08-13 wipe), and a PYQ upload with no matching syllabus
escalates to the owner after **48 hours**.

**Files, all written, all passing, all committed:**

- `src/lib/chapterManifest.js` — `fileOrdinalFrom()` (the third corroboration signal, parses NCERT
  short codes and hand-named filenames), `validateManifest()` (structural checks — duplicate ordinals,
  overlapping page ranges, unreachable interleaved entries — that must pass before a manifest can be
  shown for owner approval), `candidatesForFile()`.
- `src/lib/manifestExtraction.js` — `draftManifestFromContentsPage()` draws a DRAFT manifest from a
  book's contents page using the same `extractPagesWithVision` + `chatComplete` pipeline as
  `runNotesExtraction`, so it doesn't fork the extraction path. `requireApprovedManifest()` is the gate
  every future per-file loader must call — refuses anything whose `status` isn't `'approved'`.
- `src/lib/chapterIdentity.js` — modified from Phase 0 to add the `adminSelectedOrdinal` signal (see
  §6b item 1): a picker-based owner override at upload time, engine-side only, no UI yet.
- `supabase/migrations/20260813020000_chapter_manifests.sql` — the `chapter_manifests` table, its
  partial unique index (one approved manifest per book; NULLs-are-distinct trap from `20260812040000`
  applies again, handled with `coalesce(book,'')`), `knowledge_base.book`, and two admin RPCs
  (`admin_upsert_chapter_manifest`, `admin_approve_chapter_manifest`) gated by `assert_verified_admin`
  exactly like the existing PYQ RPCs.
- `src/lib/__tests__/chapterManifest.test.js` (15 tests) and 4 new tests appended to
  `chapterIdentity.test.js` (now 21). **36 tests total for Phase 1, all passing.** Fixtures include the
  real corpus filenames (`kehb111.pdf` etc.) and the Hornbill Writing-Skills banding case, where the
  printed chapter number (1–6) and the filename number (11–16) genuinely differ — a naive
  `fileOrdinal === ordinal` rule would reject that whole section, and there's a test asserting it doesn't.

### The migration is PROVEN, not just statically checked

**A from-scratch local Docker rebuild is currently broken, for reasons that have nothing to do with
Phase 1.** `supabase start` replays the entire migration history from an empty database, and the very
FIRST migration (`20260806000643_flashcards_sm2.sql`) fails: it `ALTER TABLE`s `flashcard_progress`
assuming the table already exists, but nothing in the migration history creates it — the same
"created outside the migration history" gap already documented for `syllabus_nodes` in §4. This means
`supabase start` cannot currently do a clean rebuild **at all**, for any migration, not just this one.
Fixing that is real but separate infrastructure debt, out of scope here.

Instead, the migration was tested for real against the **live** schema, inside a transaction that was
**rolled back** — nothing persisted. This is arguably more trustworthy than a local replay would have
been anyway, since it's the actual target schema rather than a reconstruction. Method: `auth.jwt()`
reads the `request.jwt.claims` Postgres GUC, so a real authenticated-admin session was simulated with
`set local request.jwt.claims = '{"sub":"<real superadmin uid>","role":"authenticated"}'` inside the
transaction, letting the RPCs' actual success paths run, not just their rejection paths.

**17 assertions, all passing, both halves on every rule:**

- **DENY** (3 variants): no JWT at all → `Access denied: unverified caller`; a JWT `sub` that isn't an
  `admins` row → `Access denied`; a real admin JWT but a mismatched `p_caller` → `Access denied: caller
  mismatch`. All exactly the `assert_verified_admin` behaviour already proven for the PYQ RPCs, now
  confirmed for these two specifically rather than assumed by analogy.
- **PERMIT**: create a draft as a real superadmin, approve it — both succeed, `approved_by`/
  `approved_at` populate correctly.
- **Immutability**: editing the now-approved manifest is rejected (`... approved manifests are
  immutable`).
- **Empty-manifest rejection**: approving `entries: []` is rejected.
- **Not-found handling**: approving a random uuid is rejected with `manifest % not found`.
- **Supersession**: a second approved manifest for the same book flips the first to `superseded` and
  leaves exactly one `approved` row.
- **The load-bearing one — raw constraint enforcement, not just RPC courtesy**: a THIRD draft for the
  same book was approved by **directly `UPDATE`ing its status, bypassing the RPC's supersession logic
  entirely**. Postgres itself rejected it: `duplicate key value violates unique constraint
  "chapter_manifests_approved_uniq"`. The index protects even if a future bug — or someone editing data
  by hand — skips the RPC.
- **The `coalesce(book,'')` NULL trap, specifically**: two single-book (`book IS NULL`) manifests for
  the same subject were created and approved in sequence. If the coalesce weren't working, Postgres
  would treat the two `NULL`s as distinct and both would sit `approved` — this is the exact bug pattern
  `20260812040000` already had to work around once. Confirmed: the second correctly supersedes the
  first.
- **Two different books do NOT conflict** (Hornbill and Woven Words both approved simultaneously).
- **Schema**: `knowledge_base.book` column exists, `kb_exam_subject_book_idx` exists, RLS is enabled on
  `chapter_manifests` with exactly one policy (`SELECT`, i.e. read-open/write-closed as designed).

Verified clean after rollback: `chapter_manifests` table, the `book` column, and both RPCs are all
**absent** again; `admins` still exactly 2 rows; `knowledge_base` still 0. Nothing leaked out of the
transaction.

### Applied to live and independently re-verified (2026-08-13)

Owner said "in live" explicitly — this is a real deploy, done on that instruction, not assumed. Applied
via `npx supabase db push`. The push command printed a scary-looking warning about a missing certificate
file, but that's the CLI's own post-push catalog-*caching* step failing, a separate concern from whether
the DDL itself ran — **did not trust "Finished" on its own**, verified independently the same way
everything else in this document was verified:

- `supabase migration list` shows `local` and `remote` now match for `20260813020000`.
- Direct schema query confirms: `chapter_manifests` exists (**0 rows** — nothing polluted it), the
  `book` column and its index exist on `knowledge_base`, both RPCs exist, the partial unique index
  exists, RLS is enabled with exactly the one `SELECT` policy. `admins` still exactly 2 rows,
  `knowledge_base` still 0 — nothing else was touched.
- **The one gap flagged above is now closed.** Fired real anon HTTP requests at the live table, since it
  now actually exists for another connection to see: anon **can** read it (`GET` → 200, as designed);
  anon **cannot** insert directly (`POST` → 401, `new row violates row-level security policy`); anon
  **cannot** call `admin_upsert_chapter_manifest` (`POST` → 401, `permission denied for function`).
  That last one is worth noting precisely: it's blocked at the `REVOKE`/grant level, before
  `assert_verified_admin` even runs — anon cannot attempt the call at all, which is a stronger guarantee
  than relying on the runtime identity check alone. No `HACK` row landed under any of these attempts
  (`count=exact` → `0`).

**Phase 1 is DONE.** Code committed (`121b01e`, `f4f5d5d`, `f9abbab`), migration proven twice — once
against a rolled-back transaction (17 assertions covering the RPC logic, immutability, supersession, and
the raw constraint) and once for real against live (schema + anon-boundary checks) — and now live.

**Deliberately not built in Phase 1, on schedule for Phase 2/3:**
- The manifest **approval UI** (where the owner reviews a draft and clicks approve) — belongs with the
  Study Notes upload screen, since it's the same admin surface.
- The chapter-picker dropdown for `adminSelectedOrdinal` (§6b item 1) — engine's ready, UI isn't.
- Local Docker testing remains blocked by the unrelated `flashcard_progress` replay gap. Not fixed, not
  needed now that live verification covers Phase 1, but still worth fixing before it blocks something
  later — recorded here so it isn't rediscovered from scratch next time it matters.

---

## 7. Open questions — RESOLVED (kept for history; see §6c for the decisions in force)

All four were answered by the owner before Phase 1 started:

1. Manifest approval granularity → **every book's manifest**, no exception.
2. Where manifests live → **`chapter_manifests` table**, not JSON (needs to be queryable at runtime
   and carry the approval workflow as stateful data).
3. PYQ queue-and-wait → **escalates to the owner after 48 hours** with no matching syllabus.
4. `knowledge_base.book` → **added**, in `20260813020000`, while the table was empty.

No open questions remain for Phase 1 as scoped. New ones will accrue here as later phases raise them.

## 8. Known bugs still open

1. `src/admin/AdminContentLibrary.jsx` — `examTagFilter` crash. **Fixed and verified, committed.**
   Was a stale identifier from refactor `f93677a`; crashed *every* KB-view render, not just Kerala.
2. `src/pages/ExamCenterPage.jsx:219` — **`EXAM_QTYPES` is not defined.** Same crash class, still open.
   `defaultQTypesFor` is imported from `../lib/examPattern` and looks like the intended source.
3. Political Science "Equality" contamination — moot (data wiped). The new design prevents the class
   structurally: `keps101` choosing ordinal 3 against filename ordinal 1 is **rejected, not written**.
   Covered by a passing test.

## 9. Live database: full wipe, 2026-08-13

**Read the warning at the top of this file first if you haven't.**

This was a *separate, deliberate* owner instruction, unrelated to the Phase 0 content-tables wipe
documented in §1. It happened mid-Phase-1, while testing whether the `chapter_manifests` migration
should be verified against a real Postgres before being trusted.

### What was asked, and how the scope was resolved

The owner's first instruction — "clear all data in the live, except user account" — was **not acted on
immediately**. It covers 62 tables with wildly different blast radii (real user accounts vs. platform
config vs. an audit log), and a wrong reading would have been destructive and irreversible with no
backup taken. A clarifying question was asked (`AskUserQuestion`, four scope presets) before touching
anything. The owner interrupted that question with a more precise, more sweeping instruction: **"clear
all, only keep the super admins in the table, nothing else needed."**

That was executed as: **wipe every row in every `public`-schema table except `admins`**; `admins` itself
gets zero changes. Confirmed first that both existing `admins` rows already had `role='superadmin'`, so
nothing needed to be added or removed from that table — it truly is untouched, not filtered-and-kept.

### A mistake caught before it mattered, recorded so the pattern isn't repeated

The first inventory query (`query_to_xml`-based per-table row counts) reported **55 tables**. A second,
independent method (plain `information_schema.tables` count) reported **62**. Rather than trust either
number, a third method was used — a `plpgsql` loop with **per-table exception handling**, so a query
that fails on one table cannot silently vanish from the result set the way the first method did. That
confirmed **62 tables, zero errors**, and *that* number is what both the before- and after-counts below
are built from. **Lesson for future work in this repo:** `query_to_xml`-style dynamic per-table
aggregation over `information_schema.tables` can silently drop tables with no error surfaced. Don't
trust it for anything where completeness matters — use explicit per-table `EXECUTE` inside a
`BEGIN/EXCEPTION` block instead.

### Foreign-key safety check, done before executing

`TRUNCATE ... CASCADE` on 61 tables at once risks cascading into a table you meant to protect, if that
table is reachable via any FK path. Checked first: **zero foreign keys touch `admins` in either
direction.** It is fully isolated at the schema level, so nothing else could pull it into the cascade,
and it could not pull anything else in either.

### Execution

A single dynamic statement, built from a live `information_schema.tables` query at execution time (not
a hand-typed table list, which could drift from what's actually there):

```sql
do $$
declare v_tables text;
begin
  select string_agg(format('public.%I', table_name), ', ')
    into v_tables
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'admins';
  execute format('truncate table %s restart identity cascade', v_tables);
end $$;
```

Run via `npx supabase db query --linked --file ...` — the Supabase CLI, linked to the live project,
using a connection that bypasses RLS entirely (not the anon key; this is why `pyq_questions` could not
be cleared by the app's anon key earlier in §1 but could be cleared this way here).

### Before / after (both counted with the exception-safe method — no table could have hidden here)

| | Before | After |
|---|---|---|
| Total tables (`public` schema) | 62 | 62 |
| Rows in `admins` | 2 | **2 — unchanged** |
| Rows everywhere else | 2,272 (across 61 tables) | **0** |
| Query errors during counting | 0 | 0 |

`admins` verified **byte-identical** on `uid`, `role`, `is_active`, `email` for both rows
(`info@acenzos.com`, `thaslimshajahans@gmail.com`, both `superadmin`/active) — not just "still 2 rows",
the actual values were re-read and diffed after the wipe.

### Consequence — the live site is very likely broken right now

Everything the running app depends on to function for a visitor is gone: `exam_categories` (the
board/class/subject catalog), `feature_flags`, `quota_config`, `platform_settings`, `email_templates`,
`plan_config`, `onboarding_category_display`. There are also zero rows in `users`, so nobody is
currently a recognised account holder except the two admins. This was the explicit, understood
consequence of the scope the owner chose — not a surprise side effect — but any session picking this
work up needs to know the live app is not in a demoable state until platform config is reseeded, and
should not assume "the live site works" as a baseline fact anymore.

### Not yet decided / not yet done

- **Reseeding platform config** — nothing has been reseeded. `exam_categories`, `feature_flags`, etc.
  are all still at 0 rows as of this writing. Whether/when that happens is the owner's call.
- **Whether this was in preparation for testing the new content engine on a truly clean live DB**, or a
  broader relaunch reset, was not stated explicitly. Worth confirming with the owner rather than
  assuming either.
- **Update, same day:** the Phase 1 migration (`20260813020000`) has since been applied to live — see
  §6c. `exam_categories`/`onboarding_category_display` have also since been reseeded, and
  `exam_categories` gained a `streams` column via a second migration (`20260813030000`) — see §10. This
  bullet is kept for history; don't take "still empty" as current fact for those tables.

## 10. Baseline platform config restored + streams data seeded, 2026-08-13

Separate from the Phase 1 migration. Owner reported "not seeing anything" in Admin Categories and
onboarding after the §9 wipe. Investigated rather than assumed a single cause, because the two screens
are NOT the same situation:

- **Admin Categories renders the real `exam_categories` table directly, by design** — an editing tool
  showing fake fallback content would be actively misleading. Seeing nothing there was 100% the expected
  consequence of the wipe, not a bug.
- **Onboarding has an explicit hardcoded fallback** (`FALLBACK_EXAM_OPTIONS`/`BOARD_OPTIONS`/
  `CLASS_OPTIONS` in `src/lib/onboardingOptions.js`) specifically meant to survive an empty DB. Confirmed
  by direct anon RPC call that `get_onboarding_options()` correctly returns `[]` (HTTP 200, no error),
  which is exactly the condition `if (error || !data?.length) return; // keep hardcoded fallback` is
  written to handle — so onboarding showing *something* was expected too. The owner then confirmed
  onboarding was in fact showing the fallback data; the real ask was to seed REAL data so it stops
  relying on the fallback, and to fold in the curriculum-streams reference from §6b item 3.

### What was restored

Read the ACTUAL save logic in `AdminCategorySettings.jsx` first rather than guess at the row shape —
`category_kind` has three values in practice (`board`, `board_class`, `competitive`), never `class`; a
board save fans into one standalone row plus seven `board_class` rows (one per class 6–12) using the
6–10 or 11–12 subject tier. Seeded through the REAL RPCs (`admin_upsert_exam_category`,
`admin_upsert_onboarding_option`), with a simulated authenticated-admin session (same `request.jwt.claims`
technique as §6c), content mirroring `FALLBACK_CATEGORIES` / `FALLBACK_*_OPTIONS` exactly — those hardcoded
fallbacks ARE the app's own definition of the intended baseline, not a separate guess.

- **`exam_categories`: 39 rows** — 4 boards (CBSE, ICSE, State Board, Kerala State) × (1 standalone + 7
  class combos) = 32, plus 7 competitive exams (NEET, JEE Main, JEE Advanced, CUET, UPSC, SSC CGL,
  Olympiad).
- **`onboarding_category_display`: 13 rows** — 5 exam options, 2 board options, 6 class options,
  matching the fallback's exact keys so a student's saved profile resolves identically regardless of
  which source (DB or fallback) happened to answer when they onboarded.

### The streams data — added as real structure, not flattened

Migration `20260813030000_exam_categories_streams.sql`: additive, nullable `streams jsonb` column on
`exam_categories`, same precedent as `book` (`20260812040000`/`20260813020000`) — NULL for every row
that isn't Class 11/12, nothing existing affected.

**Deliberately not stored in `subjects text[]`.** A flat list would erase exactly what makes the
owner's reference data (`docs/curriculum-streams-reference.json`) worth having: CBSE's mandatory-core +
options-pool structure, and Kerala's closed named combinations, are genuinely different shapes, not the
same data formatted differently. Populated on exactly 4 rows (`CBSE Class 11`, `CBSE Class 12`,
`Kerala State Class 11`, `Kerala State Class 12`) via direct `UPDATE`, not through
`admin_upsert_exam_category` — that RPC has no `p_streams` parameter yet, and adding one now would build
an editing surface nothing calls, since there is no admin UI or onboarding step that reads this column
yet. That UI is still Part 2/3 work (§6b item 3), unchanged by this seed.

### Verified through the real client-facing paths, not just by reading rows back

- `categories.js`'s exact query (`select exam_key,label,category_kind,board_key,class_key,group_label,
  subjects,sort_order … eq('is_active',true) … order('sort_order')`) fired via anon key: 200, 39 rows,
  all 4 boards and all 7 competitive exams present.
- `get_onboarding_options()` fired via anon key: 200, 13 rows, all three `option_type`s present with the
  exact keys `OnboardingPage.jsx` expects (`NONE`/`NEET`/`JEE_MAIN`/`JEE_ADVANCED`/`BOTH`,
  `CBSE`/`KERALA_STATE`, `8`–`12`/`REPEATER`).
- Streams spot-checked on all 4 target rows (right top-level keys present, including
  `mandatory_languages` appearing ONLY on the Kerala rows — the exact structural asymmetry the source
  data has, not accidentally uniform) and confirmed `NULL` on a non-target row (`CBSE Class 8`).
- Full sanity pass on tables NOT touched by this work: `admins` still 2, `knowledge_base` still 0,
  `chapter_manifests` still 0, `study_notes` still 0 — nothing leaked outside its intended scope.

### One unexpected-looking but benign finding

`public.users` went from 0 (post-§9 wipe) to **2** during this work, without either seed script touching
that table. Checked rather than assumed: both rows are `info@acenzos.com` and
`thaslimshajahans@gmail.com`, `created_at` timestamps inside this session's timeframe. This is
`AuthContext`'s own self-healing logic (`if (!profile) { profile = upsertUser(...) }`, found while
investigating the original "not seeing anything" report) firing for real — an admin opened the live app
during this session, their Firebase auth session found no matching `public.users` row, and the app
recreated one automatically. Confirms that self-healing path genuinely works, not a bug and not
something this session caused directly.

402 tests pass, build clean (this work was schema + data only, no application code changed).

## 11. Stream selection onboarding — Part 1 done, Parts 2-4 not started

Owner spec'd the full feature (stream selection UI for Class 11/12, save format, downstream consumption,
admin preview, a fallback-visibility signal). Part 1 was "verify the data shape before coding, don't
assume" — done, and it caught real gaps.

### What Part 1 found

Pulled the actual seeded `streams` JSON (not memory) and compared against the owner's stated model.
Found the §10 seed did NOT support the required UI:

- **CBSE mandate mismatch.** Owner's model: English is the ONLY mandatory subject, system-wide; the
  other 4 are a free pick from a pool. The seeded data instead baked extra subjects into a PER-STREAM
  `mandatory_core` — Science forced Physics+Chemistry, Commerce forced Accountancy/Business
  Studies/Economics. Only Humanities already matched.
- **Kerala Commerce wasn't in "combination block" shape** — used the CBSE-style mandatory/options split,
  not the `combinations` array-of-named-blocks shape Science already had, even though the owner's model
  says Kerala uses closed named blocks uniformly across all three streams.
- **Two fields were prose strings, not arrays** (CBSE Humanities' `options`, Kerala Humanities'
  `combinations`) — unusable for a card/radio UI.

### What was fixed, and what's deliberately still open

**Fixed, verified, committed** — CBSE (both classes) restructured: single `mandatory: ["English"]`,
each stream's forced subjects moved into a real `elective_pool` array (Science's pool now genuinely
includes Physics/Chemistry as PICKS, not requirements — a student can still assemble PCM/PCB/PCMB from
the pool, they're just no longer forced), Humanities' string converted to an array. Kerala Science
renamed `combinations` → `combination_blocks` for shape consistency; content was already correct.
Verified via the real anon client read path (not just reading rows back), and confirmed the full 39-row
`exam_categories` count didn't move.

**Deliberately NOT touched: Kerala Commerce and Humanities.** No authoritative source exists for their
real named combination blocks — the owner's own `curriculum-streams-reference.json` only had Science's
two named blocks; Commerce/Humanities were given as a flat list in the source itself. Inventing
plausible-sounding Kerala block names would be fabricating a curriculum fact a student would rely on.
Owner chose (via `AskUserQuestion`, not assumed): **they will supply the real block data** before this
gets built out, rather than a placeholder or a Science-only ship. Their `commerce`/`humanities_arts`
entries are unchanged from the original §10 seed, still in the old shape, until that data arrives.

### Parts 2-4: not started

Full onboarding step UI, `users.academic_track` column + save-path wiring, `useStudentScope()` /
Practice Generator / Syllabus page consumption, `stream_selection_enabled` flag + fallback nudge, admin
preview panel, and the Part 4 changelog-on-empty-RPC + admin banner signal — none of this is built yet.
Waiting on: (a) the owner's Kerala Commerce/Humanities data, (b) explicit go-ahead to start Part 2, per
the phase-gate process this whole rebuild has followed. CBSE's full flow and Kerala's Science flow have
clean data now and are unblocked whenever Part 2 starts; Kerala's other two streams will need whatever
graceful "not yet available" UI state Part 2 design settles on, or a follow-up once their data lands.

402 tests pass, build clean (data-only change).
