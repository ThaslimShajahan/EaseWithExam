-- Rollback for 20260926000000_edge_caller_verification.sql.
-- ORDER: redeploy the previous edge function versions FIRST (they still
-- accept body caller_uid), then run this. whoami_verified is left in place.
CREATE OR REPLACE FUNCTION public.send_expiry_reminders()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
grant execute on function public.send_expiry_reminders() to anon, authenticated;
grant execute on function public.expire_subscriptions() to anon, authenticated;
