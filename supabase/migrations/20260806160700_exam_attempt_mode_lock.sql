-- Item 7 (Batch 4): lock a student to whichever mode (online/paper) they
-- first started a given test in, so they cannot switch mid-attempt. Firebase
-- Auth has no `auth.uid()` in Postgres (see other tables in this project),
-- so this follows the established pattern: no direct-access RLS policies,
-- all access goes through SECURITY DEFINER RPCs taking an explicit p_uid.

create table if not exists exam_attempt_mode (
  id           uuid primary key default gen_random_uuid(),
  firebase_uid text not null,
  test_id      text not null,
  mode         text not null check (mode in ('online', 'paper')),
  started_at   timestamptz not null default now(),
  unique (firebase_uid, test_id)
);

alter table exam_attempt_mode enable row level security;
-- No policies — all access via SECURITY DEFINER RPCs below.

-- Idempotent: if a lock already exists for this uid+test, returns the
-- EXISTING mode (ignores p_mode) rather than erroring, so callers can always
-- call this on page mount and just check the returned mode against what
-- they're about to render.
create or replace function lock_exam_attempt_mode(p_uid text, p_test_id text, p_mode text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing text;
begin
  if p_mode not in ('online', 'paper') then
    raise exception 'invalid mode';
  end if;

  select mode into v_existing
  from exam_attempt_mode
  where firebase_uid = p_uid and test_id = p_test_id;

  if v_existing is not null then
    return v_existing;
  end if;

  insert into exam_attempt_mode (firebase_uid, test_id, mode)
  values (p_uid, p_test_id, p_mode)
  on conflict (firebase_uid, test_id) do nothing;

  select mode into v_existing
  from exam_attempt_mode
  where firebase_uid = p_uid and test_id = p_test_id;

  return v_existing;
end;
$$;

create or replace function get_exam_attempt_mode(p_uid text, p_test_id text)
returns text
language sql
security definer
set search_path = public
as $$
  select mode from exam_attempt_mode where firebase_uid = p_uid and test_id = p_test_id;
$$;

-- Called when a student explicitly discards in-progress work and starts a
-- genuinely fresh attempt ("Start Fresh") — frees the mode choice up again.
create or replace function clear_exam_attempt_mode(p_uid text, p_test_id text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from exam_attempt_mode where firebase_uid = p_uid and test_id = p_test_id;
$$;

grant execute on function lock_exam_attempt_mode(text, text, text) to anon, authenticated;
grant execute on function get_exam_attempt_mode(text, text) to anon, authenticated;
grant execute on function clear_exam_attempt_mode(text, text) to anon, authenticated;
