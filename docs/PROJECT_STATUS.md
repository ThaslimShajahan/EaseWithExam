# EaseWithExam — Project Status

**As of 2026-08-11.** Internal reference. Written for someone with no prior
context: no shorthand is used without explaining it, and nothing here is
softened for presentation.

Everything below was verified against the production database, the live site and
the git repository at the time of writing, not recalled from memory. Where a
number could not be verified, that is said explicitly.

---

## 1. What the platform is

EaseWithExam is an exam-preparation web app for Indian school and medical/
engineering-entrance students. A student signs in, says which board and class
they are in (CBSE Class 8–12) or which entrance exam they are targeting (NEET for
medical, JEE for engineering), and the app generates practice question papers for
them on demand using an AI model, grounded in real NCERT textbook content that
has been loaded into the system. It also provides study notes extracted from
those textbooks, an AI doubt-solving tutor, flashcards with spaced repetition,
and progress tracking. Admins have a separate portal for uploading textbook PDFs
and past exam papers, editing the syllabus, and generating and publishing papers.

---

## 2. Architecture

### Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite, installable as a PWA (offline-capable web app) |
| Auth | Firebase Authentication (Google sign-in and email) |
| Database | Supabase (managed PostgreSQL) with `pgvector` for semantic search |
| Access control | PostgreSQL Row Level Security, with Firebase registered as a third-party auth provider so the database can verify a user's identity |
| AI | OpenAI `gpt-4o` and `text-embedding-*`, called through a Supabase Edge Function (`ai-proxy`) so the API key is never in the browser |
| Hosting | A VPS at `31.97.67.30`, served from `~/htdocs/www.easewithexam.com/` |
| CI | GitHub Actions — builds, runs tests, checks database migrations are in sync. **It does not deploy.** |

### Key tables

- **`knowledge_base`** — the textbook corpus, split into passages ("chunks") with
  a vector embedding each. This is what the AI retrieves from when writing
  questions or answering doubts.
- **`study_notes`** — one row per chapter, the human-readable notes shown to
  students. Built from the same source material as `knowledge_base`.
- **`pyq_questions`** — "PYQ" means *previous year question*: real questions from
  past exam papers. Used to measure what real exams actually ask.
- **`syllabus_nodes`** — the controlled list of chapter names per exam and
  subject. Critically, this is the vocabulary that everything else snaps to; if a
  chapter name is not in this list, content tagged with it becomes invisible to
  chapter-based features.
- **`chapter_pattern_stats`** — a database *view* (computed on read, never stale)
  that summarises which chapters real past papers emphasise.
- **`feature_flags`** — runtime on/off switches, changeable without a deploy.
- **`published_tests`**, **`subscriptions`**, **`users`**, `flashcards`,
  `weak_topics`, etc. — student-facing state.

### Ingestion pipeline (how content gets in)

1. An admin uploads a PDF (a textbook chapter, or a past exam paper) through
   Admin → Content Intake. There are also headless scripts for bulk loading.
2. Text is extracted with `pdf.js`. If a page's text layer is unusable — a
   scanned page, essentially an image — the page is rendered and sent to a vision
   model to be transcribed. Pages with good text are never overwritten.
3. The extracted text goes to an AI structuring pass that splits it into chapters
   and passages, or into individual questions for an exam paper.
4. Every chapter name the model produces is **snapped to the closed list** in
   `syllabus_nodes`. This one constraint took chapter accuracy from ~86% to 100%
   and eliminated invented chapter names.
5. Passages are embedded and written to `knowledge_base`; questions are written
   to `pyq_questions`; chapter notes to `study_notes`.

### Generation pipeline (how a practice paper is made)

1. The student picks subject, topic, difficulty, question count and question
   types.
2. The system retrieves relevant textbook passages by semantic similarity, and
   pulls real past questions for the same subject as style references.
3. For exams with enough past-paper data, chapter allocation is weighted by what
   real papers actually emphasise (internally called "Blueprint V2").
