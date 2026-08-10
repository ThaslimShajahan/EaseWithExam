# Action Items

Standing list of things that are open, blocked on the project owner, or knowingly
shipped in a degraded state. The narrative of what changed and why lives in
`docs/CHANGELOG.md` — this file is the "what's still wrong" ledger.

---

## NEET PYQ bulk load — file audit, decisions, and judgment calls (2026-08-10)

Every one of the 20 PDFs in `easy with exam/PYQ/` was **opened and identified**,
not trusted by filename. md5 for exact duplicates, first/middle-page text for
subject and year, chars-per-page for text-layer usability. The manifest in
`scripts/bulk-load-pyq.mjs` is explicit for this reason — globbing the folder
would have double-loaded.

### The three unnamed / duplicated groups you flagged

| file | what it actually is | decision |
|---|---|---|
| `2393a308-…`, `…(1)`, `…(2)` | **all three byte-identical** (md5 `ac4a0bb1…`). NEET **2024**, Test Booklet Code G, 200 Qs, **all subjects**, clean text layer (2,715 ch/pg) | load **one**, skip the other two |
| `c9b2c6eb-…` | NEET **2025 [Code-45]**, 180 Qs + solutions, all subjects, 2,781 ch/pg | load |
| `original (2)/(3)/(4)` | NEET **2026** (held 3 May 2026) — Physics / Chemistry / Biology respectively | load all three |

### JUDGMENT CALL — combined papers supersede four scanned per-subject files

`2024+Bio` (78 ch/pg), `2024+Chemistry` (311 ch/pg), `Physics …Code-45`
(84 ch/pg) and `Chemistry …Code-45` (42 ch/pg) are **scans of the same exams**
the two combined papers already carry with a clean text layer. Loading both sets
would duplicate every question in them.

Decided: **skip the four scans, use the combined papers.** This also avoids ~28
vision calls, and the combined papers additionally supply the **2024 Physics** and
**2025 Biology** sections, which have no named file at all. Risk accepted: NEET
paper codes reorder questions but do not change them, so no distinct question is
lost by preferring one code over another.

### DECISION NEEDED — NEET 2024 has 198 good questions but NO answer key

