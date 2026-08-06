-- ═══════════════════════════════════════════════════════════════════
-- Migration 0052 — Important Questions & Answers (cached, per-chapter)
--
-- New Study Hub tab: student picks subject → chapter, sees a curated list
-- of "important" Q&A for that exact chapter — grounded first in real PYQs
-- already in pyq_questions (tagged with which years they were asked),
-- filled out with AI-synthesized high-yield questions from knowledge_base
-- where PYQ coverage is thin. Unlike Practice Generator (deliberately
-- different questions per student), this content is IDENTICAL for every
-- student in the same exam_type+subject+chapter — so it's generated once
-- and cached here, not regenerated per student. Mirrors question_cache's
-- open-RLS pattern (this table is a shared read-mostly cache, not
-- per-user data).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS important_qa (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_type    text NOT NULL,
  subject      text NOT NULL,
  chapter      text NOT NULL,
  questions    jsonb NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (exam_type, subject, chapter)
);

ALTER TABLE important_qa ENABLE ROW LEVEL SECURITY;

CREATE POLICY important_qa_open ON important_qa
  FOR ALL TO public USING (true) WITH CHECK (true);
