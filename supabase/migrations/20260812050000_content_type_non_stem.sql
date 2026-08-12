-- knowledge_base.content_type gains the 10 values non-STEM prose actually needs.
--
-- The existing 11 describe STEM: theorem, law, formula, definition,
-- solved_example, derivation, diagram, exercise, activity, summary, prose. None
-- of them describes a poem, a primary-source extract or a balance-sheet format,
-- so 372 files of literature, social science and commerce would land almost
-- entirely in 'prose' -- exactly the failure 20260810040000 was written to fix,
-- reproduced at three times the scale.
--
-- ADDED (10)
--
--   literary_prose   a story, essay or narrative text that IS the lesson --
--                    the thing being studied, not an explanation of something
--   poem             a poem, or a stanza-level excerpt of one
--   drama            a play, or a scene/dialogue excerpt of one
--   author_note      the "About the author" / "About the poet" box
--   event            a dated historical happening, narrated as such
--   case_study       a named, bounded real-world example the chapter reasons
--                    from ("The Bhopal Gas Tragedy", "Amul: a cooperative")
--   source_extract   a primary source reproduced in the book -- a treaty
--                    clause, a census table, a speech, a letter, a photograph
--                    caption presented as evidence
--   map_work         a map and the geographical reading it is used for
--   procedure        an ordered method to carry out ("passing a journal entry",
--                    "preparing a bank reconciliation")
--   format_template  a ruled layout to be reproduced -- a trial balance, a
--                    ledger account, a balance sheet skeleton
--
-- DELIBERATELY NOT ADDED, though the original sketch proposed them:
--
--   concept              -> use 'definition'. A defined term is a defined term
--                           whether the subject is Physics or Sociology.
--   worked_problem       -> use 'solved_example'. Identical shape: a problem
--                           with its solution shown. An accountancy question
--                           worked through is a solved_example.
--   comprehension_exercise -> use 'exercise'. Comprehension questions ARE an
--                           unsolved question set; the subject already tells a
--                           reader they are about a text.
--
-- Every redundant value is a coin-flip for the classifier and a split bucket for
-- anything that filters on it. Three fewer near-synonyms is worth more than
-- three finer labels nobody can apply consistently.
--
-- WHY 'prose' IS NOT REUSED FOR LITERATURE -- THE IMPORTANT ONE
--
-- 'prose' currently means "the classifier had nowhere better to put this". Its
-- share is a DIAGNOSTIC: the 79.8% measured on the 4,363-row corpus is what
-- justified adding exercise/activity/summary, and the comment on this column
-- says so in as many words. If a First Flight story also lands in 'prose', that
-- number stops meaning anything and the signal can never be read again --
-- a high share would no longer distinguish "the taxonomy has a hole" from
-- "we loaded a lot of literature". So literature gets its own positive value,
-- 'literary_prose', and 'prose' keeps its job as the honest catch-all.
--
-- SCOPING IS PROMPT-SIDE, NOT DB-SIDE. This constraint is the flat union of all
-- 21 values. Which SUBSET a given chunk may be labelled with is decided by the
-- subject family in src/lib/contentExtraction.js (SUBJECT_FAMILIES) -- the same
-- shape as PARTIAL_SYLLABUS_EXAM_TYPES scoping the closed-list rule per exam
-- type. A CHECK constraint cannot see the subject of the row it is validating
-- without a much heavier trigger, and the prompt is where a wrong label is
-- actually prevented rather than merely rejected.
--
-- KEEP THIS LIST AND CONTENT_TYPES IN src/lib/contentExtraction.js IDENTICAL.
-- normaliseClassification() nulls any value missing from the JS Set BEFORE the
-- insert, so a value allowed here but absent there is dead on arrival and fails
-- silently -- there is no error, the column is just NULL.

ALTER TABLE public.knowledge_base
  DROP CONSTRAINT IF EXISTS kb_content_type_chk;

ALTER TABLE public.knowledge_base
  ADD CONSTRAINT kb_content_type_chk CHECK (
    content_type IS NULL OR content_type IN
    -- STEM (unchanged)
    ('theorem','law','formula','definition','solved_example','derivation','diagram','prose',
     'exercise','activity','summary',
    -- literature
     'literary_prose','poem','drama','author_note',
    -- social science
     'event','case_study','source_extract','map_work',
    -- commerce
     'procedure','format_template'));

comment on column public.knowledge_base.content_type is
  'One of 21 values. STEM: theorem, law, formula, definition, solved_example, derivation, diagram, exercise, activity, summary. Literature: literary_prose, poem, drama, author_note. Social science: event, case_study, source_extract, map_work. Commerce: procedure, format_template. Plus "prose", the honest catch-all for narrative text that fits nothing else -- it is not a quality signal, and a high prose share may mean the classifier had nowhere better to put something. Note literature narrative is literary_prose, NOT prose, so that the prose share stays readable as the taxonomy-hole diagnostic it has been since 20260810040000. Which subset applies to a chunk is scoped by subject family in src/lib/contentExtraction.js, not by this constraint.';
