-- topic_frequency: record WHERE a frequency came from.
--
-- The table has only ever been written by analyzeTopicDistribution(), which
-- asks gpt-4o-mini to "estimate relative frequency (1-10)" from ~20
-- knowledge_base excerpts. That is a guess about a textbook, not a measurement
-- of past-year papers — but the value was stored in a column called
-- `frequency` with nothing to distinguish it, and rendered to students as
-- "PYQ frequency: N/10 — this is a very high priority chapter."
--
-- Nothing in the schema made that claim false, which is exactly the problem:
-- a measured count and an LLM's impression were indistinguishable once
-- written. This adds the distinction so a consumer can tell them apart, and
-- so a future measured path (aggregating real pyq_questions rows) can coexist
-- with estimates instead of silently overwriting them.
--
-- Default is 'estimated' because every row that could exist today came from
-- the estimator. pyq_questions is currently empty, so no measured row has ever
-- been possible.

alter table public.topic_frequency
  add column if not exists source text not null default 'estimated';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'topic_frequency_source_check'
  ) then
    alter table public.topic_frequency
      add constraint topic_frequency_source_check
      check (source in ('measured', 'estimated'));
  end if;
end $$;

comment on column public.topic_frequency.source is
  'measured = aggregated from real pyq_questions rows; estimated = LLM guess from textbook content. Never present an estimated row to a student as exam-derived frequency.';

-- Any row written before this migration came from the estimator by definition.
update public.topic_frequency set source = 'estimated' where source is null;
