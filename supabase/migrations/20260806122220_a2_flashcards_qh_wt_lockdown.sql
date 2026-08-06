-- PART A2: flashcards, flashcard_progress, question_history, user_weak_topics
-- lockdown. Same shape as A1 — all four had a wide-open `USING(true)` policy
-- to the anon key. flashcards/flashcard_progress already go through
-- SECURITY DEFINER RPCs from the previous batch's SM-2 rebuild (they bypass
-- RLS regardless of policy state), so those two just need the open policy
-- dropped. question_history/user_weak_topics never had RPCs at all — full
-- surface built here, all scoped to student-own-rows via explicit p_uid.

drop policy if exists flashcards_anon_all         on public.flashcards;
drop policy if exists flashcard_progress_anon_all on public.flashcard_progress;
drop policy if exists question_history_anon_all   on public.question_history;
drop policy if exists question_history_open       on public.question_history;
drop policy if exists user_weak_topics_anon_all   on public.user_weak_topics;
drop policy if exists weak_topics_open            on public.user_weak_topics;

-- ── question_history ──────────────────────────────────────────────

-- Upsert-preserving-SRS-state semantics, ported from errorNotebook.js's
-- saveWrongAnswers(): if a non-mastered row already exists for this
-- (user, question), reset it to due-today without touching its SM-2
-- progress; otherwise insert fresh with default SM-2 state.
create or replace function public.save_wrong_answers(p_uid text, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r jsonb; v_existing_id uuid;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    select id into v_existing_id
    from public.question_history
    where user_id = p_uid and question_id = r->>'question_id' and is_mastered = false
    limit 1;

    if v_existing_id is not null then
      update public.question_history set
        user_answer = r->>'user_answer',
        due_date    = current_date,
        is_correct  = false,
        updated_at  = now()
      where id = v_existing_id;
    else
      insert into public.question_history (
        user_id, question_id, question_text, subject, topic, question_type,
        options, correct_option, correct_answer, explanation, user_answer,
        is_correct, source, source_name, due_date, ease_factor, interval_days, repetitions
      ) values (
        p_uid, r->>'question_id', r->>'question_text', r->>'subject', r->>'topic',
        coalesce(r->>'question_type', 'MCQ'),
        r->'options',
        nullif(r->>'correct_option','')::int,
        r->>'correct_answer', r->>'explanation', r->>'user_answer',
        false, coalesce(r->>'source','practice'), r->>'source_name',
        current_date, 2.5, 1, 0
      );
    end if;
  end loop;
end;
$$;

create or replace function public.get_due_questions(p_uid text, p_limit int default 20)
returns setof public.question_history
language sql security definer set search_path = public as $$
  select * from public.question_history
  where user_id = p_uid and is_mastered = false and due_date <= current_date
  order by due_date asc
  limit p_limit;
$$;

create or replace function public.get_error_notebook(p_uid text, p_subject text default null, p_mastered boolean default null, p_limit int default null)
returns setof public.question_history
language sql security definer set search_path = public as $$
  select * from public.question_history
  where user_id = p_uid
    and (p_subject is null or subject = p_subject)
    and (p_mastered is null or is_mastered = p_mastered)
  order by updated_at desc
  limit p_limit;
$$;

-- SM-2 math, ported verbatim from errorNotebook.js's recordReview(). Also
-- closes a gap that predates this migration: the old client-side version
-- took only a historyId with no ownership check at all (RLS wide-open
-- covered for it); this RPC requires the row to belong to p_uid.
create or replace function public.record_review(p_uid text, p_history_id uuid, p_grade int)
returns public.question_history
language plpgsql security definer set search_path = public as $$
declare
  v_ease real; v_int integer; v_reps integer; v_mastered boolean; v_row public.question_history;
begin
  select ease_factor, interval_days, repetitions into v_ease, v_int, v_reps
  from public.question_history where id = p_history_id and user_id = p_uid;
  if not found then raise exception 'Not found'; end if;

  if p_grade >= 3 then
    if v_reps = 0 then v_int := 1;
    elsif v_reps = 1 then v_int := 6;
    else v_int := round(v_int * v_ease);
    end if;
    v_ease := greatest(1.3, v_ease + 0.1 - (5 - p_grade) * (0.08 + (5 - p_grade) * 0.02));
    v_reps := v_reps + 1;
  else
    v_int := 1;
    v_ease := greatest(1.3, v_ease - 0.2);
    v_reps := 0;
  end if;

  v_mastered := v_reps >= 5 and p_grade >= 4;

  update public.question_history set
    ease_factor = v_ease, interval_days = v_int, repetitions = v_reps,
    due_date = current_date + v_int, is_mastered = v_mastered,
    is_correct = p_grade >= 3, updated_at = now()
  where id = p_history_id and user_id = p_uid
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.get_notebook_stats(p_uid text)
returns json
language sql security definer set search_path = public as $$
  select json_build_object(
    'total',    (select count(*) from public.question_history where user_id = p_uid),
    'due',      (select count(*) from public.question_history where user_id = p_uid and is_mastered = false and due_date <= current_date),
    'mastered', (select count(*) from public.question_history where user_id = p_uid and is_mastered = true)
  );
$$;

-- ── user_weak_topics ──────────────────────────────────────────────

-- Accumulate-counts-on-conflict semantics, ported from errorNotebook.js's
-- updateWeakTopics(). p_rows: [{subject, topic, wrong, total}]
create or replace function public.update_weak_topics(p_uid text, p_rows jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_existing record; v_new_wrong int; v_new_total int;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    select id, wrong_count, total_attempts into v_existing
    from public.user_weak_topics
    where user_id = p_uid and subject = r->>'subject' and topic = r->>'topic';

    if found then
      v_new_wrong := v_existing.wrong_count + (r->>'wrong')::int;
      v_new_total := v_existing.total_attempts + (r->>'total')::int;
      update public.user_weak_topics set
        wrong_count = v_new_wrong,
        total_attempts = v_new_total,
        accuracy_pct = round(((v_new_total - v_new_wrong)::numeric / v_new_total) * 100),
        last_seen = current_date,
        updated_at = now()
      where id = v_existing.id;
    else
      insert into public.user_weak_topics (user_id, subject, topic, wrong_count, total_attempts, accuracy_pct, last_seen)
      values (
        p_uid, r->>'subject', r->>'topic', (r->>'wrong')::int, (r->>'total')::int,
        round((((r->>'total')::int - (r->>'wrong')::int)::numeric / (r->>'total')::int) * 100),
        current_date
      );
    end if;
  end loop;
end;
$$;

create or replace function public.get_weak_topics(p_uid text, p_limit int default 10)
returns setof public.user_weak_topics
language sql security definer set search_path = public as $$
  select * from public.user_weak_topics
  where user_id = p_uid and accuracy_pct < 70
  order by accuracy_pct asc
  limit p_limit;
$$;

grant execute on function public.save_wrong_answers(text, jsonb) to anon;
grant execute on function public.get_due_questions(text, int) to anon;
grant execute on function public.get_error_notebook(text, text, boolean, int) to anon;
grant execute on function public.record_review(text, uuid, int) to anon;
grant execute on function public.get_notebook_stats(text) to anon;
grant execute on function public.update_weak_topics(text, jsonb) to anon;
grant execute on function public.get_weak_topics(text, int) to anon;
