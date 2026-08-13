-- Class 11/12 stream-selection save path. Two additive, nullable columns on
-- `users`, and the two self-service field-bag RPCs extended to accept them.
--
-- WHY EXTENDING upsert_own_user/update_own_user RATHER THAN A NEW RPC
--
-- OnboardingPage.jsx already writes target_exam/syllabus/class_level through
-- upsertUser() -> upsert_own_user(p_uid, p_fields jsonb). That RPC is a
-- HARD-CODED FIELD ALLOW-LIST (see 20260806005045) -- it only extracts named
-- keys via p_fields->>'x', so passing `subjects` or `academic_track` today
-- is silently ignored, not an error. The stream-selection step reuses the
-- SAME save call the rest of onboarding already makes; extending the
-- allow-list is what makes that possible without a second write path a
-- student's profile save could partially fail through.
--
-- WHY `subjects` EXISTS AT ALL -- THERE WAS NO SUCH COLUMN BEFORE THIS
--
-- Checked before writing anything: `users` has no `subjects` column today.
-- Every downstream reader (Practice Generator, getSubjectsForExam() in
-- categories.js, etc.) currently derives "this student's subjects" from a
-- BOARD-LEVEL static lookup keyed by resolved examType
-- (exam_categories.subjects for e.g. "CBSE Class 11") -- every student on
-- that board+class sees the identical full subject list regardless of
-- stream. This column is additive and nullable specifically so that adding
-- it changes NOTHING for any existing reader: nothing reads `users.subjects`
-- yet. Phase 4 is what wires readers to PREFER it when set, falling back to
-- the existing board-level lookup otherwise -- Phase 2 only ever WRITES it,
-- and only for students who complete the new stream step.
--
-- academic_track is the structured record: { board, stream, language_choice?,
-- chosen_slot_subjects, optional_6th? } -- everything needed to re-render the
-- student's choice, distinct from `subjects`, which is the flattened list
-- other consumers can use without knowing this feature exists.

alter table public.users add column if not exists subjects text[];
alter table public.users add column if not exists academic_track jsonb;

comment on column public.users.subjects is
  'Personalised flattened subject list, set only after Class 11/12 stream selection. NULL for every student who has not completed that step (all of Classes 8-10, and any 11-12 student pre-dating or skipping it) -- readers MUST fall back to the existing board-level exam_categories.subjects lookup when this is null. Added additively; nothing reads it as of this migration (Phase 4 wires readers).';
comment on column public.users.academic_track is
  'Structured Class 11/12 choice: {board, stream, language_choice?, chosen_slot_subjects, optional_6th?}. NULL until the student completes stream selection. Source of truth for re-rendering their choice screen; `subjects` is the flattened, consumer-friendly derivative of this.';

create or replace function public.upsert_own_user(p_uid text, p_fields jsonb)
returns public.users
language sql
security definer
set search_path = public
as $$
  insert into public.users (
    firebase_uid, auth_method, display_name, email, phone_number, photo_url,
    onboarding_completed, target_exam, syllabus, class_level, subjects, academic_track
  )
  values (
    p_uid,
    p_fields->>'auth_method', p_fields->>'display_name', p_fields->>'email',
    p_fields->>'phone_number', p_fields->>'photo_url',
    coalesce((p_fields->>'onboarding_completed')::boolean, false),
    p_fields->>'target_exam', p_fields->>'syllabus', p_fields->>'class_level',
    (select array_agg(x) from jsonb_array_elements_text(p_fields->'subjects') x),
    p_fields->'academic_track'
  )
  on conflict (firebase_uid) do update set
    auth_method           = coalesce(excluded.auth_method, public.users.auth_method),
    display_name          = coalesce(excluded.display_name, public.users.display_name),
    email                 = coalesce(excluded.email, public.users.email),
    phone_number          = coalesce(excluded.phone_number, public.users.phone_number),
    photo_url              = coalesce(excluded.photo_url, public.users.photo_url),
    onboarding_completed  = coalesce((p_fields->>'onboarding_completed')::boolean, public.users.onboarding_completed),
    target_exam            = coalesce(excluded.target_exam, public.users.target_exam),
    syllabus                = coalesce(excluded.syllabus, public.users.syllabus),
    class_level             = coalesce(excluded.class_level, public.users.class_level),
    subjects                = coalesce(excluded.subjects, public.users.subjects),
    academic_track          = coalesce(excluded.academic_track, public.users.academic_track)
  returning *;
$$;

create or replace function public.update_own_user(p_uid text, p_fields jsonb)
returns public.users
language sql
security definer
set search_path = public
as $$
  update public.users set
    auth_method            = coalesce(p_fields->>'auth_method', auth_method),
    display_name           = coalesce(p_fields->>'display_name', display_name),
    email                   = coalesce(p_fields->>'email', email),
    phone_number            = coalesce(p_fields->>'phone_number', phone_number),
    photo_url               = coalesce(p_fields->>'photo_url', photo_url),
    onboarding_completed    = coalesce((p_fields->>'onboarding_completed')::boolean, onboarding_completed),
    target_exam             = coalesce(p_fields->>'target_exam', target_exam),
    syllabus                 = coalesce(p_fields->>'syllabus', syllabus),
    class_level              = coalesce(p_fields->>'class_level', class_level),
    subjects                 = coalesce((select array_agg(x) from jsonb_array_elements_text(p_fields->'subjects') x), subjects),
    academic_track           = coalesce(p_fields->'academic_track', academic_track)
  where firebase_uid = p_uid
  returning *;
$$;
