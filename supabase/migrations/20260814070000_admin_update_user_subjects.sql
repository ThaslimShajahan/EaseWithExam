-- Let an admin repair a student's subjects and stream.
--
-- WHY THIS IS NOW URGENT
-- 20260814 made student-facing subject pickers scope to users.subjects, and
-- strictly: any profile subject that does not match the board list produces the
-- "complete your subject setup" prompt instead of a picker, on six screens.
-- That is the right behaviour — never guess — but it created a trap:
-- admin_update_user whitelists exactly four fields (display_name, target_exam,
-- syllabus, class_level) and neither `subjects` nor `academic_track` is one of
-- them. So a student whose subjects were wrong or missing could be locked out of
-- six tools with NO repair path: they cannot fix it, and neither could an admin.
--
-- The read side already works — admin_list_users / admin_get_user /
-- admin_search_users all return whole rows, so both columns already reach the
-- client and were simply never displayed. This migration is the write half only.
--
-- SHAPE OF THE TWO NEW FIELDS
--   subjects        text[]  — the resolved list, same thing onboarding writes via
--                             flattenSubjects()
--   academic_track  jsonb   — { board, stream, chosen_slot_subjects, ... }, from
--                             buildAcademicTrack()
--
-- Both use the same coalesce-on-absent pattern as the existing four, so a caller
-- that omits them leaves them untouched — no existing caller changes behaviour.
--
-- CLEARING is expressible, unlike the other four: passing JSON null explicitly
-- sets the column to NULL, which is required because "this student has no
-- subjects recorded" is a legitimate state an admin must be able to restore
-- (it is what every Class 8-10 student looks like). `p_fields ? 'subjects'`
-- distinguishes "key absent, leave alone" from "key present and null, clear it".

create or replace function public.admin_update_user(
  p_caller text, p_target_uid text, p_fields jsonb
) returns users
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_role text; v_row public.users;
begin
  perform assert_verified_admin(p_caller);  -- P0.5
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;

  update public.users set
    display_name = coalesce(p_fields->>'display_name', display_name),
    target_exam  = coalesce(p_fields->>'target_exam', target_exam),
    syllabus     = coalesce(p_fields->>'syllabus', syllabus),
    class_level  = coalesce(p_fields->>'class_level', class_level),

    -- Key ABSENT   -> unchanged.
    -- Key present, JSON null -> cleared.
    -- Key present, array     -> replaced wholesale (not merged; a subject list is
    --                           a set the admin is stating in full, and merging
    --                           would make removal impossible).
    subjects = case
      when not (p_fields ? 'subjects') then subjects
      when jsonb_typeof(p_fields->'subjects') = 'null' then null
      else (select array_agg(value::text order by ord)
              from jsonb_array_elements_text(p_fields->'subjects') with ordinality t(value, ord))
    end,

    academic_track = case
      when not (p_fields ? 'academic_track') then academic_track
      when jsonb_typeof(p_fields->'academic_track') = 'null' then null
      else p_fields->'academic_track'
    end

  where firebase_uid = p_target_uid
  returning * into v_row;

  if v_row.firebase_uid is null then
    raise exception 'No such user: %', p_target_uid using errcode = 'P0002';
  end if;

  return v_row;
end;
$function$;

-- anon is included deliberately: Firebase JWTs carry no `role` claim so every
-- PostgREST request runs as anon; the real gate is assert_verified_admin plus the
-- admins-table role check in the body. See 20260813080000.
grant execute on function public.admin_update_user(text, text, jsonb) to anon, authenticated;
