-- Replaces the global "unlimited for everyone" campaign toggle (removed from
-- the app tonight) with PER-STUDENT grants through quota_overrides — a table
-- that already existed, already had the right shape (user_id, six per-field
-- limits, expires_at, reason, set_by_admin), and was already read by
-- resolveQuota() in quota.js. It simply had no write path and no UI. This
-- migration adds the write path; the UI lands in the Students editor.
--
-- Also removes the three coaching-centre quota_config rows (centre_free,
-- centre_premium, centre_enterprise) — no coaching customers exist yet, and an
-- unused row is a thing that can drift silently. get_student_effective_plan can
-- still return those plan ids; resolveQuota falls through to FREE_LIMITS for any
-- plan_id with no quota_config row, which is the conservative direction.

delete from public.quota_config where plan_id in ('centre_free', 'centre_premium', 'centre_enterprise');

-- ── Expiry-reminder bookkeeping ──────────────────────────────────────────────
-- Added here (not in the reminders migration) because admin_set_quota_override
-- below needs to reset it on re-grant. subscriptions already had a single
-- `reminder_sent_at` timestamp, unused by any code — insufficient for three
-- distinct reminder points (3-day / 1-day / day-of), since one timestamp cannot
-- record "which of the three fired" without overloading its meaning. A small
-- int tracks the highest stage reached; 0 = none sent. Nullable-free with a
-- default, additive, and existing rows start at the safe "nothing sent yet"
-- state rather than needing a backfill.
alter table public.subscriptions    add column if not exists reminder_stage smallint not null default 0;
alter table public.quota_overrides  add column if not exists reminder_stage smallint not null default 0;

-- ── RLS tightened before this table becomes meaningful ──────────────────────
-- quota_overrides carried a read-open SELECT policy (`qual: true`) from whenever
-- it was created. Harmless at 0 rows; about to stop being harmless, because a
-- student directly querying `.from('quota_overrides').select()` with the anon
-- key would otherwise be able to read every OTHER student's grant reason,
-- expiry date and limits. Firebase JWTs carry no `role` claim, so this is not a
-- role check — verified_uid() reads the actual `sub` claim from the JWT itself.
drop policy if exists quota_overrides_read on public.quota_overrides;
create policy quota_overrides_self_read on public.quota_overrides
  for select using (user_id = public.verified_uid());
-- Admin reads go through admin_get_quota_override below (SECURITY DEFINER,
-- bypasses RLS by design, same as every other admin_* RPC tonight) — they do
-- not need a table-level policy.

-- ── Write: create or update a student's grant ───────────────────────────────
-- ON CONFLICT (user_id) DO UPDATE rather than upsert-by-id: one active grant
-- per student is the whole model (re-granting replaces it, it does not stack).
--
-- p_expires_at is REQUIRED and must be in the future. An override with no
-- expiry or a past one is not a grant, it is either a permanent plan change
-- (use quota_config / a real subscription for that) or a mistake — refusing
-- both here is what makes "temporary, per-student" actually temporary rather
-- than a second unlimited-forever switch with worse visibility than the one
-- just removed.
create or replace function public.admin_set_quota_override(
  p_caller text, p_user_id text,
  p_ai_questions integer, p_veda_messages integer, p_mock_tests integer,
  p_paper_evaluations integer, p_podcasts integer, p_paper_generations integer,
  p_expires_at timestamptz, p_reason text default null
) returns quota_overrides
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_row quota_overrides;
begin
  perform assert_verified_admin(p_caller);  -- P0.5
  if not exists (select 1 from admins where uid = p_caller and is_active = true) then
    raise exception 'Unauthorized';
  end if;

  if not exists (select 1 from users where firebase_uid = p_user_id) then
    raise exception 'No such user: %', p_user_id using errcode = 'P0002';
  end if;

  if p_expires_at is null then
    raise exception 'p_expires_at is required — a grant with no expiry is not a temporary override' using errcode = '22023';
  end if;
  if p_expires_at <= now() then
    raise exception 'p_expires_at (%) must be in the future', p_expires_at using errcode = '22023';
  end if;

  insert into quota_overrides (
    user_id, ai_questions, veda_messages, mock_tests,
    paper_evaluations, podcasts, paper_generations,
    expires_at, reason, set_by_admin, updated_at)
  values (
    p_user_id, p_ai_questions, p_veda_messages, p_mock_tests,
    p_paper_evaluations, p_podcasts, p_paper_generations,
    p_expires_at, p_reason, p_caller, now())
  on conflict (user_id) do update set
    ai_questions       = excluded.ai_questions,
    veda_messages      = excluded.veda_messages,
    mock_tests         = excluded.mock_tests,
    paper_evaluations  = excluded.paper_evaluations,
    podcasts           = excluded.podcasts,
    paper_generations  = excluded.paper_generations,
    expires_at         = excluded.expires_at,
    reason             = excluded.reason,
    set_by_admin       = excluded.set_by_admin,
    updated_at         = now(),
    -- A fresh grant is a fresh notification schedule. Without resetting this,
    -- re-granting a student who was already at stage 3 (day-of reminder already
    -- sent for the OLD expiry) would silently never remind them about the new
    -- one, because send_expiry_reminders only fires when target_stage exceeds
    -- the stored stage.
    reminder_stage     = 0
  returning * into v_row;

  return v_row;
end;
$function$;

create or replace function public.admin_clear_quota_override(p_caller text, p_user_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform assert_verified_admin(p_caller);  -- P0.5
  if not exists (select 1 from admins where uid = p_caller and is_active = true) then
    raise exception 'Unauthorized';
  end if;

  delete from quota_overrides where user_id = p_user_id;
end;
$function$;

-- ── Read: one student's grant, for the Students editor ──────────────────────
-- Deliberately separate from admin_get_user rather than folded into it: not
-- every admin_get_user call needs a quota_overrides join, and a null return
-- (no grant) must not be confused with a query error.
create or replace function public.admin_get_quota_override(p_caller text, p_user_id text)
returns quota_overrides
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_row quota_overrides;
begin
  perform assert_verified_admin(p_caller);  -- P0.5
  if not exists (select 1 from admins where uid = p_caller and is_active = true) then
    raise exception 'Unauthorized';
  end if;

  select * into v_row from quota_overrides where user_id = p_user_id;
  return v_row;  -- null row (all fields null) if none exists; caller checks .id
end;
$function$;

-- anon is included deliberately: Firebase JWTs carry no `role` claim so every
-- PostgREST request runs as anon; the real gate is assert_verified_admin plus
-- the admins-table role check in each body. See 20260813080000.
grant execute on function public.admin_set_quota_override(
  text, text, integer, integer, integer, integer, integer, integer, timestamptz, text
) to anon, authenticated;
grant execute on function public.admin_clear_quota_override(text, text) to anon, authenticated;
grant execute on function public.admin_get_quota_override(text, text) to anon, authenticated;
