-- BUG-004: Flashcards had no real spaced repetition. Two `mark_flashcard_known`
-- overloads existed (bigint p_id → flashcard_progress, dead uuid p_id → a
-- flashcards.user_id/is_known shape that doesn't exist on the live table) and
-- PostgREST could not disambiguate between them — every markFlashcard() call
-- from the client failed with PGRST203 "Could not choose the best candidate
-- function". This replaces both with a single graded review RPC running the
-- same SM-2 math already proven in question_history / errorNotebook.js.

alter table public.flashcard_progress
  add column if not exists ease_factor   numeric  not null default 2.5,
  add column if not exists interval_days integer  not null default 0,
  add column if not exists repetitions   integer  not null default 0,
  add column if not exists due_date      date     not null default current_date;

drop function if exists public.mark_flashcard_known(text, bigint, boolean);
drop function if exists public.mark_flashcard_known(text, uuid, boolean);

-- grade: 1=again (forgot), 3=hard, 4=good, 5=easy — same scale/formula as
-- errorNotebook.js's recordReview(), so both spaced-repetition surfaces in
-- the app behave identically from a student's perspective.
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
begin
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
    (p_uid, p_id, v_known, now(), v_ease, v_int, v_reps, current_date + v_int)
  on conflict on constraint flashcard_progress_owner_card_uq
  do update set
    is_known      = excluded.is_known,
    reviewed_at   = now(),
    ease_factor   = excluded.ease_factor,
    interval_days = excluded.interval_days,
    repetitions   = excluded.repetitions,
    due_date      = excluded.due_date;

  return query
  select p_id, v_ease, v_int, v_reps, (current_date + v_int), v_known;
end;
$$;

grant execute on function public.review_flashcard(text, bigint, int) to anon;

-- Extended with SM-2 state + due_date-first ordering so the review queue
-- actually surfaces overdue/never-reviewed cards first instead of insertion
-- order. Unreviewed cards (no flashcard_progress row yet) sort as due today.
drop function if exists public.get_user_flashcards(text, text);

create function public.get_user_flashcards(p_uid text, p_chapter_key text)
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
    coalesce(fp.due_date, current_date)  as due_date,
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
  order by coalesce(fp.due_date, current_date) asc, f.id asc;
$$;
