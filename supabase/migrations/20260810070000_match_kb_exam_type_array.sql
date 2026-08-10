-- match_knowledge_base: filter_exam_type becomes text[] so one query can read
-- across several exam_type values.
--
-- WHY
-- NEET's syllabus IS Class 11 + 12 Physics/Chemistry/Biology, and 1,531 such
-- chunks are already loaded under exam_type 'CBSE Class 11' — the right content
-- tagged for a different exam. With a scalar filter, a NEET query matched none
-- of them and retrieval returned nothing.
--
-- Subject still does the NEET/JEE separation: NEET is Phy/Chem/Bio, JEE is
-- Phy/Chem/Maths, and filter_subject is applied alongside this. So one corpus
-- serves both without either seeing the other's material.
--
-- This mirrors filter_content_type, which has always been text[] with = ANY()
-- in this same function — the pattern is copied, not invented.
--
-- COMPATIBILITY
-- The parameter TYPE changes, so this cannot be CREATE OR REPLACE (42P13) and
-- the old signature must be dropped by its exact argument list. Every caller
-- passing a bare string must be updated in the same deploy; there are two
-- (questionGen.js and supabase.js), both switched to examTypesFor().
-- A 3-argument legacy call still resolves, since everything from
-- filter_exam_type on still defaults to NULL = "no constraint".

DROP FUNCTION IF EXISTS public.match_knowledge_base(
  vector, integer, text, text, text, text[], text, text[]
);

CREATE FUNCTION public.match_knowledge_base(
  query_embedding     vector,
  match_count         integer,
  filter_subject      text   DEFAULT NULL,
  filter_exam_type    text[] DEFAULT NULL,
  filter_chapter      text   DEFAULT NULL,
  filter_content_type text[] DEFAULT NULL,
  filter_difficulty   text   DEFAULT NULL,
  filter_techniques   text[] DEFAULT NULL
)
RETURNS TABLE (
  id            uuid,
  content       text,
  subject       text,
  exam_type     text,
  chapter       text,
  content_type  text,
  techniques    text[],
  difficulty    text,
  page_no       int,
  figure_url    text,
  has_equations boolean,
  latex         text[],
  source_ref    jsonb,
  similarity    double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    kb.id, kb.content, kb.subject, kb.exam_type, kb.chapter,
    kb.content_type, kb.techniques, kb.difficulty,
    kb.page_no, kb.figure_url, kb.has_equations, kb.latex, kb.source_ref,
    1 - (kb.embedding <=> query_embedding) AS similarity
  FROM knowledge_base kb
  WHERE
    kb.embedding IS NOT NULL
    AND (filter_subject      IS NULL OR kb.subject      = filter_subject)
    -- The one changed line: scalar equality becomes array membership.
    AND (filter_exam_type    IS NULL OR kb.exam_type    = ANY(filter_exam_type))
    AND (filter_chapter      IS NULL OR kb.chapter      = filter_chapter)
    AND (filter_difficulty   IS NULL OR kb.difficulty   = filter_difficulty)
    AND (filter_content_type IS NULL OR kb.content_type = ANY(filter_content_type))
    -- && is array-overlap: "has at least one of these techniques".
    AND (filter_techniques   IS NULL OR kb.techniques && filter_techniques)
  ORDER BY kb.embedding <=> query_embedding
  LIMIT match_count;
$$;
