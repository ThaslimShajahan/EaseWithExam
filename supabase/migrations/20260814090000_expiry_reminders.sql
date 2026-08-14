-- Expiry reminders: email for subscriptions, email + in-app for quota grants.
--
-- OPTION A (owner decision, 2026-08-14, made explicitly to avoid touching a
-- live hourly job at this hour): expire_subscriptions() — already running via
-- cron.schedule('expire-subscriptions-hourly'), verified live before writing
-- this — is left COMPLETELY UNTOUCHED. It already sends one in-app reminder per
-- subscription (guarded by subscriptions.reminder_sent_at, its own column) plus
-- an expiry notification and the actual status flip. This migration adds
-- exactly what it does NOT do: EMAIL. For subscriptions that is a single touch,
-- reusing the SAME 3-day window expire_subscriptions already uses, so behaviour
-- for subscriptions does not change except that an email now goes out
-- alongside the in-app notification it already sent. quota_overrides has ZERO
-- existing coverage, so it gets the full three-stage schedule (3-day / 1-day /
-- day-of) with no collision possible.
--
-- KNOWN GAP, LOGGED RATHER THAN FIXED HERE: subscriptions get one reminder
-- touch, not three. Unifying both into one three-stage function under
-- reminder_stage is real follow-up work, deliberately deferred to a session
-- where editing the live hourly job can get full attention and an immediate
-- verified run — not appended to an already-long night.
--
-- WHY reminder_stage AND NOT reminder_sent_at, FOR THE EMAIL SIDE
-- reminder_sent_at is expire_subscriptions()'s own column, and "IS NOT NULL"
-- cannot mean "send exactly once" for a job running on a DIFFERENT schedule —
-- it may already be set from any point in the last 3 days, so it cannot
-- distinguish "just entered the window" from "entered it two days ago and I
-- already emailed". reminder_stage is untouched by expire_subscriptions(), so
-- using it here is genuinely a separate, non-interacting flag on the same
-- table — not a race with the hourly job, just two independent columns.
--
-- WHY net.http_post AND NOT waiting for the response
-- Fire-and-forget, matching the client's own sendTransactionalEmail() and
-- backgroundGeneration.js's push notification: "an email failing must never
-- block or fail the action that triggered it." Every request is still logged
-- in net._http_response for later auditing — verified manually before writing
-- this cron job at all (see the manual send below and the report).
--
-- pg_net and the vault secrets (project_url, anon_key) were already
-- provisioned as a prerequisite for this migration; see the session's own
-- verification, not repeated here as SQL because vault contents are
-- operational state, not schema.

create or replace function public.send_expiry_reminders()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_url  text;
  v_key  text;
  v_days int;
  v_target_stage int;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'anon_key';
  if v_url is null or v_key is null then
    -- Fail loudly into the Postgres log rather than silently sending nothing —
    -- a missing vault secret is a deploy/ops mistake, not a "no reminders due
    -- today" case, and the two must not look identical from outside.
    raise warning 'send_expiry_reminders: vault secrets missing (project_url=%, anon_key=%) — no reminders sent this run', (v_url is not null), (v_key is not null);
    return;
  end if;

  -- ── Subscriptions: EMAIL ONLY, single touch, same window expire_subscriptions() already reminds in-app for ──
  for r in
    select user_id, plan, expires_at from subscriptions
     where status = 'active'
       and expires_at is not null
       and expires_at between now() and now() + interval '3 days'
       and reminder_stage = 0
  loop
    perform net.http_post(
      url     := v_url || '/functions/v1/send-email',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
      body    := jsonb_build_object(
        'caller_uid', r.user_id, 'user_id', r.user_id, 'template', 'subscription_expiring',
        'data', jsonb_build_object(
          'planName', r.plan,
          'daysLeft', greatest(0, floor(extract(epoch from (r.expires_at - now())) / 86400))::int,
          'expiryDate', to_char(r.expires_at, 'DD Mon YYYY')
        )
      )
    );
    update subscriptions set reminder_stage = 1 where user_id = r.user_id;
  end loop;

  -- ── Quota grants: full 3-stage, EMAIL + IN-APP, pure net-new ──
  for r in
    select user_id, expires_at, reason, reminder_stage as stage_before from quota_overrides
     where expires_at is not null and expires_at > now() - interval '1 day'
     -- the lower bound excludes grants that expired more than a day ago —
     -- nothing to remind about a grant nobody will look at again; the loop
     -- below still recomputes target_stage per-row from the real expiry.
  loop
    v_days := floor(extract(epoch from (r.expires_at - now())) / 86400)::int;
    v_target_stage := case
      when v_days <= 0 then 3
      when v_days = 1  then 2
      when v_days <= 3 then 1
      else 0
    end;

    continue when v_target_stage <= r.stage_before;  -- nothing new to say this run

    insert into user_notifications (user_id, type, title, body, link, read, created_at)
    values (
      r.user_id, 'subscription_active',
      case when v_days <= 0 then 'Your bonus access ends today'
           else 'Your bonus access is ending soon' end,
      case when v_days <= 0 then 'Your extra quota grant ends today. You will revert to your normal plan limits.'
           else 'Your extra quota grant ends in ' || v_days || ' day(s) ('
                || to_char(r.expires_at, 'DD Mon YYYY') || '). You will revert to your normal plan limits after that.' end,
      '/profile', false, now()
    );

    perform net.http_post(
      url     := v_url || '/functions/v1/send-email',
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
      body    := jsonb_build_object(
        'caller_uid', r.user_id, 'user_id', r.user_id, 'template', 'subscription_expiring',
        'data', jsonb_build_object(
          'planName', coalesce('Bonus access (' || r.reason || ')', 'Your bonus access'),
          'daysLeft', greatest(0, v_days),
          'expiryDate', to_char(r.expires_at, 'DD Mon YYYY')
        )
      )
    );

    update quota_overrides set reminder_stage = v_target_stage where user_id = r.user_id;
  end loop;
end;
$function$;

grant execute on function public.send_expiry_reminders() to postgres;
-- No anon/authenticated grant — this is a cron-only function, never called from
-- the client. Unlike every admin_* RPC tonight, it has no assert_verified_admin
-- gate to hide behind; the correct protection is not being reachable by
-- PostgREST at all, which is what omitting the anon/authenticated grant does.

-- Scheduled daily, not hourly like expire_subscriptions() — a reminder does not
-- need hourly granularity, and running less often means less pg_net traffic and
-- fewer emails-in-flight to reason about if something needs debugging.
-- '30 3 * * *' = 09:00 IST (pg_cron runs in UTC; IST is UTC+5:30).
select cron.schedule('send-expiry-reminders-daily', '30 3 * * *', 'select public.send_expiry_reminders();');
