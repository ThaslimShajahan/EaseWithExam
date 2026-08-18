-- Permanent, viewable deploy history — replacing "the deploy history lives in
-- chat transcripts and docs/DEPLOY.md's own prose" with a real table an admin
-- can open and read. Same shape as ai_call_log (20260816000000): the edge
-- function/admin screen writes it, RLS carries no policies at all, and reads
-- go through two SECURITY DEFINER RPCs gated by assert_verified_admin.
--
-- WHY THIS EXISTS
-- Every deploy already produces a real evidence trail (docs/DEPLOY.md's
-- 8-step procedure: the built bundle hash, the git commit, what shipped) —
-- but that trail lives in a terminal scrollback and chat history, gone the
-- moment the session ends. The first thing anyone can ask six months from now
-- ("when did we ship the manifest-draft model switch?") has no answer without
-- archaeology through commit messages. This table is that answer, queryable
-- and admin-visible going forward.
--
-- VERSIONING — date-based, not semver: 'YYYY.MM.DD.N' (e.g. '2026.08.18.1').
-- This is a single internally-deployed app with one live environment, not a
-- published package or API other consumers version against — semver's whole
-- point (signalling breaking vs. compatible changes to external consumers) has
-- no audience here. The migrations directory already timestamps everything by
-- calendar date; a deploy version that reads the same way is one less
-- convention to hold in your head, and 'N' lets a second same-day deploy
-- (which has genuinely happened before, see docs/DEPLOY.md's 2026-08-11
-- incident) still get a distinct, sortable number instead of colliding.

create table if not exists public.deploy_log (
  id                uuid primary key default gen_random_uuid(),
  version           text not null unique,             -- 'YYYY.MM.DD.N'
  summary           text not null,                     -- one-line, human-readable
  -- jsonb array: [{ "type": "added"|"changed"|"fixed"|"note", "text": "..." }, ...]
  -- One entry per shipped item — validated as an array (not its element shape)
  -- by the insert RPC, same "structural, not content" validation posture as
  -- chapter_manifests' own entries column.
  changes           jsonb not null default '[]'::jsonb,
  deployed_by       text,                               -- admin uid; client-reported, same posture as chapter_manifests.approved_by
  git_commit_hash   text,
  bundle_hash       text,                               -- the served assets/index-<hash>.js hash, from docs/DEPLOY.md step 1
  deployed_at       timestamptz not null default now()
);

create index if not exists deploy_log_deployed_at_idx on public.deploy_log (deployed_at desc);

comment on table public.deploy_log is
  'Permanent deploy history, written once per deploy by an admin following docs/DEPLOY.md''s standing instruction (write this BEFORE the 8-step procedure, using the bundle hash step 1 already produces). Read-only in the app beyond that one insert; no update/delete RPC exists on purpose — a deploy record should not be editable after the fact.';

alter table public.deploy_log enable row level security;
-- No policies for direct table access — same reasoning as ai_call_log and
-- content_jobs: reads and the one write both go through SECURITY DEFINER RPCs
-- below, which is where assert_verified_admin actually lives.

create or replace function public.admin_insert_deploy_log(
  p_caller text, p_version text, p_summary text, p_changes jsonb,
  p_git_commit_hash text default null, p_bundle_hash text default null
) returns uuid
language plpgsql security definer set search_path = public
as $function$
declare v_id uuid;
begin
  perform assert_verified_admin(p_caller);

  if p_version is null or btrim(p_version) = '' then
    raise exception 'version is required' using errcode = '22023';
  end if;
  if p_summary is null or btrim(p_summary) = '' then
    raise exception 'summary is required' using errcode = '22023';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'changes must be a jsonb array' using errcode = '22023';
  end if;

  insert into public.deploy_log (version, summary, changes, deployed_by, git_commit_hash, bundle_hash)
  values (p_version, p_summary, p_changes, p_caller, p_git_commit_hash, p_bundle_hash)
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'version % already has a deploy_log entry — use a new N (e.g. bump the trailing number)', p_version
      using errcode = '23505';
end;
$function$;

create or replace function public.admin_list_deploy_log(p_caller text, p_limit integer default 100)
returns setof public.deploy_log
language plpgsql security definer set search_path = public
as $function$
begin
  perform assert_verified_admin(p_caller);
  return query
    select * from public.deploy_log
     order by deployed_at desc
     limit least(coalesce(p_limit, 100), 500);
end;
$function$;

-- Firebase third-party-auth requests carry no Postgres `role` claim and run as
-- `anon` in PostgREST (20260809030000's own layer-1 role gate does not
-- retroactively cover functions created after it ran, and 20260815060000/
-- 20260816010000 both had to fix exactly this miss on other tables) — grant
-- anon directly here rather than repeating that incident a third time.
-- assert_verified_admin(p_caller) in the function body is the real boundary.
revoke all on function public.admin_insert_deploy_log(text,text,text,jsonb,text,text) from public;
revoke all on function public.admin_list_deploy_log(text,integer) from public;
grant execute on function public.admin_insert_deploy_log(text,text,text,jsonb,text,text) to anon, authenticated;
grant execute on function public.admin_list_deploy_log(text,integer) to anon, authenticated;
