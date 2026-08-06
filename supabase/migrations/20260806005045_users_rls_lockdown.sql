-- PART A1: users table lockdown — every account was exposed via a
-- `USING(true)` policy open to the public anon key (confirmed live:
-- `GET /rest/v1/users?select=*` returned the full table, no auth needed).
-- Same architectural constraint as BUG-002/doubt_chats: this app's anon JWT
-- has no `sub` claim, so auth.uid()-based RLS is a dead end — access moves
-- entirely through SECURITY DEFINER RPCs instead, matching the admin_*
-- pattern.
--
-- Note on trust model: these RPCs still trust a client-supplied p_uid, the
-- same way every other RPC in this app does (mark_flashcard_known,
-- saveTestSession, etc.) — this app cannot verify "you are really uid X"
-- without integrating Firebase JWT verification into Postgres, a separate,
-- much larger project (flagged, not attempted here). What this migration
-- actually closes is bulk exposure: no more dumping the entire table with
-- one unauthenticated request, no more open substring search across every
-- student's name/email/phone from the anon key. Every read/write now
-- requires a specific known uid (or goes through an admin-checked path),
-- which is the real, meaningful improvement over the current state.
--
-- Legitimate cross-identity reads accounted for (not broken by this):
--   - ParentDashboardPage.jsx reads a student's row for a uid that isn't
--     the viewer's own — gated by parent_student_links' link_token at the
--     app level, not by Postgres identity. get_own_user() stays a plain
--     single-row-by-known-uid lookup (same shape as today's getUser), so
--     this flow needs zero changes.
--   - AdminStudents.jsx writes to OTHER students' rows — that's a genuine
--     admin operation, given its own admin_update_user() RPC, not folded
--     into "own" write.

drop policy if exists users_open on public.users;

create or replace function public.get_own_user(p_uid text)
returns public.users
language sql
security definer
set search_path = public
as $$
  select * from public.users where firebase_uid = p_uid;
$$;

create or replace function public.upsert_own_user(p_uid text, p_fields jsonb)
returns public.users
language sql
security definer
set search_path = public
as $$
  insert into public.users (
    firebase_uid, auth_method, display_name, email, phone_number, photo_url,
    onboarding_completed, target_exam, syllabus, class_level
  )
  values (
    p_uid,
    p_fields->>'auth_method', p_fields->>'display_name', p_fields->>'email',
    p_fields->>'phone_number', p_fields->>'photo_url',
    coalesce((p_fields->>'onboarding_completed')::boolean, false),
    p_fields->>'target_exam', p_fields->>'syllabus', p_fields->>'class_level'
  )
  on conflict (firebase_uid) do update set
    auth_method           = coalesce(excluded.auth_method, public.users.auth_method),
    display_name          = coalesce(excluded.display_name, public.users.display_name),
    email                 = coalesce(excluded.email, public.users.email),
    phone_number          = coalesce(excluded.phone_number, public.users.phone_number),
    photo_url             = coalesce(excluded.photo_url, public.users.photo_url),
    onboarding_completed  = coalesce((p_fields->>'onboarding_completed')::boolean, public.users.onboarding_completed),
    target_exam           = coalesce(excluded.target_exam, public.users.target_exam),
    syllabus               = coalesce(excluded.syllabus, public.users.syllabus),
    class_level            = coalesce(excluded.class_level, public.users.class_level)
  returning *;
$$;

create or replace function public.update_own_user(p_uid text, p_fields jsonb)
returns public.users
language sql
security definer
set search_path = public
as $$
  update public.users set
    auth_method           = coalesce(p_fields->>'auth_method', auth_method),
    display_name          = coalesce(p_fields->>'display_name', display_name),
    email                 = coalesce(p_fields->>'email', email),
    phone_number          = coalesce(p_fields->>'phone_number', phone_number),
    photo_url             = coalesce(p_fields->>'photo_url', photo_url),
    onboarding_completed  = coalesce((p_fields->>'onboarding_completed')::boolean, onboarding_completed),
    target_exam           = coalesce(p_fields->>'target_exam', target_exam),
    syllabus               = coalesce(p_fields->>'syllabus', syllabus),
    class_level            = coalesce(p_fields->>'class_level', class_level)
  where firebase_uid = p_uid
  returning *;
$$;

-- Phone dedup check (AuthContext's phone sign-in flow) — returns only the
-- firebase_uid, not the full profile, since the caller isn't authenticated
-- as that other identity at this point in the flow.
create or replace function public.check_phone_registered(p_phone text)
returns text
language sql
security definer
set search_path = public
as $$
  select firebase_uid from public.users where phone_number = p_phone limit 1;
$$;

create or replace function public.admin_list_users(p_caller text)
returns setof public.users
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;
  return query select * from public.users order by created_at desc;
end; $$;

create or replace function public.admin_search_users(p_caller text, p_query text, p_limit int default 8)
returns setof public.users
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;
  return query
    select * from public.users
    where firebase_uid = p_query
       or email ilike '%' || p_query || '%'
       or display_name ilike '%' || p_query || '%'
    limit p_limit;
end; $$;

create or replace function public.admin_get_user(p_caller text, p_uid text)
returns public.users
language plpgsql security definer set search_path = public as $$
declare v_role text; v_row public.users;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;
  select * into v_row from public.users where firebase_uid = p_uid;
  return v_row;
end; $$;

create or replace function public.admin_update_user(p_caller text, p_target_uid text, p_fields jsonb)
returns public.users
language plpgsql security definer set search_path = public as $$
declare v_role text; v_row public.users;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;
  update public.users set
    display_name = coalesce(p_fields->>'display_name', display_name),
    target_exam  = coalesce(p_fields->>'target_exam', target_exam),
    syllabus     = coalesce(p_fields->>'syllabus', syllabus),
    class_level  = coalesce(p_fields->>'class_level', class_level)
  where firebase_uid = p_target_uid
  returning * into v_row;
  return v_row;
end; $$;

create or replace function public.admin_list_all_firebase_uids(p_caller text)
returns setof text
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;
  return query select firebase_uid from public.users limit 2000;
end; $$;

create or replace function public.admin_bulk_upsert_test_users(p_caller text, p_rows jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;
  insert into public.users (firebase_uid, display_name, email, target_exam, syllabus, class_level, onboarding_completed, auth_method)
  select
    r->>'firebase_uid', r->>'display_name', r->>'email', r->>'target_exam',
    r->>'syllabus', r->>'class_level',
    coalesce((r->>'onboarding_completed')::boolean, true),
    coalesce(r->>'auth_method', 'google')
  from jsonb_array_elements(p_rows) r
  on conflict (firebase_uid) do update set
    display_name = excluded.display_name, email = excluded.email,
    target_exam = excluded.target_exam, syllabus = excluded.syllabus,
    class_level = excluded.class_level;
end; $$;

grant execute on function public.get_own_user(text) to anon;
grant execute on function public.upsert_own_user(text, jsonb) to anon;
grant execute on function public.update_own_user(text, jsonb) to anon;
grant execute on function public.check_phone_registered(text) to anon;
grant execute on function public.admin_list_users(text) to anon;
grant execute on function public.admin_search_users(text, text, int) to anon;
grant execute on function public.admin_get_user(text, text) to anon;
grant execute on function public.admin_update_user(text, text, jsonb) to anon;
grant execute on function public.admin_list_all_firebase_uids(text) to anon;
grant execute on function public.admin_bulk_upsert_test_users(text, jsonb) to anon;