`2393a308-…` turned out to be a **question-only test booklet**: 2 "Ans" markers
in 66,276 characters, no answer-key section, no solutions. Its 198 questions and
their chapter attribution are good (197/198 snapped, subject split 50/48/100
matching NEET's real structure) — but it cannot supply answers.

The extractor nonetheless returned 45 `correct_answer` values. **They were not
read from a key; they were inferred**, and it shows: the distribution contained
option *text* rather than letters — `"Succinyl-CoA → Succinic acid"`,
`"( ) 2 1 x kcalm yr − −"`, `"A - IV , B - I , C - II, D - III"` — with zero
explanations, and Chemistry produced none at all.

**All 198 were set to `correct_answer = NULL`.** This project has already
measured 10% hard-wrong keys from model inference, and a wrong key marks a
correct student wrong *and* corrupts their `weak_topics` diagnostics. An honest
null is strictly better.

**The open question, for you:** the two skipped 2024 files
(`2024+Bio Paper With Answer and Solution`, `2024+Chemistry Paper With Answer and
Solution`) are scans whose titles claim answers **and solutions**. Loading them
would supply real keys for ~148 of the 198 — but they cover only Chemistry and
Biology, and they carry the same questions already loaded, so loading them
naively **duplicates** those questions and skews Blueprint V2's chapter
weighting.

Three ways forward, none obviously right, so none taken:
1. **Leave it.** 2024 contributes questions and chapter distribution only. The
   other five years supply the answer keys. Zero risk, zero work.
2. **Replace the 2024 load.** Delete the booklet rows; load 2024 Chemistry and
   Biology from the named scans (real keys), and 2024 Physics from the booklet's
   Physics pages alone — `pageRange` now supports this (`[2, 7]`). Costs ~30
   vision calls and loses answer keys for Physics only.
3. **Verify first.** Load one named 2024 scan to a throwaway `source` and check
   whether its key actually survives OCR before committing to option 2.

Option 3 then 2 is the careful path; option 1 is defensible given launch timing.

### No 2018 papers are present

You mentioned 2022 and 2018. The folder holds **2021, 2022, 2023, 2024, 2025 and
2026** — there is no 2018 file. Nothing was dropped; it simply is not there.

### JUDGMENT CALL — PYQ batching resized twice, from measurement (affects CBSE too)

`PYQ_BATCH_CHARS` **12,000 → 5,000**, `PYQ_MAX_TOKENS` **5,000 → 6,000**.

**First cut (12,000 → 9,000)** came from NEET density: 515 bytes/question output,
366 source chars/question at the densest. It also materially improved recall,
which was not the intent — **2021 Physics went from 37 questions to 50**, the
paper's true count, so the old batch size had been silently losing ~26% of
questions on this shape.

**Second cut (9,000 → 5,000, cap 5,000 → 6,000)** came from a real failure, not a
projection: 9,000 threw the truncation guard on 2021 Biology batch 2/4. That
batch carried ~25 questions and blew past 5,000 output tokens, so **Biology runs
200+ tokens/question** — the earlier ~130 figure came from Physics and Chemistry,
whose stems are short and options symbolic. Biology stems and explanations are
prose, and prose is where the estimate broke.

Sized against the worst case actually observed (220 tokens/question): 5,000 chars
→ ~16 questions → ~3,560 tokens against a 6,000 cap, 41% clear. `max_tokens` went
*up* despite the TPM cost because this guard throws the whole **file**, not one
batch — that asymmetry is worth ~1 call/min. Net ~7,250 tokens reserved per call,
about 4 calls/min against the org's 30,000 TPM.

**Verification method worth reusing:** expected question counts were established
independently by counting question-number markers in each PDF's text layer
(NEET numbers Physics 1-50, Chemistry 51-100, Biology 101-200), giving a real
denominator for coverage instead of trusting the extractor's own count.

### Bug found and fixed mid-run — the branding filter ate real content

`MOTION` and `PW` were in the institute-brand strip list. **"Motion" is a core
physics word.** The first 2021 Physics load came back with *zero* questions
containing it, in a paper whose chapters include "Laws of Motion", "Motion in a
Plane" and "Motion in a Straight Line". Those 37 rows were deleted and the file
re-loaded. The list now carries only unambiguous brand tokens; `PW` and `Motion`
match only alongside app-store chrome (`PW Website`, `Motion Education`).
`BANSAL` was dropped too — it is a surname.

**Institute names are never recorded.** `exam_type` is `NEET`, plus subject and
year; `source` is a synthetic key (`pyq:neet-<year>-<subject>`), never the
filename.

---

## ⚠ DO NOT APPLY ALONE — `20260810070000_match_kb_exam_type_array.sql`

**Apply this migration and deploy the client in the SAME window. Never one
without the other, in either order.** It is written and tested but deliberately
**not applied**.

### Why applying it alone breaks production

The migration changes `match_knowledge_base`'s `filter_exam_type` from `text` to
`text[]`. A parameter type change cannot be `CREATE OR REPLACE` (42P13), so the
old signature is **dropped**. The live client still sends a bare string for that
argument. Apply the migration without shipping the client and every semantic
retrieval call starts failing on a type mismatch — question generation and the
Ask-EWE knowledge lookup both go through it.

The reverse is equally broken: ship the client without the migration and it sends
an array to a function still declared `text`.

### Safe order

1. Apply the migration (`supabase db push`)
2. Deploy the client build **immediately after**, in the same session

There is a brief window between the two where retrieval is degraded. It is small,
and it is unavoidable given a signature change — but it means this should be done
deliberately, not folded into an unrelated deploy.

### What it is for

NEET/JEE reading the Class 11+12 corpus (Option B, below). Client side is already
written: `src/lib/examMapping.js` plus three call sites (`questionGen.js:662`,
`questionGen.js:727`, `supabase.js:243`). Build passes, 161 tests pass.

**Nothing about the NEET PYQ upload depends on this.** Upload needs
`syllabus_nodes`, which is seeded. This only widens what generation can retrieve.

---

## RESOLVED 2026-08-10 — `study_notes.unit` repeated the chapter title on 81 rows

Applied via `supabase db push` (`20260810060000_clear_self_referential_note_units.sql`)
and verified after the fact: 181 rows unchanged, 179 → 98 with a unit, **81
cleared, the 3 protected rows intact by ID**, 95 genuine-unit rows across 65
distinct unit names untouched. Kept here rather than moved to the changelog only
because the `NOT EXISTS` guard below is a live constraint on anyone editing this
later.

The cosmetic problem: `unit` exists to GROUP notes into a table of contents, so a
unit whose only member is a chapter of the same name rendered as a Study Hub /
Admin accordion section of exactly one item, repeating its own title twice.

Measured against production before writing it: **84 rows had `unit = chapter`,
81 cleared, 3 deliberately preserved.** Those 3 are real NCERT units that
happen to be named after their own opening chapter and have sibling chapters
under them — `Number Play` (CBSE 10 Maths, 3 siblings), `Locomotion and Movement`
(CBSE 11 Biology, 1), `Proportional Reasoning` (CBSE 8 Maths, 1). A plain
`UPDATE ... WHERE unit = chapter` would have evicted those three from units that
genuinely exist, orphaning the intro chapter into "Other Notes" while its
siblings stayed grouped — worse than the cosmetic problem being fixed. Hence the
`NOT EXISTS` guard. **Don't simplify it back down.**

Source of the dirt is `runNotesExtraction`'s prompt ("Unit name if this content
is part of a numbered/named unit, else null") — a bulk-loaded NCERT PDF *is* one
chapter, so the model answers with the chapter title instead of null, and
`scripts/backfill-study-notes.mjs` copies it through, so a future corpus load
would reintroduce it. **Now fixed at source too** — `dropSelfReferentialUnits()`
in that script carries the same sibling guard. Verified against the real 4,363-row
corpus: it clears the same **81** and preserves the rest.

---

## OPEN — Generated question answers are unverified (measured 2026-08-10)

**Severity: high.** Generated questions reach students with no correctness check
of any kind. A wrong answer key doesn't just misinform — the student is marked
wrong for being right, loses the XP, and the result feeds `weak_topics` accuracy,
so a bad key corrupts their diagnostics too.

### What the pipeline does today

A repo-wide search for `verifyAnswer`, `validateQuestion`, `answer_verified`,
`solution_check` and any `verify*`/`validate*` function in `questionGen.js`
returns **nothing**. The only gate is structural (`toEngineFormat`): does the
question have text, and does an MCQ have ≥2 options. **Nothing inspects the
answer key at all.**

Two paths, very different exposure:

| path | flow | review |
|---|---|---|
| **Student** (`PracticeGeneratorPage.jsx:895`) | `generateQuestionPaper()` → `toEngineFormat()` → live quiz | **none** |
| **Admin** (`AdminPaperGen.jsx:1138`) | generate → render → admin clicks Publish | visual only, not required or recorded |

`CONTENT_REVIEW_QUEUE` does **not** cover this — it gates `extractPYQFromKB` and
Content Intake, and is never consulted in `generateQuestionPaper`.

### Measured rate — 30 questions, real pipeline, hand-checked

Generated through the actual `generateQuestionPaper` (Class 10 Mathematics ×15,
Class 11 Physics ×15), every answer verified by hand.

- **10% hard-wrong keys** (3/30) — a correct student is marked wrong
- **10% flawed questions** (3/30) — key defensible but more than one option is correct
- **80% clean** (24/30)

The three wrong keys, which are three *different* failure modes:

| # | question | key | actual |
|---|---|---|---|
| 2 | one zero of `2x² + 7x + k` is 3, find k | −12 | **k = −39**, not among the options at all |
| 3 | hypotenuse² = 400, which two sides? | 20, 15 | 400+225=625 — **no option satisfies a²+b²=400** |
| 14 | mean of 5 is 20, remove one, mean 18 | 30 | its own explanation says "100 − 72 = **28**" |

**Answer-position skew** — a distinct defect from correctness:

```
Class 10 Maths   A=9  B=6  C=0  D=0    ← not one C or D in 15 questions
Class 11 Physics A=6  B=5  C=2  D=2
Combined         A=15 B=11 C=2  D=2  →  50% / 37% / 7% / 7%
```

Always guessing "A" scores ~50%.

### Post-fix re-measurement (same benchmark, 30 fresh questions)

Fixes shipped: key-vs-explanation cross-check (soft flag), option shuffling,
hard-drop on an unparseable key. Re-ran the identical benchmark.

| | before | after |
|---|---|---|
| answer position A/B/C/D | 50% / 37% / 7% / 7% | **33% / 30% / 20% / 17%** |
| hard-wrong keys | 3/30 (10%) | 4/30 (13%) — 1 caught and withheld → **3/28 (11%) served** |
| flagged for review | — | 2/30, of which **1 true positive, 1 false positive** |
| dropped for bad key | — | 0 (all keys parseable this run) |

**Option shuffling works and is the clear win.** The A/B monopoly is gone; a
student guessing "A" no longer scores ~50%. Assertion-Reason ladders and a
"Both A and C" option were correctly left unshuffled by the ordered-options
guard.

**The cross-check does NOT measurably reduce the wrong-key rate**, and the
earlier claim that it would catch the Q2/Q3/Q14 failure modes was wrong — it
only catches the Q14 class, where the key disagrees with its own explanation.
Post-fix evidence:

- **Caught (true positive):** *"flywheel at 1200 rpm, angular speed?"* — key
  `20π`, explanation correctly derives `2π × 1200/60 = 40π`. Withheld from the
  student path.
- **False positive:** *"right triangle, one angle is 45°, the other is?"* — key
  `45°` is correct, but the explanation only mentions 180 and 90, so they share
  no number. A good question was withheld.
- **Missed (the dominant mode):** *"10th term of AP 2, 5, 8"* — key `31`,
  explanation states `2 + 9 × 3 = 31`, which is arithmetically false (=29).
  Explanation and key agree with each other and are both wrong, so no
  logic-only check can see it. Same for a cylinder volume keyed `231` when
  `πr²h = 198`.
- **Missed via partial overlap:** scale-factor question keyed "increase by 1/3"
  with an explanation saying "4/3" — the shared digit `3` satisfied the check.

Net: the cross-check has ~50% precision and catches roughly a quarter of wrong
keys, at the cost of withholding some sound questions. It is worth keeping
because it is free, but **it does not close this gap.** Closing it needs
semantic verification (second-model pass or symbolic evaluation).

### Still open after the 2026-08-10 fixes

- **Numericals are unmeasured.** That benchmark run produced 28 MCQ + 2
  Assertion-Reason and **zero Numericals**, so the category with no structural
  filter whatsoever was never exercised. A separate ad-hoc test did produce a
  wrong numerical answer (20 J stated, 50 J correct). The 10% figure is for MCQs;
  numericals are plausibly worse and remain unquantified.
- **Semantically wrong keys that agree with their own explanation** (Q2, Q3
  above) are not caught by logic-only validation — the explanation is internally
  consistent and simply wrong. Catching these needs either a second-model
  verification pass or symbolic evaluation, both of which have their own cost and
  error rate.
- **Admin publish still records no reviewed state.** `handlePublish` re-runs
  `toEngineFormat` and ships; there is no "an admin actually checked this" flag.

### PARKED: semantic verification — measured, costed, ready to wire in

Prototyped against the same 30 questions and scored on the 4 hand-verified wrong
keys. One `gpt-4o` call per question: re-solve from scratch, then compare.

| | gpt-4o | gpt-4o-mini |
|---|---|---|
| tokens/question | 146 in, 40 out | 146 in, 45 out |
| median latency | **1.34 s** (p90 1.67 s) | 1.37 s |
| caught of 4 known-wrong | 2 | 2 |
| false positives | **1** | 3 |

- **Cost ≈ $0.0008/question (~8¢ per 100)** at ~$2.50/1M in + $10/1M out —
  confirm against current OpenAI pricing before relying on it.
- **Runs at generation time, comfortably.** Generating 15 questions already takes
  52–119 s; verification is ~1.3 s/question and parallelises, so 15 questions at
  concurrency 5 is ~4 s — under 5% added wall-clock, and 186 tokens × 15 is
  nothing against the 30,000 TPM ceiling. Failures can be flagged `needs_review`
  and filtered by the machinery already shipped in session 17.
- **Use gpt-4o, not mini** — identical recall, three times the false positives.
- **Recall is only ~50% alone**, and the verifier is itself wrong at roughly the
  generator's rate (it insisted `a = 30 m/s ÷ 10 s` was 5 m/s²). But it is
  **complementary** to the free cross-check, which caught the flywheel item the
  model missed: **combined recall ≈ 75%**, at the cost of ~2 sound questions
  withheld per 30.
- **Effort: ~40 lines and about an hour**, reusing `needs_review` and the student
  path filter.

**Parked deliberately** (2026-08-10) because there are no real students yet —
the platform is still dev/testing. **Revisit before any real student launch:** an
11% wrong-key rate on a path that awards XP *and* writes `weak_topics` accuracy
teaches the platform to recommend the wrong revision topics, and that error
compounds silently.

### Decision still needed from the owner

Whether the student practice path should be gated behind reviewed content, or
continue serving unreviewed generated questions with the validation now in place.

---

## PARKED (post-launch) — geometric figure cropping: audited, premise corrected, plan ready

Audited 2026-08-10, **deliberately not started** — parked behind launch. Read this
before picking it up, because the audit **disproved the plan that was written
down** in `src/lib/pdfVision.js:71-73` and `CHANGELOG` ("derive figure rectangles
by tracking the CTM through `paintImageXObject`"). That approach finds nothing on
this corpus. The replacement is below.

Why it matters: today `CROP_FROM_MODEL_BBOX = false`, so every figure's image is
the **whole page**, shared by every figure on it. That was the right call (5 of 5
model bboxes were materially wrong) but it is coarse, and tight per-figure crops
are what a curated figure library actually needs.

### Finding 1 — `paintImageXObject` finds ZERO figures. The documented plan fails.

Every NCERT page paints exactly two rasters, and **neither is a figure**:

| raster | rect (normalised) | what it is |
|---|---|---|
| `img_pN_1` | `{x:-0.012 y:-0.05 w:1.024 h:1.1}` | full-bleed page background |
| `img_pN_2` | `{x:0.096 y:0.246 w:0.782 h:0.594}` | the diagonal "© NCERT not to be republished" watermark |

Both repeat to 4 decimal places on **every** page — which is also the cheap
discriminator for furniture. The real figures are **vector line art**, invisible
to every `paintImage*` op. Verified by rendering pages in a real browser and
drawing the derived rects over them, not by counting ops.

### Finding 2 — the right source is `constructPath`, and pdfjs 6 hands it over free

`constructPath` args in pdfjs 6 are `[opsFlags, coords, minMax]`, where `minMax`
is a `Float32Array [minX, minY, maxX, maxY]` in **user space** — a per-path
bounding box at no cost. `CTM x minMax` gives the exact page rect. The CTM walk
itself (`save`/`restore`/`transform`, seeded from `viewport.transform`) is
straightforward and was verified correct.

### Finding 3 — a scratch prototype produced genuinely tight crops

Real NCERT Class 11 Physics ch. 4 (`keph104.pdf`):

| page | result |
|---|---|
| 5 | 1 candidate — **tight, correct crop of Fig 4.3** (cricketer), no false positives |
| 7 | 2 candidates — **tight, correct crop of Fig 4.5** (train), **+1 false positive** (stacked display equations) |

Against the model bboxes' **0 for 5**. The false positive is a characterisable
class, not random noise.

### Finding 4 — naive clustering fails, and the fix is the whole trick

The first prototype merged the **entire page into one cluster**: an equation's
fraction bar, a tinted callout border and a table rule each sit within the merge
gap of the next thing, so the union walks the whole column. What made it work was
pre-filtering the *bridging* paths **before** merging:

- a path whose own box is mostly covered by glyphs is **inside a line of text**
  (fraction bars, underlines) — not a figure
- hairline rules (long, ~0 tall) and vertical rules
- anything ≥85% of the page (furniture)

Merge gap must stay small (~1.2% of page width): NCERT is two-column and a
generous gap jumps the gutter and unions both columns into one "figure".

### Finding 5 — scanned PDFs degrade correctly

`_pilot/scanned-paper.pdf`: one raster covering the page, zero paths. Geometry
yields exactly one whole-page rect — i.e. today's behaviour. **No regression
risk on scans.**

### Proposed plan (~1 day)

**Step 0 — widen the sample first (~1h).** Two pages of one Physics chapter is
not enough to set thresholds. Sample across Maths / Science / Biology and score
by *looking* at the crops. This is the step that caught the last failure.

**Step 1 — new `src/lib/pdfGeometry.js` (~3–4h).** Pure and unit-testable, no
canvas needed (operator list + text layer only). Raster and vector sources,
cross-page repeat detection for furniture, the text-aware pre-filter, then
clustering.

**Step 2 — pair geometry WITH the model, don't replace it (~2h).** The measured
evidence says the model is reliably right about *how many* figures there are and
*what* they show (captions were consistently accurate) and unreliable about
*where*; geometry is exactly the reverse. So match the model's figure list onto
the geometric candidates and crop from the matched rect, falling back to the page
image when there is no confident match. Behind a new `CROP_FROM_GEOMETRY` flag,
default off. `CROP_FROM_MODEL_BBOX` stays off permanently.

**Step 3 — pilot, look at every crop, then decide the default (~1h).**

### Known risks

Display-equation false positives; the two-column gutter; Hindi and non-STEM PDFs
were not audited at all. Scans are safe (Finding 5).

---

## FOLLOW-UP (gated) — use chapter_pattern_stats to STEER generation, not just score it

Today the stats measure a paper after it is generated. Steering means feeding the
measured chapter / type / marks mix into generation so the paper is built to
match, rather than graded against it afterwards.

**Level 1 — extend the existing allocation. ~2–3 hours.** Blueprint V2 already
computes `blueprintAllocation` (chapter → target count) and injects it into the
prompt. The same mechanism can carry target *type* and *marks* mixes from
`chapter_pattern_stats`, so the ask becomes "6 questions on Circles, of which 3
MCQ at 1 mark and 3 Case-Based at 4 marks". Low risk: it reuses proven plumbing,
and `pattern_match` gives an immediate before/after read.

*(Level 2, per-chapter generation batches, ~1–2 days, multiplies API calls by
chapter count and runs into the 30,000 TPM ceiling. Level 3, over-generate and
select the best-matching subset, ~3–5 days. Neither is worth scoping further
until Level 1 has been tried.)*

**GATED ON: a second paper per subject** (see below). Steering makes the
generator imitate the measured pattern *harder*, which is only an improvement if
the pattern is right. It currently rests on one paper per subject — steering hard
toward a sample of one would faithfully reproduce 2025's particular emphasis,
quirks included, and present it as "the exam pattern". A confident wrong answer
is worse than the current honest-but-loose behaviour.

---

## OPEN — a second paper per subject is needed, for two separate reasons

Everything Phase 2 §3/§4b now computes rests on **one paper per subject, two
subjects, one year** — 34 Class 10 Mathematics + 53 Class 10 Science questions
from 2025. A second paper each is the cheapest thing that improves it, and it
settles two distinct questions at once.

**1. It firms up the stats.** `chapter_pattern_stats` currently reports a single
paper's chapter mix as if it were the subject's pattern. One paper is a sample of
one: CBSE rotates emphasis year to year, so a chapter carrying 6 questions in
2025 may carry 2 in 2024. Blueprint V2 and `pattern_match` both allocate and
score against that single sample. Two papers roughly halves the variance; three
to five would make year-over-year trend analysis possible at all (see the
deferred `year` axis).

**2. It settles the over-spreading question** (detailed below) — whether the
closed chapter list is being treated as a vocabulary or as a quota.

**What to upload:** one more CBSE Class 10 Mathematics and one more Class 10
Science board paper, any year other than 2025, through Admin > Content Intake
with the same settings. Nothing needs re-running afterwards; the view is live and
recomputes on read.

---

## OPEN — check chapter over-spreading when more papers are uploaded

`runPYQExtraction` now hands the model a **closed list** of syllabus chapters and
requires it to copy one exactly. That took chapter snapping from 86–87% to 100%
and eliminated invented chapters entirely (0 of 87 questions outside the
syllabus, against 11 of 83 before).

The risk it introduces: **forcing a choice from a list can make the model spread
questions across it** rather than concentrate them where the paper actually
concentrates. Both re-run papers came out covering *every* chapter in their
syllabus — 14/14 Mathematics, 13/13 Science.

That is plausible for CBSE, which samples broadly, and the distributions are
naturally skewed rather than uniform (Science 8, 8, 6, 6, 5, 4, 4, 3, 3, 2, 2,
1, 1; Mathematics keeps a clear 6/5/4/4 head), so this is a watch item, not a
known defect.

**What to check when a second paper per subject is uploaded:** whether chapters
that genuinely carry no questions in that paper still come back with 1–2. If they
do, the closed list is being treated as a quota rather than a vocabulary, and the
prompt needs an explicit "not every chapter will appear; leave a chapter out
rather than forcing a question into it".

This matters because Blueprint V2 allocates generation proportionally to these
counts — an artificially flattened distribution produces an artificially flat
paper.

---

## RESOLVED 2026-08-10 — `pyq_questions` was empty, blocking Phase 2 §3 and §4b

Two 2025 CBSE Class 10 board papers are loaded (34 Mathematics + 53 Science
questions, all `published`, all chapter-attributed). **Blueprint V2's 20-question
threshold now passes for both**, the first time it has been reachable for any
exam+subject.

**Still thin, and it constrains what can be built on top:**

| axis | state |
|---|---|
| `chapter` | 100% populated, snapped to syllabus — **usable** |
| `question_type` | 6 real values (MCQ 33, Short Answer 24, Long Answer 11, Case-Based 9, Assertion-Reason 6, Numerical 4) — **usable** |
| `marks` | 5 real values (1, 2, 3, 4, 5) — **usable** |
| `section` | A–E, real spread — **usable** |
| `year` | **single value (2025)** — no year-over-year trend is possible |
| `difficulty` | **single value ("Medium")** — hardcoded in `savePYQRows`, carries zero information |
| `techniques` | **column does not exist** on `pyq_questions` |
| `correct_answer` | **0 of 87** — neither board paper shipped an answer key |

Only 2 of 11 exam+subject combinations have any PYQ data at all. Class 11 remains
empty and, having no board exam, has no real past-year papers to source — see the
NEET/JEE decision above.

---

## DECISION NEEDED — how NEET/JEE relates to the CBSE Class 11 corpus

Not urgent, but it blocks the PYQ work that actually serves the product, so it
wants deciding before NEET papers are sourced rather than after.

### The problem

The platform is positioned as NEET/JEE prep, and NEET's syllabus *is* Class 11 +
12 Physics, Chemistry and Biology. **1,531 Class 11 Physics/Chemistry/Biology
chunks are already loaded** — the right content, tagged for a different exam.

Everything joins on `exam_type + subject`:

- `match_knowledge_base(filter_exam_type, filter_subject, …)`
- Blueprint V2: `.eq('exam_type', examType).eq('subject', subject)`
- `syllabus_nodes`, `study_notes`, `getStudyChapters()` — all the same key

So NEET PYQs tagged `exam_type: 'NEET'` will **not** see a single one of those
1,531 chunks. Blueprint V2 would compute a NEET allocation with no NEET
knowledge base behind it, and §4a's type-filtered retrieval would return nothing
for NEET.

CBSE Class 10 is unaffected — corpus, syllabus and PYQs all share
`'CBSE Class 10'`. This only bites the Class 11 slice.

### Options

**A. Re-tag the Class 11 corpus as NEET.**
Cheapest to execute (an UPDATE over ~1,531 rows plus their `study_notes`), and
everything joins immediately. But it *loses* the CBSE Class 11 identity — a
Class 11 board/school user would then find nothing, and JEE (Physics, Chemistry,
Maths — no Biology) still wouldn't join. Rules out serving both audiences from
one corpus.

**B. Mapping layer at query time.**
Keep the corpus tagged `'CBSE Class 11'` and resolve a NEET query to the set
`['NEET', 'CBSE Class 11', 'CBSE Class 12']` before hitting the DB.
`match_knowledge_base` already takes `filter_exam_type` as a scalar, so this
needs the RPC widened to `text[]` (it already does exactly this for
`filter_content_type`), plus a small `examTypesFor(examType)` helper used by the
retrieval call sites. Preserves both identities, serves NEET and JEE from one
corpus, and is the only option that survives adding Class 12. Most code, but the
code is small and mostly already patterned.

**C. Dual-tag rows.**
Add a `exam_types text[]` alongside `exam_type` and write both. Avoids touching
query logic much, but introduces two sources of truth for the same fact and
every existing `.eq('exam_type', …)` in the app becomes subtly wrong.

**D. Load NEET PYQs and NEET-specific content separately.**
Treat NEET as its own vertical with its own corpus. Honest and simple, but
duplicates ~1,500 chunks of identical NCERT content and doubles ingestion cost
for every future chapter.

### Read — recommend B, and it is much smaller than first scoped (sized 2026-08-10)

**B, but only its minimal slice: the knowledge_base retrieval path.** Sized by
counting real call sites rather than estimating — of **26** `.eq('exam_type', …)`
filters in `src/`, only **five** touch the NEET → Class 11 join:

| site | table |
|---|---|
| `match_knowledge_base` (migration: `filter_exam_type text` → `text[]`) | `knowledge_base` |
| `questionGen.js:720` | RPC call |
| `supabase.js:235` | RPC call |
| `questionGen.js:662` | `knowledge_base` keyword fallback |
| `questionGen.js:769` | `study_notes` verbatim passages |

The RPC change is a copy of the `= ANY()` pattern `filter_content_type text[]`
already uses in the same function. Everything else is untouched: `syllabus_nodes`
(8 sites) now has its own NEET rows, and NEET PYQs carry `exam_type: 'NEET'`, so
`pyq_questions` (6), `topic_frequency`, `chapter_pattern_stats` and `important_qa`
all resolve correctly with no change. **~2–3 hours, not a day.**

Three things settle it against A:

1. **Subject filtering already separates NEET from JEE, for free.** NEET is
   Physics/Chemistry/Biology, JEE is Physics/Chemistry/Mathematics, and every
   query filters subject as well as exam_type. One Class 11 corpus serves both —
   Class 11 Mathematics (394 chunks) never reaches NEET, Biology (386) never
   reaches JEE. A cannot do this: re-tagging Phy/Chem/Bio as NEET leaves JEE with
   nothing and strands Class 11 Mathematics.
2. **The pattern already exists in the codebase.** `examTypeCandidates()`
   (`src/lib/syllabus.js:18`) already resolves one logical exam to several
   exam_type values (`CBSE Class 10` → `CBSE` + class_level). `examTypesFor()` is
   the same idea, not a new concept.
3. **A is not actually faster.** It is a destructive UPDATE over 1,531 rows plus
   their `study_notes`, after which nothing records which rows were originally
   Class 11, so it is effectively one-way.

C and D unchanged from the original read.

### RESOLVED — Class 12 and pre-rationalisation chapters seeded (Tier 3, 56 rows)

NEET is Class 11 **+ 12**, and the papers being uploaded are 2018 and 2022 —
both predating the 2023-24 NCERT rationalisation, so they also ask about chapters
the current books no longer contain. `scripts/seed-neet-static-chapters.mjs`
added 56 rows on top of the 43 corpus-derived ones: Class 12 current (37),
Class 11 legacy (9), Class 12 legacy (10). **NEET now has 99 chapters**, no
duplicate `(subject, chapter_key)`, and the original 43/43 corpus join is intact.

**These names are NOT corpus-derived** — they are NCERT chapter titles, reviewed
by the project owner before the script was run. There is **no content behind
them**: a syllabus row makes a chapter name available to `matchSyllabusChapter()`,
it does not create `knowledge_base` chunks. Retrieval for Class 12 will find
nothing until Class 12 content is actually loaded. The win is clean chapter
*attribution* on the PYQs.

Legacy rows are `is_active = true` **on purpose** — `getChapters()` filters on it
and Content Intake snaps against exactly that list, so an inactive row is
invisible to snapping and the whole exercise would be pointless. The cost is that
students see ~19 chapters with no content, so every non-current chapter carries a
high `sort_order` (bands: Class 12 current 100+, Class 11 legacy 900+, Class 12
legacy 950+) and lands at the bottom of every picker.

### Known: two corpus-vocabulary artifacts, deliberately NOT renamed

`Discovery of Sub-Atomic Particles` (Chemistry) is a section of NCERT's
"Structure of Atom", and Biology carries both `Locomotion and Movement` and
`Skeletal System`, the latter being a section of the former. These are the
corpus's own chapter names. **Renaming them in AdminSyllabus would break the
join** unless `knowledge_base.chapter` is renamed in the same transaction —
syllabus and corpus must agree for chapter snapping to reach the chunks.

### Pre-existing bug now reachable — flashcard decks collide on `chapter_key`

`get_user_flashcards(p_uid, p_chapter_key)` filters on `firebase_uid` +
`chapter_key` and **not subject**. NEET Physics and NEET Chemistry both have a
`Thermodynamics` chapter and both slugify to `c11_thermodynamics`, so a student's
flashcards for the two would merge into one deck. The subject-less key format is
generated by `AdminSyllabus` itself, so this is a design-level pre-existing issue,
not something the seeding introduced — but seeding both subjects made it
*reachable* for the first time. Blast radius today is that single shared chapter
name. Correct fix is to add a subject filter to the RPC (small migration); not
done, launch-adjacent.

---

## RESOLVED 2026-08-10 — `runPYQExtraction` reserved `max_tokens: 16000`

Over half the org's entire 30,000 TPM budget in a single reserved call — the same
hazard that cost two files during the corpus load. Fixed by measuring instead of
guessing: 30 real questions serialised into this extractor's own schema come to a
median 354 chars (~90 tokens) each, so a 38-question board paper is ~3,500 output
tokens. Now `PYQ_MAX_TOKENS = 5000` with `PYQ_BATCH_CHARS = 12000`, dropping
per-call reservation from ~20,000 to ~8,600. Added a `finish_reason === 'length'`
guard, which matters more here than for notes: a truncated response silently
drops questions off the end of a paper while the upload still reports success.

---

## OPEN — org OpenAI TPM limit is 30,000

Very tight for this workload. Raising it is an account-level change only the
owner can make, and it is the durable fix for the rate-limit pressure that made
the corpus load take multiple passes.
