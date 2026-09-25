-- Rollback for 20260927010000_admin_feed_contact_fallback.sql: the three functions
-- exactly as 20260927000000 defined them (no phone/email; raw board in the email).
begin;

create or replace function public._email_admin_new_registration(p_uid text)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_url text; v_key text; v_internal text; v_req bigint;
  u public.users%rowtype;
begin
  select decrypted_secret into v_url      from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key      from vault.decrypted_secrets where name = 'anon_key';
  select decrypted_secret into v_internal from vault.decrypted_secrets where name = 'internal_call_secret';
  if v_url is null or v_key is null or v_internal is null then
    update public.registration_events set email_error = 'vault secrets missing' where user_id = p_uid;
    return;
  end if;
  select * into u from public.users where firebase_uid = p_uid;

  select net.http_post(
    url     := v_url || '/functions/v1/send-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key,
                                  'x-internal-secret', v_internal),
    body    := jsonb_build_object(
      'admin_alert', true,
      'template',    'admin_new_registration',
      'data', jsonb_build_object(
        'name',         coalesce(nullif(trim(u.display_name), ''), '(no name yet)'),
        'classLevel',   u.class_level,
        'board',        u.syllabus,
        'targetExam',   u.target_exam,
        'authMethod',   u.auth_method,
        'registeredAt', to_char((coalesce(u.created_at, now()) at time zone 'Asia/Kolkata'), 'DD Mon YYYY, HH12:MI AM') || ' IST'
      )
    )
  ) into v_req;
  update public.registration_events set email_request_id = v_req, email_error = null where user_id = p_uid;
end;
$$;


create or replace function public.admin_get_online_students(p_caller text, p_window_minutes integer default 2)
returns json
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_window int := least(greatest(coalesce(p_window_minutes, 2), 1), 60);
  v_today  timestamptz := date_trunc('day',  now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_week   timestamptz := date_trunc('week', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';  -- Monday
begin
  perform public.assert_verified_admin(p_caller);
  return (
    with students as (
      select u.* from public.users u
       where u.last_seen_at is not null
         and not exists (select 1 from public.admins a where a.uid = u.firebase_uid and a.is_active)
    )
    select json_build_object(
      'server_now',     now(),
      'window_minutes', v_window,
      'online_count',   (select count(*) from students where last_seen_at >= now() - make_interval(mins => v_window)),
      'active_today',   (select count(*) from students where last_seen_at >= v_today),
      'active_week',    (select count(*) from students where last_seen_at >= v_week),
      'online', coalesce((
        select json_agg(json_build_object(
                 'uid', s.firebase_uid, 'name', s.display_name, 'class_level', s.class_level,
                 'board', s.syllabus, 'target_exam', s.target_exam,
                 'last_seen_at', s.last_seen_at, 'platform', s.last_seen_platform)
               order by s.last_seen_at desc)
          from (select * from students
                 where last_seen_at >= now() - make_interval(mins => v_window)
                 order by last_seen_at desc limit 200) s), '[]'::json)
    )
  );
end;
$$;


create or replace function public.admin_get_recent_registrations(p_caller text, p_limit integer default 20)
returns json
language plpgsql stable security definer
set search_path = public
as $$
declare v_seen timestamptz;
begin
  perform public.assert_verified_admin(p_caller);
  select registrations_seen_at into v_seen from public.admin_feed_seen where admin_uid = p_caller;
  return json_build_object(
    'server_now', now(),
    'seen_at',    v_seen,
    'unseen_count', (select count(*) from public.registration_events e
                      where not e.backfilled and e.onboarded_at is not null
                        and e.onboarded_at > coalesce(v_seen, '-infinity'::timestamptz)),
    'items', coalesce((
      select json_agg(x order by x.registered_at desc) from (
        select e.user_id as uid, u.display_name as name, u.class_level, u.syllabus as board,
               u.target_exam, u.auth_method, e.registered_at, e.onboarded_at, e.backfilled,
               case when e.onboarded_at is null then 'onboarding_pending' else 'onboarded' end as status
          from public.registration_events e join public.users u on u.firebase_uid = e.user_id
         order by e.registered_at desc
         limit least(greatest(coalesce(p_limit, 20), 1), 100)) x), '[]'::json)
  );
end;
$$;


revoke all on function public._email_admin_new_registration(text) from public, anon, authenticated;
commit;