4. `gpt-4o` writes the questions in batches.
5. Validation, in layers:
   - questions with an unparseable answer key are **dropped**;
   - answer options are **shuffled**, so the correct answer isn't
     disproportionately "A";
   - a free consistency check compares the keyed answer against the numbers in
     its own explanation and flags disagreements;
   - a second AI pass can independently re-solve each question and flag
     disagreements — **currently switched off**, see §8.
   - Anything flagged is withheld from students but still shown to admins.
6. Questions that describe a figure get an SVG diagram generated for them.

### Deploy process

Manual, and documented in full in `docs/DEPLOY.md`. Summary: build locally, tar
`dist/`, copy over SSH to the VPS, extract with `--no-overwrite-dir`, `chmod`
files to 644, verify the live bundle hash over HTTPS. Pushing to GitHub does
**not** deploy anything.

---

## 3. Data currently in production

Counts read directly from the production database on 2026-08-11.

### Totals

| Table | Rows |
|---|---|
| `knowledge_base` | 4,377 |
| `study_notes` | 181 (all published) |
| `pyq_questions` | 1,217 |
| `syllabus_nodes` | 268 |
| `chapter_pattern_stats` (view) | 125 |
| `content_figures` | 32 |
| `topic_frequency` | 0 (unused) |
| `feature_flags` | 14 |

`users` and `published_tests` return 0 rows to the anonymous key, but Row Level
Security hides those tables from anonymous access — **these are not confirmed to
be zero** and should be checked with an admin credential.

### `knowledge_base` — textbook corpus, by class and subject

| Exam / class | Subject | Chunks |
|---|---|---|
| CBSE Class 8 | Mathematics | 427 |
| CBSE Class 8 | Science | 321 |
| CBSE Class 9 | Mathematics | 214 |
| CBSE Class 9 | Science | 522 |
| CBSE Class 10 | Mathematics | 254 |
| CBSE Class 10 | Science | 345 |
| CBSE Class 11 | Physics | 569 |
| CBSE Class 11 | Chemistry | 576 |
| CBSE Class 11 | Biology | 386 |
| CBSE Class 11 | Mathematics | 394 |
| CBSE Class 11 | Biotechnology | 369 |

**There is no Class 12 content at all.** This matters a great deal — see §5.

### `pyq_questions` — real past exam questions

| Exam | Subject | Questions | With answer key | Years |
|---|---|---|---|---|
| NEET | Biology | 571 | 468 (82%) | 2021–2026 |
| NEET | Physics | 292 | 240 (82%) | 2021–2026 |
| NEET | Chemistry | 267 | 215 (81%) | 2021–2026 |
| CBSE Class 10 | Science | 53 | 0 | 2025 |
| CBSE Class 10 | Mathematics | 34 | 0 | 2025 |

NEET total: **1,130 questions across six years**. The CBSE papers carried no
answer key in the source document, so those 87 questions have none.

### `syllabus_nodes` — chapter vocabulary

| Exam | Subject | Chapters |
|---|---|---|
| NEET | Biology | 39 |
| NEET | Chemistry | 30 |
| NEET | Physics | 30 |
| CBSE Class 11 | Biology | 20 |
| CBSE Class 11 | Biotechnology | 20 |
| CBSE Class 11 | Physics | 14 |
| CBSE Class 11 | Mathematics | 14 |
| CBSE Class 11 | Chemistry | 9 |
| CBSE Class 10 | Mathematics | 14 |
| CBSE Class 10 | Science | 13 |
| CBSE Class 9 | Science | 14 |
| CBSE Class 9 | Mathematics | 8 |
| CBSE Class 8 | Mathematics | 26 (16 active) |
| CBSE Class 8 | Science | 13 |
| CBSE Class 8 | English | 4 |

**Total 268 rows**, up from 141 — Classes 8 (Science), 9 and 11 were seeded from
the corpus on 2026-08-11.

