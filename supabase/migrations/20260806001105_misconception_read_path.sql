-- BUG-005: the misconception write path (upsert_misconception, wired into
-- PracticeGeneratorPage.jsx) has been live since 2026-07-13 and is correctly
-- logging distractor/correct-answer/chapter/count data to
-- concept_misconceptions — but nothing ever read it back. Adds the read path:
-- a student-facing "weak concepts by chapter" RPC, plus a lightweight
-- admin-side weekly rollup (stretch goal from the fix scope).

-- Per-chapter rollup: total repeated-mistake count + one concrete example
-- (the most-repeated distractor for that chapter) so the widget can show
-- something specific, not just a bare number.
create or replace function public.get_user_misconceptions(p_uid text, p_limit int default 6)
returns table(
  subject text, chapter text, total_count bigint,
  top_distractor text, top_correct_answer text, top_question_text text,
  last_seen_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with agg as (
    select subject, chapter, sum(count) as total_count, max(last_seen_at) as last_seen_at
    from public.concept_misconceptions
    where user_id = p_uid
    group by subject, chapter
  ),
  top_row as (
    select distinct on (subject, chapter)
      subject, chapter, distractor, correct_answer, question_text
    from public.concept_misconceptions
    where user_id = p_uid
    order by subject, chapter, count desc, last_seen_at desc
  )
  select a.subject, a.chapter, a.total_count,
         t.distractor, t.correct_answer, t.question_text,
         a.last_seen_at
  from agg a
  join top_row t using (subject, chapter)
  order by a.total_count desc, a.last_seen_at desc
  limit p_limit;
$$;

grant execute on function public.get_user_misconceptions(text, int) to anon;

-- Admin stretch: top repeated misconceptions across all students in the
-- last N days, for a platform-wide "what's tripping everyone up" view.
create or replace function public.admin_get_top_misconceptions(p_caller text, p_days int default 7, p_limit int default 20)
returns table(
  subject text, chapter text, distractor text, correct_answer text, question_text text,
  total_occurrences bigint, distinct_students bigint, last_seen_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare v_role text;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then
    raise exception 'Access denied';
  end if;

  return query
  select
    m.subject, m.chapter, m.distractor, m.correct_answer, m.question_text,
    sum(m.count)                as total_occurrences,
    count(distinct m.user_id)   as distinct_students,
    max(m.last_seen_at)         as last_seen_at
  from public.concept_misconceptions m
  where m.last_seen_at >= now() - (p_days || ' days')::interval
  group by m.subject, m.chapter, m.distractor, m.correct_answer, m.question_text
  order by total_occurrences desc, last_seen_at desc
  limit p_limit;
end;
$$;

grant execute on function public.admin_get_top_misconceptions(text, int, int) to anon;
