-- HOTFIX for 20260924000000's upsert_own_notification_prefs.
--
-- Found by the post-deploy verification (check P6), live, 2026-09-24:
-- every call that did not include email_enabled failed with
--   23502 null value in column "email_enabled" ... violates not-null constraint
-- because the INSERT half of the upsert passed an explicit NULL for every
-- column the caller did not send. Postgres checks NOT NULL on the proposed
-- insert row BEFORE resolving ON CONFLICT, so this failed for existing rows
-- too, not only first-time ones. Broken: turning on push (web and native
-- FCM registration), turning push off, and the WhatsApp toggle. The old
-- client-side upsert omitted absent columns, so their column defaults applied.
--
-- Fix: an absent key falls back to that column's own default
-- (email_enabled true, push_enabled false, whatsapp_enabled false,
-- daily_reminder 19:00), matching what the old upsert produced for a first
-- row. The ON CONFLICT half is unchanged: a present key sets the column
-- (including to NULL for the nullable push subscription fields), an absent
-- key keeps the existing value.

create or replace function public.upsert_own_notification_prefs(p_uid text, p_fields jsonb)
returns public.notification_prefs
language plpgsql security definer
set search_path = public
as $$
declare
  v_allowed text[] := array['push_enabled','push_endpoint','push_p256dh','push_auth',
                            'push_fcm_token','email_enabled','whatsapp_enabled','daily_reminder'];
  v_bad  text;
  v_row  public.notification_prefs;
begin
  perform public.assert_verified_self(p_uid);
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' then
    raise exception 'p_fields must be a JSON object' using errcode = '22023';
  end if;
  select k into v_bad from jsonb_object_keys(p_fields) k where k <> all (v_allowed) limit 1;
  if v_bad is not null then
    raise exception 'Field not allowed: %', v_bad using errcode = '22023';
  end if;

  insert into public.notification_prefs as np (
    user_id, push_enabled, push_endpoint, push_p256dh, push_auth, push_fcm_token,
    email_enabled, whatsapp_enabled, daily_reminder, updated_at
  ) values (
    p_uid,
    coalesce((p_fields->>'push_enabled')::boolean, false),
    p_fields->>'push_endpoint', p_fields->>'push_p256dh',
    p_fields->>'push_auth', p_fields->>'push_fcm_token',
    coalesce((p_fields->>'email_enabled')::boolean, true),
    coalesce((p_fields->>'whatsapp_enabled')::boolean, false),
    coalesce((p_fields->>'daily_reminder')::time, '19:00:00'::time),
    now()
  )
  on conflict (user_id) do update set
    push_enabled     = case when p_fields ? 'push_enabled'     then excluded.push_enabled     else np.push_enabled     end,
    push_endpoint    = case when p_fields ? 'push_endpoint'    then excluded.push_endpoint    else np.push_endpoint    end,
    push_p256dh      = case when p_fields ? 'push_p256dh'      then excluded.push_p256dh      else np.push_p256dh      end,
    push_auth        = case when p_fields ? 'push_auth'        then excluded.push_auth        else np.push_auth        end,
    push_fcm_token   = case when p_fields ? 'push_fcm_token'   then excluded.push_fcm_token   else np.push_fcm_token   end,
    email_enabled    = case when p_fields ? 'email_enabled'    then excluded.email_enabled    else np.email_enabled    end,
    whatsapp_enabled = case when p_fields ? 'whatsapp_enabled' then excluded.whatsapp_enabled else np.whatsapp_enabled end,
    daily_reminder   = case when p_fields ? 'daily_reminder'   then excluded.daily_reminder   else np.daily_reminder   end,
    updated_at       = now()
  returning * into v_row;
  return v_row;
end;
$$;

-- create or replace keeps the existing ACL (PUBLIC already revoked in
-- 20260924000000); restated so this file is correct on its own.
revoke execute on function public.upsert_own_notification_prefs(text, jsonb) from public;
grant execute on function public.upsert_own_notification_prefs(text, jsonb) to anon, authenticated, service_role;