NEET's 99 chapters cover Class 11, Class 12, and chapters that were removed from
NCERT textbooks in the 2023 syllabus revision but still appear in the older
papers we loaded. 52 are tagged `class_level` 11 and 47 are tagged 12.

**CBSE Class 12 still has no syllabus rows**, because it has no corpus to derive
them from — see §5. Chapter-based features remain degraded for Class 12.

**Class 8 Mathematics holds 26 rows but only 16 are active.** The 10 leftovers
from the old NCERT chapter list were deactivated (`is_active = false`) on
2026-08-11 rather than deleted, so the change is reversible via
`scripts/deactivate-stale-c8-maths-syllabus.mjs --reactivate`. The 16 active
names match the loaded *Ganita Prakash* corpus exactly — the book's 14 real
chapters plus 2 section-level names from a duplicate ingestion of Chapter 1.
Note deactivated rows do not show in Admin → Syllabus, which filters on
`is_active`.

**Class 8 English's 4 rows have no corpus** behind them either (0 chunks loaded).

### `study_notes`

| Exam | Chapters |
|---|---|
| CBSE Class 11 | 77 |
| CBSE Class 10 | 49 |
| CBSE Class 8 | 33 |
| CBSE Class 9 | 22 |

---

## 4. What works today

### For a student

- Sign in with Google or email; onboarding captures class, board and target exam.
- **Generate a practice paper on demand** — pick subject, topic, difficulty,
  count (5–90) and question types. Questions are grounded in real textbook
  content and styled on real past papers.
- **Generate a full mock test in the background** and get an in-app notification
  when it's ready, rather than waiting on a loading screen.
- **Take a test** with a timer, per-question marks, and negative marking that
  matches the real exam's rules.
- **Paper Mode** — a printable exam-paper layout, including rendered figures.
- **Study notes** browser, organised by chapter.
- **Ask EWE** — an AI doubt tutor that retrieves relevant textbook passages
  before answering, so answers are grounded rather than invented.
- **Flashcards** with SM-2 spaced repetition.
- **Progress tracking** — weak topics, score prediction, streaks, XP, badges,
  shareable progress certificates.
- Referral codes, in-app and email notifications, PWA install.

### For an admin

- Upload textbook PDFs or past papers, including scans (transcribed by a vision
  model) and whole Google Drive folders.
- Edit the syllabus chapter list per exam and subject.
- Generate and publish question papers, review every question with its answer
  and explanation before publishing, and attach real figure images.
- Content Map — a coverage tree showing which chapters have content and which
  are empty.
- Manage students, coaching centres and invites; edit email templates; toggle
  feature flags.

### Verified live after today's deploy

Semantic retrieval works; a NEET query now correctly reaches Class 11 textbook
content; CBSE Class 10 retrieval is unaffected; the doubt tutor's lookup works;
student generation works; CBSE full papers still contain all their sections.

---

## 5. Known limitations — stated plainly

### Generated answer keys are wrong about 1 in 10 times

Hand-checking 30 generated multiple-choice questions found **4 wrong answer keys
(13.3%)**. With the validation currently switched on, roughly **10% of questions
a student receives still carry a wrong key.** A student who answers correctly is
marked wrong, loses the XP, and the mistake feeds their "weak topics" analysis —
so a bad key also teaches the platform to recommend the wrong revision.

A second AI verification pass exists and cuts this to ~7.4%, but it is
**deliberately switched off** for launch to avoid an extra API call per question.
Switching it on is a feature-flag change, no deploy needed.

All four wrong keys were in Class 10 Mathematics; all 15 Class 11 Physics
questions checked were correct. The errors concentrate in arithmetic and algebra.

### Numerical-answer questions are worse, and barely generated

34 numerical questions checked: **5 wrong (14.7%)**. Worse, the free consistency
check is structurally blind to them — it compares the keyed *option* against the
explanation, and numerical questions have no options — so it flagged **0 of 34**.

