-- Phase 1: multimodal extraction + content classification.
--
-- Two things this migration makes possible that were structurally impossible
-- before:
--
--   1. Scanned / image-only PDFs. Extraction was text-layer only (pdfjs
--      getTextContent), so a scanned paper produced nothing and the intake
--      screen rejected it outright. Vision now reconstructs those pages, and
--      the figures and equations it finds need somewhere to live.
--
--   2. Filtering the vector store. match_knowledge_base filtered on `subject`
--      alone, and everything else — chapter, exam, class — lived inside a flat
--      untyped `tags text[]` that mixed chapter names, unit names, exam tags
--      and free keywords with no way to tell which was which. Chapter scoping
--      was done with `tags.cs.{...}` string containment on the KEYWORD FALLBACK
--      path only; the semantic path could not filter by chapter or exam at all.
--
-- `tags` is dropped rather than kept for compatibility: every consumer of it
-- was doing string archaeology to recover structure that is now real columns,
-- and the existing rows are disposable test data being re-uploaded from source.
-- There is deliberately NO backfill here.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. knowledge_base: real columns instead of a bag of strings
-- ---------------------------------------------------------------------------

-- Test data, discarded by design — the re-upload repopulates this with rows
-- that actually carry the new metadata. Backfilling text[] archaeology into
-- typed columns would be guesswork.
TRUNCATE public.knowledge_base;

ALTER TABLE public.knowledge_base
  DROP COLUMN IF EXISTS tags,
  -- Scope: what this chunk is FOR. Previously smuggled inside tags[].
  ADD COLUMN IF NOT EXISTS exam_type     text,
  ADD COLUMN IF NOT EXISTS chapter       text,
  ADD COLUMN IF NOT EXISTS class_level   text,
  ADD COLUMN IF NOT EXISTS unit          text,
  ADD COLUMN IF NOT EXISTS keywords      text[] DEFAULT '{}',
  -- Classification: what this chunk IS. Entirely new.
  ADD COLUMN IF NOT EXISTS content_type  text,
  ADD COLUMN IF NOT EXISTS techniques    text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS difficulty    text,
  ADD COLUMN IF NOT EXISTS confidence    real,
  -- Multimodal provenance.
  ADD COLUMN IF NOT EXISTS page_no       int,
  ADD COLUMN IF NOT EXISTS figure_url    text,
  ADD COLUMN IF NOT EXISTS has_equations boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS latex         text[] DEFAULT '{}',
  -- { source, lesson_title, page_start, page_end } — lets the Phase 3 concept
  -- view cite which note/paper/page a formula came from.
  ADD COLUMN IF NOT EXISTS source_ref    jsonb;

-- Enumerations are CHECKed rather than left free-text: `difficulty` on
-- pyq_questions is an unconstrained text column and has already drifted
-- between 'Medium' and 'medium' depending on which prompt wrote it.
ALTER TABLE public.knowledge_base
  DROP CONSTRAINT IF EXISTS kb_content_type_chk,
  DROP CONSTRAINT IF EXISTS kb_difficulty_chk;

ALTER TABLE public.knowledge_base
  ADD CONSTRAINT kb_content_type_chk CHECK (
    content_type IS NULL OR content_type IN
    ('theorem','law','formula','definition','solved_example','derivation','diagram','prose')),
  ADD CONSTRAINT kb_difficulty_chk CHECK (
    difficulty IS NULL OR difficulty IN ('easy','medium','hard'));

-- The vector index handles ranking; these handle the WHERE clause that
-- match_knowledge_base now applies before ranking.
CREATE INDEX IF NOT EXISTS kb_scope_idx        ON public.knowledge_base (exam_type, subject, chapter);
CREATE INDEX IF NOT EXISTS kb_content_type_idx ON public.knowledge_base (content_type);
CREATE INDEX IF NOT EXISTS kb_techniques_idx   ON public.knowledge_base USING gin (techniques);
CREATE INDEX IF NOT EXISTS kb_keywords_idx     ON public.knowledge_base USING gin (keywords);

-- ---------------------------------------------------------------------------
-- 2. content_figures — cropped figures extracted from source pages
-- ---------------------------------------------------------------------------

-- Distinct from pyq_questions.image_url (a single admin-uploaded image bound to
-- one question) and from the SVGs src/lib/diagrams.js synthesises out of an
-- LLM-invented description. These are real figures cropped out of the real
-- source document, which nothing in the codebase could produce before.
CREATE TABLE IF NOT EXISTS public.content_figures (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Polymorphic: a figure can belong to a KB chunk or a PYQ. No FK, because a
  -- single column cannot reference two tables; source_table names the owner.
  source_table text NOT NULL CHECK (source_table IN ('knowledge_base','pyq_questions')),
  source_id    uuid,
  exam_type    text,
  subject      text,
  chapter      text,
  page_no      int,
  image_url    text NOT NULL,
  caption      text,
  kind         text CHECK (kind IS NULL OR kind IN
                 ('diagram','graph','chemical_structure','table','photo')),
  -- Normalised 0-1 {x,y,w,h} against the rendered page, not raw pixels — the
  -- render scale is a tuning knob and shouldn't invalidate stored boxes.
  bbox         jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS content_figures_scope_idx
  ON public.content_figures (exam_type, subject, chapter, page_no);
CREATE INDEX IF NOT EXISTS content_figures_source_idx
  ON public.content_figures (source_table, source_id);

ALTER TABLE public.content_figures ENABLE ROW LEVEL SECURITY;

-- Readable by anyone: these are textbook figures rendered into a public bucket
-- and shown to students inside papers and notes. Writes go through the admin
-- intake path, which uses the service-role-backed helpers, so no write policy
-- is granted to anon/authenticated here.
DROP POLICY IF EXISTS content_figures_read ON public.content_figures;
CREATE POLICY content_figures_read ON public.content_figures FOR SELECT USING (true);

-- ---------------------------------------------------------------------------
-- 3. match_knowledge_base — filter, then rank
-- ---------------------------------------------------------------------------

-- Return type changes, so this cannot be CREATE OR REPLACE (42P13).
DROP FUNCTION IF EXISTS public.match_knowledge_base(vector, integer, text);

-- Every new filter defaults to NULL = "don't filter", so the shape stays
-- backwards-compatible with a 3-argument call while callers are updated.
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
    -- && is array-overlap: "has at least one of these techniques".
    AND (filter_techniques   IS NULL OR kb.techniques && filter_techniques)
  ORDER BY kb.embedding <=> query_embedding
  LIMIT match_count;
$$;

COMMIT;
