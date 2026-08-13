# Content Platform Rebuild — Handoff

**Read this first if you are picking this work up with no memory of the conversation that started it.**
You have the repo and this file. That is enough. Everything below is either verifiable in the repo
or was measured against the live database and recorded here.

Last updated: 2026-08-13, end of Phase 0.
Branch: `nonstem-stage-a-taxonomy` (50+ commits ahead of `origin/main`, **never pushed**).

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
| **0** | Schema + contract audit, manifest format, fixtures from known failures | **DONE — awaiting owner approval** |
| 1 | Chapter identity core: manifest extraction + corroboration wiring | not started |
| 2 | Study Notes write path + atomic `syllabus_nodes` upsert + preview UI | not started |
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

## 7. Open questions for the owner

1. **Manifest approval granularity** — approve every book's manifest before load (as stated), or only
   when corroboration fails? Currently built assuming *every book*.
2. **Where manifests live** — a new `chapter_manifests` table, or JSON committed to the repo? Affects
   Phase 1. Not yet decided.
3. **PYQ queue-and-wait** — how long does a PYQ upload wait for a syllabus before it escalates?
4. Whether `knowledge_base` should finally gain a `book` column. `20260812040000` deliberately deferred
   this pending evidence of a real within-subject name collision. **The audit found none** among loaded
   books — but the tables are empty now, so adding it is free, and it would close the risk permanently.

## 8. Known bugs still open

1. `src/admin/AdminContentLibrary.jsx` — `examTagFilter` crash. **Fixed and verified, committed.**
   Was a stale identifier from refactor `f93677a`; crashed *every* KB-view render, not just Kerala.
2. `src/pages/ExamCenterPage.jsx:219` — **`EXAM_QTYPES` is not defined.** Same crash class, still open.
   `defaultQTypesFor` is imported from `../lib/examPattern` and looks like the intended source.
3. Political Science "Equality" contamination — moot (data wiped). The new design prevents the class
   structurally: `keps101` choosing ordinal 3 against filename ordinal 1 is **rejected, not written**.
   Covered by a passing test.
