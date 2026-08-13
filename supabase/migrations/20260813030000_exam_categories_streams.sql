-- exam_categories gains `streams` — structured Class 11/12 stream/combination
-- data, additive and nullable, following the exact precedent of `book` on
-- knowledge_base/syllabus_nodes (20260812040000, 20260813020000): NULL for
-- every row that isn't Class 11/12, no existing reader affected.
--
-- WHY A STRUCTURED COLUMN, NOT MORE TEXT IN `subjects`
--
-- `subjects text[]` is a flat list. Classes 11-12 are genuinely NOT flat: a
-- student picks a STREAM (Science/Commerce/Humanities), and CBSE and Kerala
-- State don't even structure that choice the same way --
--
--   CBSE      mix-and-match: a mandatory core PLUS an options pool. "PCM" /
--             "PCB" / "PCMB" are just the common picks from that pool, not
--             the only legal combinations.
--   Kerala    closed, NAMED combinations instead -- "Biology Science" or
--             "Computer Science" IS the entire choice, no pick-your-own step,
--             and it requires TWO languages where CBSE requires one.
--
-- Dumping every stream's subjects into one flat `subjects` array would erase
-- exactly the distinction that makes the data useful: which subjects are
-- mandatory versus optional (CBSE), and which combinations are even legal
-- (Kerala). `streams` preserves the real shape instead of flattening it away.
--
-- NOT YET WIRED INTO ONBOARDING. This column makes the data real and
-- queryable; the onboarding UI does not yet ask "which stream" (see
-- docs/REBUILD_HANDOFF.md s6b item 3) -- that is Part 2/3 work. Populating
-- this now, while it is free (see below), is not the same as building the
-- picker that reads it.

alter table public.exam_categories
  add column if not exists streams jsonb;

comment on column public.exam_categories.streams is
  'Class 11/12 only. Structured stream/combination data -- NOT flattened into `subjects`, because CBSE (mandatory core + options pool) and Kerala State (closed named combinations) structure the choice differently, and a flat list would lose that. Source: docs/curriculum-streams-reference.json, owner-supplied 2026-08-13. NULL for every row that is not a Class 11/12 board_class combo. See this migration''s header for the full reasoning.';
