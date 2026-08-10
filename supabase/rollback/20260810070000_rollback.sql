-- ROLLBACK for 20260810070000_match_kb_exam_type_array.sql
--
-- DELIBERATELY OUTSIDE supabase/migrations/ so it is never picked up by
-- `supabase db push`. Run it by hand, in the Supabase SQL editor, only if the
-- array migration has to be undone.
--
-- WHEN YOU NEED THIS
-- The forward migration changes match_knowledge_base's filter_exam_type from
-- `text` to `text[]`, which cannot be done in place (42P13) — the old signature
-- is DROPPED. If the client deploy fails or has to be reverted, the deployed
-- bundle will be sending a bare string again and every semantic retrieval call
-- will fail on a type mismatch. This restores the scalar signature so the OLD
-- client works again.
--
-- ORDER MATTERS, same as the forward direction: revert the client bundle FIRST
-- (or at the same time), then run this. Running this while the NEW client is
-- live breaks retrieval in the other direction.
--
-- This is a byte-for-byte restore of the definition from
-- 20260810000000_multimodal_kb.sql — the only difference from the forward
-- migration is `filter_exam_type text` and `kb.exam_type = filter_exam_type`.

DROP FUNCTION IF EXISTS public.match_knowledge_base(
  vector, integer, text, text[], text, text[], text, text[]
);

CREATE FUNCTION public.match_knowledge_base(
  query_embedding     vector,
  match_count         integer,
  filter_subject      text   DEFAULT NULL,
  filter_exam_type    text   DEFAULT NULL,
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
    AND (filter_exam_type    IS NULL OR kb.exam_type    = filter_exam_type)
    AND (filter_chapter      IS NULL OR kb.chapter      = filter_chapter)
    AND (filter_difficulty   IS NULL OR kb.difficulty   = filter_difficulty)
    AND (filter_content_type IS NULL OR kb.content_type = ANY(filter_content_type))
    AND (filter_techniques   IS NULL OR kb.techniques && filter_techniques)
  ORDER BY kb.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- After running this, `supabase migration list` will still show 20260810070000
-- as applied. If you intend to re-apply it later, delete its row from
-- supabase_migrations.schema_migrations first, or the push will skip it:
--   DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260810070000';
