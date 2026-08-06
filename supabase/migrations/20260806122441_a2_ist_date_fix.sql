-- Same fix applied to review_flashcard (previous batch) — it had the
-- identical bare-current_date issue for due_date.
create or replace function public.review_flashcard(p_uid text, p_id bigint, p_grade int)
returns table(
  id bigint, ease_factor numeric, interval_days integer,
  repetitions integer, due_date date, is_known boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ease   numeric;
  v_int    integer;
  v_reps   integer;
  v_known  boolean;
  v_today  date;
begin
  v_today := (now() at time zone 'Asia/Kolkata')::date;

  select fp.ease_factor, fp.interval_days, fp.repetitions
    into v_ease, v_int, v_reps
  from public.flashcard_progress fp
  where fp.firebase_uid = p_uid and fp.card_id = p_id;

  if not found then
    v_ease := 2.5; v_int := 0; v_reps := 0;
  end if;

  if p_grade >= 3 then
    if v_reps = 0 then
      v_int := 1;
    elsif v_reps = 1 then
      v_int := 6;
    else
      v_int := round(v_int * v_ease);
    end if;
    v_ease := greatest(1.3, v_ease + 0.1 - (5 - p_grade) * (0.08 + (5 - p_grade) * 0.02));
    v_reps := v_reps + 1;
  else
    v_int  := 1;
    v_ease := greatest(1.3, v_ease - 0.2);
    v_reps := 0;
  end if;

  v_known := p_grade >= 3;

  insert into public.flashcard_progress
    (firebase_uid, card_id, is_known, reviewed_at, ease_factor, interval_days, repetitions, due_date)
  values
    (p_uid, p_id, v_known, now(), v_ease, v_int, v_reps, v_today + v_int)
  on conflict on constraint flashcard_progress_owner_card_uq
  do update set
    is_known      = excluded.is_known,
    reviewed_at   = now(),
    ease_factor   = excluded.ease_factor,
    interval_days = excluded.interval_days,
    repetitions   = excluded.repetitions,
    due_date      = excluded.due_date;

  return query
  select p_id, v_ease, v_int, v_reps, (v_today + v_int), v_known;
end;
$$;

create or replace function public.get_user_flashcards(p_uid text, p_chapter_key text)
returns table(
  id bigint, subject text, chapter_key text, chapter_name text, front text, back text,
  due_date date, ease_factor numeric, interval_days integer, repetitions integer, is_known boolean
)
language sql
security definer
set search_path = public
as $$
  select
    f.id, f.subject, f.chapter_key, f.chapter_name, f.front, f.back,
    coalesce(fp.due_date, (now() at time zone 'Asia/Kolkata')::date) as due_date,
    coalesce(fp.ease_factor, 2.5)        as ease_factor,
    coalesce(fp.interval_days, 0)        as interval_days,
    coalesce(fp.repetitions, 0)          as repetitions,
    coalesce(fp.is_known, false)         as is_known
  from      public.flashcards         f
  left join public.flashcard_progress fp
         on fp.card_id      = f.id
        and fp.firebase_uid = p_uid
  where f.firebase_uid = p_uid
    and f.chapter_key  = p_chapter_key
  order by coalesce(fp.due_date, (now() at time zone 'Asia/Kolkata')::date) asc, f.id asc;
$$;

-- Correction: the previous migration used bare current_date/now() for
-- due_date/last_seen — that's the DB server's timezone (UTC on Supabase),
-- but errorNotebook.js always used IST_DATE() (Asia/Kolkata) for this exact
-- purpose, deliberately, everywhere in the original code. Re-defining the
-- affected functions to use IST consistently so the RPC port doesn't
-- silently shift due-date boundaries by the UTC/IST offset.

create or replace function public.save_wrong_answers(p_uid text, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare r jsonb; v_existing_id uuid; v_today date;
begin
  v_today := (now() at time zone 'Asia/Kolkata')::date;
  for r in select * from jsonb_array_elements(p_rows) loop
    select id into v_existing_id
    from public.question_history
    where user_id = p_uid and question_id = r->>'question_id' and is_mastered = false
    limit 1;

    if v_existing_id is not null then
      update public.question_history set
        user_answer = r->>'user_answer',
        due_date    = v_today,
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
        v_today, 2.5, 1, 0
      );
    end if;
  end loop;
end;
$$;

create or replace function public.get_due_questions(p_uid text, p_limit int default 20)
returns setof public.question_history
language sql security definer set search_path = public as $$
  select * from public.question_history
  where user_id = p_uid and is_mastered = false and due_date <= (now() at time zone 'Asia/Kolkata')::date
  order by due_date asc
  limit p_limit;
$$;

create or replace function public.record_review(p_uid text, p_history_id uuid, p_grade int)
returns public.question_history
language plpgsql security definer set search_path = public as $$
declare
  v_ease real; v_int integer; v_reps integer; v_mastered boolean; v_row public.question_history; v_today date;
begin
  v_today := (now() at time zone 'Asia/Kolkata')::date;
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
    due_date = v_today + v_int, is_mastered = v_mastered,
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
    'due',      (select count(*) from public.question_history where user_id = p_uid and is_mastered = false and due_date <= (now() at time zone 'Asia/Kolkata')::date),
    'mastered', (select count(*) from public.question_history where user_id = p_uid and is_mastered = true)
  );
$$;

create or replace function public.update_weak_topics(p_uid text, p_rows jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_existing record; v_new_wrong int; v_new_total int; v_today date;
begin
  v_today := (now() at time zone 'Asia/Kolkata')::date;
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
        last_seen = v_today,
        updated_at = now()
      where id = v_existing.id;
    else
      insert into public.user_weak_topics (user_id, subject, topic, wrong_count, total_attempts, accuracy_pct, last_seen)
      values (
        p_uid, r->>'subject', r->>'topic', (r->>'wrong')::int, (r->>'total')::int,
        round((((r->>'total')::int - (r->>'wrong')::int)::numeric / (r->>'total')::int) * 100),
        v_today
      );
    end if;
  end loop;
end;
$$;
