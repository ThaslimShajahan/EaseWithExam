-- syllabus_nodes gains `book` — the volume a chapter belongs to.
--
-- WHY, AND WHY A COLUMN ALONE IS NOT THE FIX
--
-- Eight subjects in the corpus are TWO SEPARATE TEXTBOOKS, not Part 1/Part 2 of
-- one book. Each numbers its chapters from 1:
--
--   Class 10  Hindi A (Kshitij)            / Hindi B (Sparsh, Sanchayan)
--   Class 11  English Hornbill             / English Woven Words
--   Class 11  Economics: Indian Economic Development / Statistics for Economics
--   Class 11  Political Science: Constitution at Work / Political Theory
--   Class 11  Sociology                    / Sociology: Understanding Society
--   Class 11  Accountancy                  / Accountancy II
--
-- This is NOT the multi-PART case. `chemistry part 1` + `part 2` collapse to one
-- `Chemistry` correctly: one book, two volumes, CONTINUOUS chapter numbering.
-- These eight restart at 1, so collapsing them collides chapter 1 with chapter 1.
--
-- syllabus_nodes is UNIQUE on (exam_type, subject, chapter_key). This column is
-- deliberately NOT added to that constraint, and the constraint is NOT altered:
--
--   `book` is NULL for all 148 existing STEM rows, and Postgres treats NULLs as
--   DISTINCT in a unique index. Adding `book` to the key would therefore stop
--   the index protecting single-book subjects against duplicate chapters — it
--   would silently permit two `c10_real_numbers` rows. That is a worse bug than
--   the one being fixed, and it would land on the STEM corpus that is currently
--   correct.
--
-- Uniqueness is instead carried by a BOOK-SCOPED chapter_key (`c11_hornbill_01`,
-- `c11_wovenwords_01`), which satisfies the existing constraint untouched. The
-- column's job is grouping, display order and scoping the student chapter
-- picker — not identity. Two mechanisms, two jobs, and the one that guards data
-- integrity is the one that already works.
--
-- NULL MEANS "single-book subject". Every existing row stays NULL and every
-- existing reader keeps working: this is additive only.
--
-- WITHIN-BOOK SECTIONS ARE NOT A COLUMN. A reader restarts numbering per SECTION
-- inside one book. Hornbill, read from its own contents page in Stage B:
--
--   Reading Skills  pp 1-69    6 numbered prose chapters, with 5 poems
--                              INTERLEAVED, unnumbered, and having no files of
--                              their own -- they sit inside the prose chapter
--                              PDFs (A Photograph in kehb101, The Laburnum Top
--                              and The Voice of the Rain in kehb103, ...)
--   Writing Skills  pp 70-100  6 numbered items (Note-making ... Creative
--                              Writing), files kehb111-116
--
-- Handled by banding sort_order per PRINTED SECTION — Reading Skills 1-99,
-- Writing Skills 100-199 — reusing the convention the NEET rows already use
-- (1-14 class 11, 100-113 class 12, 900+ legacy). A third column for a display
-- concern is not worth it.
--
-- An earlier draft of this comment banded "prose 1-99, poetry 100-199" on the
-- assumption that kehb111-116 were Hornbill's poems. They are not; they are the
-- Writing Skills section. Poems are not a section at all — they are interleaved
-- through Reading Skills — so a prose/poetry banding would have split a section
-- that the book keeps together and invented one it does not have. Recorded
-- because the wrong version is the intuitive one.
--
-- NOT DONE HERE, DELIBERATELY: knowledge_base gets no `book` column. Its chunks
-- are keyed on (exam_type, subject, chapter) and literature chapter names are
-- individual text titles, which do not collide. The genuine risk is commerce
-- ("Introduction" opens more than one book). Stage B reads every contents page
-- and will show whether a real within-subject name collision exists; if it does,
-- this decision gets revisited with evidence rather than pre-emptively.
--
-- NOTE ON THIS TABLE'S HISTORY: syllabus_nodes was created outside the migration
-- history (no CREATE TABLE for it exists in supabase/migrations — the only two
-- migrations that name it, 20260811200000 and 20260811210000, touch RLS and
-- policies). So no baseline DDL is replayable and this migration asserts nothing
-- about the table's shape beyond the column it adds.

ALTER TABLE public.syllabus_nodes
  ADD COLUMN IF NOT EXISTS book text;

comment on column public.syllabus_nodes.book is
  'The textbook volume this chapter belongs to, for subjects taught from two SEPARATE books that each number chapters from 1 (Hornbill vs Woven Words, Hindi Kshitij vs Sparsh, Economics Development vs Statistics). NULL means the subject has a single book — the case for every STEM row. Grouping and display only: uniqueness is carried by a book-scoped chapter_key under the existing (exam_type, subject, chapter_key) constraint, because book is nullable and Postgres treats NULLs as distinct in a unique index.';

-- Supports the picker's "group this subject's chapters by book" read. Partial:
-- the NULL-book rows are the single-book subjects and are already served by the
-- (exam_type, subject) access path.
CREATE INDEX IF NOT EXISTS syllabus_nodes_exam_subject_book_idx
  ON public.syllabus_nodes (exam_type, subject, book)
  WHERE book IS NOT NULL;
