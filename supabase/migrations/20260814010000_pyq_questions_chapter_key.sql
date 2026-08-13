-- Content-engine rebuild, Phase 2 PYQ slice (docs/REBUILD_HANDOFF.md).
-- Same shape as 20260814000000's knowledge_base.chapter_key, but resolved by
-- a genuinely different mechanism, on purpose: a Study Notes file is one
-- chapter (or a few interleaved), so ordinal identity corroborated against a
-- book's approved manifest is the right tool. A PYQ paper is 180 questions
-- spanning most of the syllabus at once — there is no file-ordinal signal to
-- corroborate against, and no manifest, so file-ordinal/manifest identity
-- does not apply here at all. This chapter_key is resolved instead by
-- NAME-matching each question against real syllabus_nodes rows
-- (matchSyllabusChapterKeyed(), src/lib/contentExtraction.js) — a value here
-- means "matched a real chapter", not "corroborated by ordinal".
--
-- Nullable and additive: existing rows (0 today, post-wipe) keep working with
-- chapter_key = null, meaning "written before this system existed" or
-- "no syllabus to match against yet" — not "unknown".
--
-- No FK to syllabus_nodes, deliberately, matching knowledge_base.chapter_key's
-- reasoning: the match is resolved and frozen at write time from whatever
-- syllabus_nodes said then; a later syllabus edit should not retroactively
-- invalidate or dangle a question that was correctly matched at the time.

alter table public.pyq_questions
  add column if not exists chapter_key text;

comment on column public.pyq_questions.chapter_key is
  'Chapter identity resolved by name-matching against syllabus_nodes at write '
  'time (matchSyllabusChapterKeyed(), src/lib/contentExtraction.js) — NOT '
  'ordinal-anchored like knowledge_base.chapter_key, PYQ papers span many '
  'chapters per file so file-ordinal corroboration does not apply here. NULL '
  'means either written before this system existed, or no syllabus_nodes '
  'entry existed to match against at write time. See docs/REBUILD_HANDOFF.md.';

create index if not exists pyq_exam_subject_chapter_key_idx
  on public.pyq_questions (exam_type, subject, chapter_key)
  where chapter_key is not null;
