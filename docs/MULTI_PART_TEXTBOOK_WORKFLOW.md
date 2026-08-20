# Multi-part textbooks (Part 1 / Part 2 / Part 3) — admin workflow

For an admin loading a board textbook that's published in more than one physical
part (e.g. CBSE Class 10 Maths "Ganithaprakash Part 1" and "Part 2"). Practical
steps only — see `src/lib/chapterIdentity.js` and `docs/REBUILD_HANDOFF.md` if
you want the design reasoning.

## Why each part gets its own manifest

Part 1 and Part 2 are two different physical books, not one book split in half.
Nothing in the system merges them automatically — each part has its own chapter
list, starts numbering from 1, and gets approved separately. Treat "Part 2" the
same way you'd treat a completely different textbook that happens to share a
subject.

This is **not** the same as a book whose chapters are printed across several
PDF files but numbered continuously (e.g. "Chemistry — Chapter 1-16.pdf" split
into two files for size). That case is still ONE manifest — see file_structure
below. Multi-part is specifically when the book itself restarts chapter
numbering (Part 2, Chapter 1 again).

## Steps, in order

1. **Draft the manifest from that part's own contents page.**
   Chapter Manifests → pick Exam/Board/Class/Subject → upload *that part's*
   contents/index page → the real extraction pipeline
   (`draftManifestFromContentsPage`) reads it. Never hand-type or guess entries
   — a typed chapter list is exactly how "Poorvi" and "Critical Reflection"
   ended up as chapter names instead of real chapters (see
   `chapterIdentity.js`'s header).

2. **Set an explicit `book` value for this part.** Not optional, and not left
   blank. Use something that distinguishes it, e.g. `Ganithaprakash Part 2`
   — not just `Ganithaprakash`, and never blank. Blank/null `book` is the
   single-book default and scopes a chapter's identity together with every
   other blank-book manifest at that class level; giving Part 2 the same
   blank `book` as Part 1 makes their chapter keys collide (both would produce
   `c10_ch01`, `c10_ch02`, ...) the same way two unrelated single-book subjects
   collide — see the dedup false-positive root cause below. A real, distinct
   `book` string is what keeps Part 1 and Part 2 from stepping on each other.

   (There used to be a separate bug here too: the manifest lookup used
   `.eq('book', null)` to find single-book manifests, which never matches NULL
   in Postgres/PostgREST — fixed to `.is('book', null)`. Not relevant to a
   named part like "Part 2" since it never had a blank book, but worth knowing
   if a single-book subject's manifest ever looks unfindable.)

3. **Review the drafted entries.** Confirm the chapter count and titles match
   *this part's* contents page — not the other part's. It's easy to
   accidentally re-upload the wrong part's contents page; the drafted chapter
   count is the fastest tell.

4. **Approve the manifest** (`admin_approve_chapter_manifest`). This locks it.
   The approval gate refuses to approve any manifest with a numbered entry
   missing `fileOrdinal` — so a clean approval here is a real correctness
   signal (every chapter has a file mapping), not just a rubber stamp.

5. **Upload the part's chapter files** through Content Intake, same as any
   other book. The dedup check compares against `knowledge_base` scoped to
   this exact (exam_type, subject) pair, so it will correctly skip a chapter
   already loaded and warn before re-processing — it will NOT confuse Part 1's
   chapter 3 with Part 2's chapter 3, because they carry different `book`-
   scoped keys as long as step 2 was done.

6. **If a file doesn't auto-match**, use the ManifestEntryPicker to pick the
   correct chapter by name from *this part's* manifest. Never guessed
   automatically, never typed free text.

## `file_structure`: per_chapter vs combined

Set/confirmed when the manifest is drafted (`inferFileStructure` suggests it,
you confirm or override):

- **`per_chapter`** — each chapter is its own PDF file. The common case. A
  file's own page 1 isn't guaranteed to be the chapter's printed page 1, so
  page-number validation is skipped; matching is by File # (fileOrdinal)
  alone.
- **`combined`** — one PDF spans multiple chapters (e.g. Poorvi: 5 files, 15
  entries, 3 chapters sharing each file). Printed page ranges are real
  corroboration here and stay enforced — the manifest's page numbers must be
  reliable for this book, unlike per_chapter.

Get this wrong and either false-reject valid per_chapter files (demanding page
numbers that don't mean anything) or under-validate a combined book (skipping
the one check that catches a chapter boundary in the wrong place).

## Common errors and what they mean

- **"matches no entry in the approved manifest (file ordinal N)"** — the
  filename couldn't be parsed to a chapter. Use the ManifestEntryPicker to
  pick it by hand instead of renaming the file to fit a pattern.

- **"already has N of N chapter key(s) loaded"** — the dedup check found real
  rows in `knowledge_base` for this chapter under this exact (exam_type,
  subject, chapter_key). Expected behavior in the normal case — you're about
  to re-spend real API cost re-processing something already saved.

  **Known false-positive, fixed 2026-08-20:** the check used to query
  `knowledge_base` by `chapter_key` alone, with no `exam_type`/`subject`
  filter. Since `chapterKeyFor()` deliberately leaves subject out of the key
  string (identity is `classLevel + book + ordinal`, not subject — see
  `chapterIdentity.js:36`), two unrelated single-book subjects at the same
  class level whose chapter 1 both leave `book` blank produce the *identical*
  key (`c11_ch01`). CBSE Class 11 Biology's "The Living World" was reported
  "already loaded" solely because CBSE Class 11 Accountancy's "Introduction to
  Accounting" — also chapter 1, also blank `book` — happened to share that
  string. The check is now scoped by `(exam_type, subject, chapter_key)`,
  matching the database's own uniqueness guarantee. If this warning appears
  for a chapter you're CERTAIN has zero rows for this exact exam/subject,
  that's a regression — report it immediately, don't just click "Load
  anyway" repeatedly.

  If "Load anyway" itself then fails with a browser error like *"A requested
  file or directory could not be found..."* — that means the file entry in
  the upload list is stale (its in-browser file handle expired, typically
  because it sat selected across a earlier timed-out attempt). Remove that
  file from the list and re-select it fresh from disk; don't just retry in
  place.

- **Truncation / token-cap errors** — should now self-resolve via adaptive
  batch-splitting (built 2026-08-19). If this reappears, it's a regression —
  report immediately, don't just retry hoping it clears.

## Quick-reference checklist

- [ ] Contents page for THIS part uploaded to Chapter Manifests
- [ ] `book` field set to a distinct value naming this part (never blank)
- [ ] Drafted chapter count/titles match this part's actual contents page
- [ ] `file_structure` confirmed (per_chapter vs combined)
- [ ] Manifest approved (no fileOrdinal-missing errors)
- [ ] Chapter files uploaded through Content Intake, unmatched ones resolved
      via ManifestEntryPicker
- [ ] Any dedup warning double-checked against `knowledge_base` for this exact
      exam/subject before clicking "Load anyway" — and if "Load anyway" itself
      errors, re-select the file fresh rather than retrying in place