Separately, asking for numerical questions on a CBSE exam returns **none**: the
generator substitutes CBSE's own section types and silently discards the request.
Some numericals are also ill-posed for their own type — e.g. a probability of 7/8
stored as the answer "7".

### Half of the NEET syllabus has no textbook content behind it

NEET covers Class 11 **and Class 12**. There are **zero Class 12 chunks** in the
corpus. Chapter names for Class 12 are seeded, so questions attribute correctly,
but there is no source material to generate from or to ground the doubt tutor
with. In practice NEET generation leans on Class 11 content and the model's own
knowledge for everything else.

### JEE is effectively unsupported in terms of data

There are **no JEE past papers loaded at all**, and no JEE syllabus rows. JEE
queries will read the shared Class 11 corpus (Physics, Chemistry, Mathematics)
but have no exam-specific pattern data. The app offers JEE as an option; the data
behind it is thin.

### 198 NEET 2024 questions have no answer key

The 2024 source was a question-only booklet with no key. The extractor produced
45 answers anyway, which were inferred rather than read — they were deleted. The
questions and their chapter attribution are good and still contribute to pattern
analysis; they just cannot be used as answerable practice.

### Figures are whole pages, not cropped figures

Figure extraction stores the **entire page image** for every figure on it. An
attempt to crop using AI-reported coordinates was measured at 5 out of 5 boxes
materially wrong and abandoned. A geometric approach has been researched and
prototyped successfully but not implemented. A student clicking a figure sees the
whole textbook page it came from.

### Question types are not fully honoured on CBSE

A CBSE student selecting "MCQ only" will still sometimes receive Short and Long
Answer questions, depending on paper size (clean at 5, 10 and 45 questions;
leaks at 20 and 30). Two prompt instructions contradict each other. Cosmetic
rather than harmful, but the interface promises something the generator doesn't
always deliver.

### Payments are not ready

Razorpay checkout is wired in the browser, but required server functions and
secrets are not fully configured. A previously-flagged vulnerability — the
payment webhook accepting unsigned events and granting free premium — **is fixed
in source** (it now rejects when the signing secret is absent), but whether the
*deployed* function matches the source has not been verified. **Verify before
accepting real payments.**

### Other

- **Flashcard decks can collide.** Chapter keys don't include the subject, so
  NEET Physics "Thermodynamics" and NEET Chemistry "Thermodynamics" share one
  deck.
- **OpenAI rate limit is 30,000 tokens/minute**, which is tight. It caused
  multi-pass failures during bulk loading and constrains large generations.
- **CBSE Class 12 has no syllabus rows** (no corpus to derive them from), degrading chapter features there. Classes 8, 9 and 11 were seeded 2026-08-11.
- **Class 11 Biotechnology** (369 chunks) is loaded but isn't a NEET or JEE
  subject — it is unused weight.
- **No admin "reviewed" state.** Publishing doesn't record that a human checked
  the questions.
- **CBSE pattern data is one paper per subject** (2025 only), so its pattern
  analysis is weakly grounded compared to NEET's six years.

---

## 6. Open items, by priority

Full detail is in `docs/ACTION_ITEMS_FOR_YOU.md`; this is the summary.

### Before or at launch

| Item | Why it matters |
|---|---|
| **Verify the Razorpay webhook deployment** | Payments cannot be trusted until the deployed function is confirmed to reject unsigned events and the secret is set. |
| **Decide when to switch answer verification on** | Currently off. Turning it on cuts wrong keys served from ~10% to ~7%, at ~$0.0008 and ~1.3s per question. Flag change, no deploy. |
| **Watch first real traffic** | NEET question content changed materially today; generation latency and paper composition are worth observing. |

### Shortly after launch

| Item | Why it matters |
|---|---|
| **Load Class 12 textbook content** | The single biggest content gap. Half the NEET syllabus has no source material. |
| **Raise the OpenAI rate limit** | Account-level change; removes a persistent operational constraint. |
| **Seed syllabus rows for CBSE 9, 11, 12** | Cheap; restores chapter features for classes that already have content. |
| **Load JEE past papers** | JEE is offered but has no exam-specific data. |

