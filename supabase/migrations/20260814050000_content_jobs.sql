-- A durable record of what the bulk content loader actually did, per file.
--
-- WHY THIS EXISTS
-- scripts/bulk-load-unit-notes.mjs already processes a directory unattended and
-- prints a per-file result. The problem is that the record lives in a terminal:
-- close it and the only evidence of what ran, what it produced, and why it
-- stopped is gone. That bit tonight — a browser crash on one unit left nothing
-- to diagnose from, and the "did it write?" question had to be answered by
-- counting rows in knowledge_base and inferring backwards.
--
-- Tier 1 of the job-runner work (owner-approved 2026-08-14): persistence only.
-- No queue, no claim/resume semantics, no worker orchestration — the script is
-- still the thing that decides what to run and in what order. It simply writes
-- down what happened. Tier 2 (a real queue plus a Status tab) is deliberately
-- deferred until the Unit 5 crash is characterised, because resume semantics
-- should be designed around a failure mode that is understood rather than
-- guessed at.
--
-- Deliberately NOT unique on (source_file): re-running a file is a legitimate,
-- if dangerous, operation and each attempt is its own row. `run_id` groups the
-- rows from one invocation so a run reads as a unit.

create table if not exists public.content_jobs (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null,
  source_file   text not null,
  exam_type     text not null,
  subject       text not null,
  book          text,
  file_ordinal  integer,
  -- skipped = the already-loaded guard dropped it; not a failure.
  status        text not null default 'running'
                check (status in ('running', 'done', 'failed', 'skipped')),
  -- What the approved manifest said this file should produce, and what actually
  -- came out. Kept as two columns rather than one because the interesting
  -- question after a bad run is precisely how they differ.
  chapters_expected text[] not null default '{}',
  chapters_written  text[] not null default '{}',
  chunk_count   integer not null default 0,
  error         text,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create index if not exists content_jobs_run_idx    on public.content_jobs (run_id, started_at);
create index if not exists content_jobs_recent_idx on public.content_jobs (started_at desc);

comment on table public.content_jobs is
  'Per-file audit trail for scripts/bulk-load-unit-notes.mjs. Written by the '
  'loader through admin_record_content_job. Not a work queue — nothing reads '
  'this to decide what to run next (Tier 2).';

alter table public.content_jobs enable row level security;

-- No policies. Every read and write goes through the SECURITY DEFINER functions
-- below, which check the caller in their body. Firebase JWTs carry no `role`
-- claim, so PostgREST runs every request as `anon` and a role-based policy could
-- not distinguish an admin from anyone else anyway — see 20260813080000 for the
-- empirical proof behind that rule.

/* Upsert by id so the loader can open a row when a file starts and close it when
 * the file finishes, without needing to know whether it exists. p_id null =
 * create; otherwise update in place. */
create or replace function public.admin_record_content_job(
  p_caller            text,
  p_id                uuid,
  p_run_id            uuid,
  p_source_file       text,
  p_exam_type         text,
  p_subject           text,
  p_book              text default null,
  p_file_ordinal      integer default null,
  p_status            text default 'running',
  p_chapters_expected text[] default '{}',
  p_chapters_written  text[] default '{}',
  p_chunk_count       integer default 0,
  p_error             text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid;
begin
  perform assert_verified_admin(p_caller);

  if p_id is null then
    insert into content_jobs (
      run_id, source_file, exam_type, subject, book, file_ordinal, status,
      chapters_expected, chapters_written, chunk_count, error,
      finished_at)
    values (
      p_run_id, p_source_file, p_exam_type, p_subject, p_book, p_file_ordinal, p_status,
      coalesce(p_chapters_expected, '{}'), coalesce(p_chapters_written, '{}'),
      coalesce(p_chunk_count, 0), p_error,
      case when p_status in ('done','failed','skipped') then now() end)
    returning id into v_id;
  else
    update content_jobs set
      status            = p_status,
      chapters_expected = coalesce(p_chapters_expected, chapters_expected),
      chapters_written  = coalesce(p_chapters_written, chapters_written),
      chunk_count       = coalesce(p_chunk_count, chunk_count),
      error             = p_error,
      -- Set once, when the job reaches a terminal state. A later update with a
      -- non-terminal status must not blank it.
      finished_at       = case when p_status in ('done','failed','skipped')
                               then coalesce(finished_at, now()) else finished_at end
    where id = p_id
    returning id into v_id;

    if v_id is null then
      raise exception 'content_job % not found', p_id using errcode = 'P0002';
    end if;
  end if;

  return v_id;
end;
$function$;

/* Read side. Returns jsonb rather than a rowtype so adding a column later does
 * not change the function signature and break PostgREST's cache. */
create or replace function public.admin_list_content_jobs(
  p_caller text,
  p_limit  integer default 100
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v jsonb;
begin
  perform assert_verified_admin(p_caller);

  select coalesce(jsonb_agg(to_jsonb(t) order by t.started_at desc), '[]'::jsonb)
    into v
    from (
      select * from content_jobs
       order by started_at desc
       limit greatest(1, least(coalesce(p_limit, 100), 500))
    ) t;

  return v;
end;
$function$;

-- anon is included deliberately: Firebase JWTs carry no `role` claim so every
-- PostgREST request runs as anon; the real gate is assert_verified_admin in the
-- body. See 20260813080000.
grant execute on function public.admin_record_content_job(
  text, uuid, uuid, text, text, text, text, integer, text, text[], text[], integer, text
) to anon, authenticated;
grant execute on function public.admin_list_content_jobs(text, integer) to anon, authenticated;
