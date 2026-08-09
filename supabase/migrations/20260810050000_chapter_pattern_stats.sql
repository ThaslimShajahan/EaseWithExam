-- chapter_pattern_stats — what real past-year papers actually ask, per chapter.
--
-- A VIEW, not a materialised table: pyq_questions is small (87 rows today) and
-- a stale blueprint is worse than a slightly slower query. Nothing to refresh,
-- nothing to get out of date.
--
-- DELIBERATELY NARROWED from the original §3 scope of
-- "chapter / year / difficulty / type". Two of those four axes carry no
-- information in the data that exists:
--
--   year        every loaded question is 2025. Year-over-year trend needs 3-5
--               years per subject -- that is more papers, not more SQL.
--   difficulty  pyq_questions.difficulty is hardcoded 'Medium' by savePYQRows;
--               runPYQExtraction never even asks the model for it. So difficulty
--               here is DERIVED FROM MARKS instead, which is better anyway:
--               marks are set by the exam board, not guessed by a model, and a
--               5-mark Long Answer really is harder than a 1-mark MCQ.
--
-- Aggregating a constant column would produce a table that looks like data and
-- is not, so those columns are simply absent rather than present-and-useless.
--
-- technique_frequency is NOT built: pyq_questions has no techniques column, and
-- knowledge_base's equivalent holds 1,189 distinct free-text values across 2,095
-- rows. That needs a controlled vocabulary first.

CREATE OR REPLACE VIEW public.chapter_pattern_stats AS
WITH q AS (
  SELECT
    exam_type,
    subject,
    chapter,
    question_type,
    section,
    marks,
    -- CBSE section marks map cleanly onto effort: A/B are 1-2 mark recall,
    -- C and case-based E are 3-4 mark application, D is a 5-mark long answer.
    CASE
      WHEN marks IS NULL THEN 'unknown'
      WHEN marks >= 5     THEN 'hard'
      WHEN marks >= 3     THEN 'medium'
      ELSE 'easy'
    END AS derived_difficulty
  FROM public.pyq_questions
  WHERE status = 'published'
    AND question_type IS DISTINCT FROM 'KB_NOTE'   -- study-note rows, not questions
    AND chapter IS NOT NULL                        -- unattributed rows cannot inform a blueprint
),
base AS (
  SELECT exam_type, subject, chapter,
         count(*)::int                        AS question_count,
         coalesce(sum(marks), 0)::int         AS total_marks,
         round(avg(marks)::numeric, 2)        AS avg_marks
  FROM q GROUP BY 1, 2, 3
),
by_type AS (
  SELECT exam_type, subject, chapter, coalesce(question_type, 'unknown') AS k, count(*)::int AS n
  FROM q GROUP BY 1, 2, 3, 4
),
by_marks AS (
  SELECT exam_type, subject, chapter, coalesce(marks::text, 'unknown') AS k, count(*)::int AS n
  FROM q GROUP BY 1, 2, 3, 4
),
by_section AS (
  SELECT exam_type, subject, chapter, coalesce(section, 'unknown') AS k, count(*)::int AS n
  FROM q GROUP BY 1, 2, 3, 4
),
by_diff AS (
  SELECT exam_type, subject, chapter, derived_difficulty AS k, count(*)::int AS n
  FROM q GROUP BY 1, 2, 3, 4
)
SELECT
  b.exam_type,
  b.subject,
  b.chapter,
  b.question_count,
  b.total_marks,
  b.avg_marks,
  -- Share of the whole paper this chapter takes, which is what a blueprint
  -- allocates on.
  round((b.question_count::numeric / sum(b.question_count) OVER (PARTITION BY b.exam_type, b.subject)) * 100, 1) AS pct_of_questions,
  round((b.total_marks::numeric    / NULLIF(sum(b.total_marks) OVER (PARTITION BY b.exam_type, b.subject), 0)) * 100, 1) AS pct_of_marks,
  (SELECT jsonb_object_agg(k, n) FROM by_type    t WHERE (t.exam_type, t.subject, t.chapter) = (b.exam_type, b.subject, b.chapter)) AS by_question_type,
  (SELECT jsonb_object_agg(k, n) FROM by_marks   m WHERE (m.exam_type, m.subject, m.chapter) = (b.exam_type, b.subject, b.chapter)) AS by_marks,
  (SELECT jsonb_object_agg(k, n) FROM by_section s WHERE (s.exam_type, s.subject, s.chapter) = (b.exam_type, b.subject, b.chapter)) AS by_section,
  (SELECT jsonb_object_agg(k, n) FROM by_diff    d WHERE (d.exam_type, d.subject, d.chapter) = (b.exam_type, b.subject, b.chapter)) AS by_difficulty
FROM base b;

COMMENT ON VIEW public.chapter_pattern_stats IS
  'Per-chapter question patterns aggregated from published pyq_questions. difficulty is DERIVED FROM MARKS (>=5 hard, 3-4 medium, <=2 easy) because pyq_questions.difficulty is hardcoded. No year axis: all loaded papers are a single year. Absent rows mean no PYQ data for that exam_type+subject — treat as "no data", never as zero.';

GRANT SELECT ON public.chapter_pattern_stats TO anon, authenticated;
