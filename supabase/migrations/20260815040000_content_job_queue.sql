-- Tier 2 of the background job runner: a real queue on top of Tier 1's
-- persistence-only content_jobs (20260814050000).
--
-- WHY NOW, WITHOUT THE UNIT 5 ROOT CAUSE
-- Tier 2 was deliberately deferred until the Unit 5 browser crash was
-- characterised, because resume semantics designed around an unknown failure
-- mode would be guesswork. That investigation never actually ran — checked
-- live: knowledge_base has zero rows for any of Unit 5's chapters, so the
-- "upload it manually and compare" experiment was never performed, and
-- content_jobs has zero rows ever, so the crashing run never got past
-- extraction to a real write.
--
-- The resume design below does not need to know WHY a worker died. It resumes
-- at FILE granularity using the same idempotency check bulk-load-unit-notes.mjs
-- already has (skip a file whose expected chapter_keys are already present in
-- knowledge_base) plus a claim staleness timeout — a job stuck in 'running'
-- past the timeout with no finished_at is presumed abandoned by a dead worker
-- and becomes reclaimable. That is safe regardless of what killed the worker.
--
-- STATE MACHINE
--   queued  -> running (claimed by a worker)
--   running -> done | failed | skipped   (terminal, via the existing
--              admin_record_content_job)
--   running -> queued  (reclaimed automatically on staleness, by the NEXT
--              admin_claim_next_content_job call — no separate sweep job)
--
-- 'running' already existed as a status in Tier 1 and meant "in progress,
-- one-shot script, nothing else will ever touch this row." It now also means
-- "claimed by a worker, may be stale" — the two are distinguished by whether
-- claimed_by/file_path are set (queue-driven) vs null (legacy immediate-run
-- rows written by --dir mode, unaffected by any of this).

alter table public.content_jobs
  add column if not exists file_path  text,
  add column if not exists claimed_by text;

comment on column public.content_jobs.file_path is
  'Absolute local path the worker reads the PDF from. Set on queue-driven '
  'jobs (admin_enqueue_content_job); null on legacy --dir immediate-run rows, '
  'which never needed to be found again later.';
comment on column public.content_jobs.claimed_by is
  'Opaque worker/run identifier from admin_claim_next_content_job. Null until '
  'claimed. Distinguishes "this run claimed and is working it" from a bare '
  '--dir invocation, which never claims anything.';

alter table public.content_jobs drop constraint if exists content_jobs_status_check;
alter table public.content_jobs
  add constraint content_jobs_status_check
  check (status in ('queued', 'running', 'done', 'failed', 'skipped'));

create index if not exists content_jobs_queued_idx
  on public.content_jobs (started_at)
  where status = 'queued';

comment on table public.content_jobs is
  'Per-file audit trail for the content loader, and (since Tier 2) a real '
  'work queue: admin_enqueue_content_job adds queued rows, '
  'admin_claim_next_content_job hands one to a worker, '
  'admin_record_content_job (Tier 1, unchanged) closes it out.';

/* ── Enqueue ──────────────────────────────────────────────────────────
 *
 * Refuses a duplicate enqueue of the same file while one is already
 * queued or running for the same (source_file, exam_type, subject, book) —
 * the CLI enqueue script is expected to be re-run over the same folder
 * (e.g. after adding new files), and silently piling up duplicate queue
 * rows would make the Status tab lie about how much work is actually left.
 * A file that finished (done/failed/skipped) can always be re-enqueued
 * deliberately — that is a new decision, not an accidental duplicate. */
create or replace function public.admin_enqueue_content_job(
  p_caller      text,
  p_file_path   text,
  p_source_file text,
  p_exam_type   text,
  p_subject     text,
  p_book        text default null,
  p_run_id      uuid default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid; v_existing uuid;
begin
  perform assert_verified_admin(p_caller);

  if p_file_path is null or btrim(p_file_path) = '' then
    raise exception 'file_path is required' using errcode = '22023';
  end if;

  select id into v_existing
    from content_jobs
   where source_file = p_source_file
     and exam_type   = p_exam_type
     and subject     = p_subject
     and coalesce(book, '') = coalesce(p_book, '')
     and status in ('queued', 'running')
   limit 1;

  if v_existing is not null then
    raise exception 'already queued or running as job %', v_existing using errcode = '23505';
  end if;

  insert into content_jobs (
    run_id, source_file, exam_type, subject, book, file_path, status
  ) values (
    coalesce(p_run_id, gen_random_uuid()), p_source_file, p_exam_type, p_subject, p_book, p_file_path, 'queued'
  ) returning id into v_id;

  return v_id;
end;
$function$;

/* ── Claim ────────────────────────────────────────────────────────────
 *
 * One atomic step: reclaim anything stale, then take the oldest queued row.
 * `for update skip locked` makes two workers claiming at the same instant
 * safe even though the documented posture is one worker at a time — cheap
 * insurance, not a concurrency feature being newly relied on.
 *
 * Returns the full claimed row as jsonb, or null when there is nothing to
 * do — the worker's loop condition. */
create or replace function public.admin_claim_next_content_job(
  p_caller             text,
  p_worker_id          text,
  p_stale_after_minutes integer default 30
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_row content_jobs%rowtype;
begin
  perform assert_verified_admin(p_caller);

  -- Reclaim stale claims first: 'running', past the staleness window, never
  -- finished. Back to 'queued' so the pick below can take it like any other
  -- queued row — including by a DIFFERENT worker than the one that died.
  update content_jobs
     set status = 'queued', claimed_by = null
   where status = 'running'
     and finished_at is null
     and claimed_by is not null
     and started_at < now() - make_interval(mins => greatest(1, coalesce(p_stale_after_minutes, 30)));

  select * into v_row
    from content_jobs
   where status = 'queued'
   order by started_at asc
   limit 1
   for update skip locked;

  if not found then
    return null;
  end if;

  update content_jobs
     set status = 'running', claimed_by = p_worker_id, started_at = now(), finished_at = null
   where id = v_row.id
  returning * into v_row;

  return to_jsonb(v_row);
end;
$function$;

/* ── Manual requeue ───────────────────────────────────────────────────
 * For the Status tab: an admin looking at a 'failed' job (e.g. fixed the
 * manifest since) can send it back to the queue without CLI access. Refuses
 * anything not currently terminal-failed, so it can't be used to yank a job
 * out from under a worker that is actively running it. */
create or replace function public.admin_requeue_content_job(
  p_caller text,
  p_id     uuid
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_id uuid;
begin
  perform assert_verified_admin(p_caller);

  update content_jobs
     set status = 'queued', claimed_by = null, error = null, finished_at = null
   where id = p_id and status = 'failed'
  returning id into v_id;

  if v_id is null then
    raise exception 'content_job % is not failed (only a failed job can be requeued)', p_id using errcode = '22023';
  end if;

  return v_id;
end;
$function$;

grant execute on function public.admin_enqueue_content_job(text, text, text, text, text, text, uuid) to anon, authenticated;
grant execute on function public.admin_claim_next_content_job(text, text, integer) to anon, authenticated;
grant execute on function public.admin_requeue_content_job(text, uuid) to anon, authenticated;