### Deliberately parked (post-launch)

| Item | Note |
|---|---|
| Closing the residual ~7% wrong-key rate | Needs symbolic/algebraic checking, not another AI pass — every miss so far was the verifier agreeing with a wrong key. Explicitly not to be attempted before 14 Aug. |
| Geometric figure cropping | Researched and prototyped; produces tight crops. ~1 day of work. |
| Ill-posed numerical questions | Needs a generation-prompt change. |
| Answer verification in the admin portal | Admins publish without the verifier's opinion. |
| Question-type filtering for CBSE papers | Needs the section-structure instruction to respect the type selection. |
| Steering generation by measured exam patterns | Currently patterns only *score* a paper after generation. NEET now has enough data to steer; CBSE does not. |
| Recovering NEET 2024 answer keys | Optional; needs OCR of scanned answer sheets. |
| Flashcard deck collision | Needs a subject filter in one database function. |

---

## 7. Deploy status

Everything is consistent as of writing — no gap between what's live, what's
built, and what's in version control.

| | |
|---|---|
| Live site | https://www.easewithexam.com/ |
| Live bundle | `assets/index-CrZjys3H.js` |
| Local build | `assets/index-CrZjys3H.js` — **matches** |
| `main` branch | `06cbb36` |
| `origin/main` | `06cbb36` — **in sync**, 27 commits pushed today |
| Working tree | clean |
| CI | **green** on `06cbb36` — the first successful run in this repository's history |
| Database migrations | all applied; none pending |

Today's deploy applied a breaking database change (a search function's parameter
changed type) together with the client that uses it, in one window. The site was
knowingly degraded for the few minutes between them.

**Rollback available:** server-side backup at
`~/deploy-backups/webroot-2026-08-10-192409.tar.gz` (3.4 MB, 287 files), and
`supabase/rollback/20260810070000_rollback.sql`. Restore the bundle *first*, then
run the SQL. A full VPS snapshot was also taken and expires 24 hours after
2026-08-11.

---

## 8. Feature flags

Changeable in Admin → Feature Flags without a deploy. **Flags are cached per
browser session**, so a change applies to sessions started afterwards; an already
open tab needs a reload.

| Flag | Value | What it controls |
|---|---|---|
| `answer_verification_off` | **true** | **Inverted meaning: `true` means the second AI answer-checking pass is DISABLED.** Set true for launch to avoid an extra API call per question. Set to `false` to enable verification. |
| `blueprint_v2_enabled` | true | Weights chapter selection by what real past papers emphasise. |
| `exam_blueprint_enabled` | true | Blueprint-driven paper structure. |
| `content_review_queue_enabled` | false | When true, newly extracted content lands as "in review" instead of published. Off, so admin uploads publish directly. |
| `content_versioning_enabled` | true | Keeps version history for content edits. |
| `syllabus_graph_enabled` | true | Syllabus/prerequisite graph features. |
| `misconception_engine_enabled` | true | Tracks recurring student misconceptions. |
| `atomic_quota_rpc_enabled` | true | Race-safe usage-quota counting. |
| `paper_mode_v2_enabled` | true | Printable paper layout. |
| `dalle_proxy_enabled` | true | Image-generation proxy. |
| `centre_content_pool_enabled` | true | Coaching-centre shared content. |
| `centre_test_builder_enabled` | true | Coaching-centre test builder. |
| `centre_invites_enabled` | true | Coaching-centre invite flow. |
| `maintenance_mode_enabled` | false | Site-wide maintenance banner/lockout. |

The inverted sense of `answer_verification_off` is deliberate: a missing flag row
reads as `false`, and for a safety check the safe default is *enabled*. It is
also the easiest flag in this list to misread — check twice before toggling.
