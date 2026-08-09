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

### Decision still needed from the owner

Whether the student practice path should be gated behind reviewed content, or
continue serving unreviewed generated questions with the validation now in place.

---

## OPEN — `pyq_questions` is empty, blocking Phase 2 §3 and §4b

`pyq_questions` has **0 rows**. Blueprint V2's 20-PYQ threshold
(`questionGen.js`, `pyqTotal >= 20`) is therefore unreachable for all 11
exam+subject combinations, and `chapter_pattern_stats` / `technique_frequency`
would aggregate nothing.

This is a **content task, not a code task**: past papers need ingesting through
the existing Content Intake PYQ path. Roughly 20 published questions per
exam+subject to cross the threshold (~220 total), or fewer if one or two subjects
are targeted first to prove the pipeline.

The 186 `exercise` chunks now tagged in `knowledge_base` are real,
chapter-attributed questions and are the closest available substitute — but they
are textbook exercises, not past-year papers.

---

## OPEN — `runPYQExtraction` reserves `max_tokens: 16000`

Over half the org's entire 30,000 TPM budget in a single reserved call. This is
the same hazard that cost two files during the corpus load (see CHANGELOG session
15) — latent on the question-paper extraction path, untouched so far.

---

## OPEN — org OpenAI TPM limit is 30,000

Very tight for this workload. Raising it is an account-level change only the
owner can make, and it is the durable fix for the rate-limit pressure that made
the corpus load take multiple passes.
