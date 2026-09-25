-- Admin Online Now / Recent registrations: show a student's mobile number or
-- email when they have no name, and readable board names in the owner email
-- (owner request 2026-09-25).
--
-- The two admin feed RPCs now also return phone_number and email. They stay
-- behind assert_verified_admin (a student gets 42501); `users` itself remains
-- unreadable to students (RLS on, no policies) — the numbers reach an admin
-- screen only through these two functions.
--
-- Display order everywhere: name → mobile number → email → "Unnamed student".
-- The web admin applies it with src/lib/displayLabels.js; the owner email
-- applies it here (the email is rendered from this payload).

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
                 'uid', s.firebase_uid, 'name', s.display_name,
                 'phone_number', s.phone_number, 'email', s.email,
                 'class_level', s.class_level, 'board', s.syllabus, 'target_exam', s.target_exam,
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
        select e.user_id as uid, u.display_name as name, u.phone_number, u.email,
               u.class_level, u.syllabus as board,
               u.target_exam, u.auth_method, e.registered_at, e.onboarded_at, e.backfilled,
               case when e.onboarded_at is null then 'onboarding_pending' else 'onboarded' end as status
          from public.registration_events e join public.users u on u.firebase_uid = e.user_id
         order by e.registered_at desc
         limit least(greatest(coalesce(p_limit, 20), 1), 100)) x), '[]'::json)
  );
end;
$$;

-- Owner email: same name fallback, and the board's display title from the
-- onboarding catalogue (the table the app's board labels come from), so the
-- email says "Kerala State", not "KERALA_STATE".
create or replace function public._email_admin_new_registration(p_uid text)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_url text; v_key text; v_internal text; v_req bigint; v_board text;
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

  select title into v_board from public.onboarding_category_display
   where option_type = 'board' and option_key = u.syllabus limit 1;
  v_board := coalesce(v_board,
    case when u.syllabus like '%\_%' then initcap(replace(u.syllabus, '_', ' ')) else u.syllabus end);

  select net.http_post(
    url     := v_url || '/functions/v1/send-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key,
                                  'x-internal-secret', v_internal),
    body    := jsonb_build_object(
      'admin_alert', true,
      'template',    'admin_new_registration',
      'data', jsonb_build_object(
        'name',         coalesce(nullif(trim(u.display_name), ''), nullif(trim(u.phone_number), ''),
                                 nullif(trim(u.email), ''), 'Unnamed student'),
        'phone',        u.phone_number,
        'email',        u.email,
        'classLevel',   u.class_level,
        'board',        v_board,
        'targetExam',   u.target_exam,
        'authMethod',   u.auth_method,
        'registeredAt', to_char((coalesce(u.created_at, now()) at time zone 'Asia/Kolkata'), 'DD Mon YYYY, HH12:MI AM') || ' IST'
      )
    )
  ) into v_req;
  update public.registration_events set email_request_id = v_req, email_error = null where user_id = p_uid;
end;
$$;
revoke all on function public._email_admin_new_registration(text) from public, anon, authenticated;

-- create or replace keeps existing grants; restated so the file is self-contained.
revoke all on function public.admin_get_online_students(text, integer)     from public;
revoke all on function public.admin_get_recent_registrations(text, integer) from public;
grant execute on function public.admin_get_online_students(text, integer)     to anon;
grant execute on function public.admin_get_recent_registrations(text, integer) to anon;
