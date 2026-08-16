-- Per-request audit trail for every AI call routed through ai-proxy — the one
-- shared edge function every OpenAI call in this app funnels through (chat
-- completions, streaming chat, images, embeddings, TTS). Written by the edge
-- function itself via the service role key, so it captures every call
-- regardless of which client feature made it, a client bug, or a retry —
-- it does not depend on any feature remembering to log itself.
--
-- WHY THIS EXISTS
-- 2026-08-16 usage investigation: $84.45 spent this month, and only ~15% of
-- it could be reconstructed after the fact from side-effects (knowledge_base
-- rows, content_figures, chapter_manifests). ai-proxy was a pure passthrough
-- with zero logging, so ~80% of spend was unattributable to any feature
-- without hours of DB archaeology. Every future spike should be answerable
-- from this table in minutes.
--
-- `feature` and `caller_uid` are CLIENT-SUPPLIED, not cryptographically
-- verified — ai-proxy has no reliable server-side caller identity (see this
-- migration's twin change in aiProxy.js: the client sends the plain anon key,
-- not a Firebase-bound JWT, so there is nothing here to run verified_uid()
-- against). Treat both as a diagnostic hint, not an auth-grade fact — good
-- enough to answer "which feature is spending money", not to bill a specific
-- user or as an authorization decision.

create table if not exists public.ai_call_log (
  id                uuid primary key default gen_random_uuid(),
  route             text not null,   -- 'chat' | 'images' | 'embeddings' | 'tts'
  feature           text,            -- caller-supplied tag, e.g. 'notes-extraction'; null = untagged caller
  model             text,
  caller_uid        text,            -- client-reported Firebase uid, if the caller passed one; unverified, see header
  status            integer,         -- HTTP status OpenAI returned (or the proxy's own on a network failure)
  streaming         boolean not null default false,  -- true = SSE passthrough; usage is not observable server-side, tokens stay null
  prompt_tokens     integer,
  completion_tokens integer,
  total_tokens      integer,
  duration_ms       integer,
  error             text,
  created_at        timestamptz not null default now()
);

create index if not exists ai_call_log_created_idx on public.ai_call_log (created_at desc);
create index if not exists ai_call_log_feature_idx on public.ai_call_log (feature, created_at desc);
create index if not exists ai_call_log_model_idx   on public.ai_call_log (model, created_at desc);

comment on table public.ai_call_log is
  'Per-request audit trail written by the ai-proxy edge function via the service role — every OpenAI call in the app funnels through ai-proxy, so this is a complete record independent of which feature or client bug made the call. feature/caller_uid are client-reported, not verified — see table header in 20260816000000_ai_call_log.sql.';

alter table public.ai_call_log enable row level security;
-- No policies for direct table access: the edge function writes via the
-- service role (bypasses RLS entirely), and reads go through the two admin
-- RPCs below — same shape as content_jobs (20260814050000).

create or replace function public.admin_list_ai_call_log(
  p_caller text, p_since timestamptz default null, p_feature text default null, p_limit integer default 500
) returns setof public.ai_call_log
language plpgsql security definer set search_path = public
as $function$
begin
  perform assert_verified_admin(p_caller);
  return query
    select * from public.ai_call_log
     where (p_since is null or created_at >= p_since)
       and (p_feature is null or feature = p_feature)
     order by created_at desc
     limit least(coalesce(p_limit, 500), 5000);
end;
$function$;

-- Grouped rollup — what the next spike investigation should reach for first,
-- rather than paging through raw rows.
create or replace function public.admin_ai_usage_summary(p_caller text, p_since timestamptz default null)
returns table (
  feature text, model text, route text, calls bigint,
  prompt_tokens bigint, completion_tokens bigint, total_tokens bigint, errors bigint
)
language plpgsql security definer set search_path = public
as $function$
begin
  perform assert_verified_admin(p_caller);
  return query
    select l.feature, l.model, l.route, count(*)::bigint as calls,
           coalesce(sum(l.prompt_tokens), 0)::bigint,
           coalesce(sum(l.completion_tokens), 0)::bigint,
           coalesce(sum(l.total_tokens), 0)::bigint,
           count(*) filter (where l.error is not null)::bigint
      from public.ai_call_log l
     where (p_since is null or l.created_at >= p_since)
     group by l.feature, l.model, l.route
     order by sum(coalesce(l.total_tokens, 0)) desc, calls desc;
end;
$function$;

revoke all on function public.admin_list_ai_call_log(text,timestamptz,text,integer) from public, anon;
revoke all on function public.admin_ai_usage_summary(text,timestamptz) from public, anon;
grant execute on function public.admin_list_ai_call_log(text,timestamptz,text,integer) to authenticated;
grant execute on function public.admin_ai_usage_summary(text,timestamptz) to authenticated;
