# Action Items

Standing list of things that are open, blocked on the project owner, or knowingly
shipped in a degraded state. The narrative of what changed and why lives in
`docs/CHANGELOG.md` — this file is the "what's still wrong" ledger.

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

### Read

**B is the only option that doesn't paint you into a corner**, and the RPC
already has the array-filter pattern to copy. A is tempting for speed but throws
away the CBSE audience and still fails JEE. D is defensible only if NEET content
will genuinely diverge from NCERT.

**Note Class 12 is entirely absent from the corpus** — NEET is Class 11 + 12, so
whichever option is picked, roughly half the NEET syllabus still isn't loaded.

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
