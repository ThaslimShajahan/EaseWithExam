-- Clear `unit` on study_notes rows where it merely repeats the chapter title.
--
-- WHY
-- `unit` exists to GROUP notes: NotesBrowser and AdminStudyNotes both build a
-- table-of-contents accordion keyed on it, and notes without one fall into a
-- single "Other Notes" bucket at the end. A unit whose only member is a chapter
-- of the same name carries no grouping information — it renders as an accordion
-- section of exactly one item, repeating its own title twice. 81 such rows turn
-- the Class 8-12 TOC into a wall of singleton groups.
--
-- WHERE IT CAME FROM
-- runNotesExtraction asks the model for "Unit name if this content is part of a
-- numbered/named unit, else null". A bulk-loaded NCERT PDF *is* one chapter, so
-- the model has nothing else to name and answers with the chapter title rather
-- than null. scripts/backfill-study-notes.mjs then copies knowledge_base.unit
-- through verbatim. Cosmetic only — no query filters on `unit`.
--
-- THE GUARD IS THE POINT
-- `WHERE unit = chapter` alone is WRONG and would destroy real data. NCERT
-- genuinely names a unit after its own opening chapter, and 3 of the 84
-- self-matching rows are exactly that:
--
--   CBSE Class 10 Mathematics  "Number Play"           + 3 sibling chapters
--   CBSE Class 11 Biology      "Locomotion and Movement" + 1
--   CBSE Class 8  Mathematics  "Proportional Reasoning"  + 1
--
-- Nulling those would evict the intro chapter from a unit that legitimately
-- exists and orphan it into "Other Notes" while its siblings stay grouped —
-- worse than the cosmetic problem being fixed. So the NOT EXISTS below keeps
-- any unit that at least one OTHER note in the same exam_type+subject shares.
-- Measured against production: 84 self-matching, 81 cleared, 3 preserved.
--
-- Comparison is trim + lower + whitespace-collapsed on both sides, because the
-- values are model-authored and " Real  Numbers" vs "Real Numbers" is the same
-- string for this purpose.

DO $$
DECLARE
  cleared integer;
BEGIN
  WITH norm AS (
    SELECT
      id,
      exam_type,
      subject,
      lower(regexp_replace(btrim(unit),    '\s+', ' ', 'g')) AS n_unit,
      lower(regexp_replace(btrim(chapter), '\s+', ' ', 'g')) AS n_chapter
    FROM public.study_notes
    WHERE unit IS NOT NULL
      AND btrim(unit) <> ''
      AND chapter IS NOT NULL
  ),
  self_referential AS (
    SELECT a.id
    FROM norm a
    WHERE a.n_unit = a.n_chapter
      -- Keep it if the unit is a real group: some other note in the same
      -- exam_type + subject sits under the same unit name.
      AND NOT EXISTS (
        SELECT 1
        FROM norm b
        WHERE b.id <> a.id
          AND b.n_unit = a.n_unit
          AND b.exam_type IS NOT DISTINCT FROM a.exam_type
          AND b.subject   IS NOT DISTINCT FROM a.subject
      )
  )
  UPDATE public.study_notes s
  SET unit = NULL
  FROM self_referential f
  WHERE s.id = f.id;

  GET DIAGNOSTICS cleared = ROW_COUNT;
  RAISE NOTICE 'study_notes.unit cleared on % self-referential row(s)', cleared;
END $$;
