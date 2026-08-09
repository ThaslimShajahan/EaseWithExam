-- knowledge_base.content_type gains 'exercise', 'activity' and 'summary'.
--
-- The original eight types had no bucket for three things NCERT spends a lot of
-- page area on, so all three fell into 'prose', the catch-all:
--
--   exercise   an unsolved question set ("Exercises 1. Name the two modalities
--              of analysis following sequencing...") -- a real question, with a
--              chapter already attached
--   activity   a practical procedure to carry out ("Activity 6.3: Exploring Air
--              Pressure. Now, try to lift the paper plate...")
--   summary    an end-of-chapter recap ("Summary of Light Concepts")
--
-- Measured on the 4,363-row corpus load: 3,488 rows (79.8%) landed in 'prose',
-- and a heading-anchored scan found 187 exercise sets, 62 activities and 87
-- summaries hiding inside it. Re-classifying into the old taxonomy alone would
-- have had nowhere to put them, which is why the types come first.
--
-- 'exercise' matters most. pyq_questions is empty, so these ~187 chunks are
-- currently the only real, chapter-attributed questions in the system -- not
-- past-year papers, but the closest thing available to question-pattern data.

ALTER TABLE public.knowledge_base
  DROP CONSTRAINT IF EXISTS kb_content_type_chk;

ALTER TABLE public.knowledge_base
  ADD CONSTRAINT kb_content_type_chk CHECK (
    content_type IS NULL OR content_type IN
    ('theorem','law','formula','definition','solved_example','derivation','diagram','prose',
     'exercise','activity','summary'));

comment on column public.knowledge_base.content_type is
  'One of: theorem, law, formula, definition, solved_example, derivation, diagram, exercise, activity, summary, prose. "prose" is the honest catch-all for narrative text -- it is not a quality signal, and a high prose share may mean the classifier had nowhere better to put something.';
