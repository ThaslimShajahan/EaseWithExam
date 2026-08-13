-- The subject vocabulary of record — step 1 of the reconciliation described in
-- docs/STREAM_SELECTION_HANDOFF.md §12/§12a.
--
-- WHY THIS EXISTS
--
-- "What subjects exist" was answered in three unlinked places: exam_categories
-- .subjects (per board+class), stream_configs/board_language_config (per
-- stream), and a hardcoded fallback in src/lib/categories.js. Nothing validated
-- one against another, and they had already drifted: 21 subjects that onboarding
-- can write onto a student profile did not exist in Categories for that
-- board+class, including `English Core` vs `English` — the same paper under two
-- names.
--
-- This table separates four questions that were previously tangled:
--
--   does this subject exist at all?          -> a row here
--   do we serve content for it?              -> subjects.content_bearing
--   which board+class offers it?             -> exam_categories.subjects (unchanged)
--   which stream offers it, how many picked? -> stream_configs (unchanged)
--
-- `kind` and `content_bearing` are deliberately independent: English is a
-- language AND content-bearing; Malayalam is a language and (today) is not.
--
-- THIS MIGRATION CHANGES NO BEHAVIOUR. Nothing reads this table yet — the read
-- filter, RPC validation and admin UI land in 20260813110000 and after. Seeding
-- it first keeps that step separable and this one risk-free.

create table if not exists public.subjects (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  kind            text not null default 'academic'
                    check (kind in ('academic', 'language', 'activity')),
  content_bearing boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.subjects is
  'Subject vocabulary of record. A row here means the subject EXISTS (a student '
  'profile may carry it). content_bearing decides whether it appears in '
  'content-tooling dropdowns. Board/class applicability stays in '
  'exam_categories.subjects; stream offerings stay in stream_configs. See '
  '20260813100000 and docs/STREAM_SELECTION_HANDOFF.md §12a.';

comment on column public.subjects.content_bearing is
  'false = valid in a student profile but hidden from content tooling (Practice '
  'Generator, Syllabus, Content Intake, Study Notes, Paper Gen). Global by '
  'design, not per-board: a language is a language everywhere. If a real '
  'per-board counter-example appears, override on exam_categories rather than '
  'splitting this column.';

comment on column public.subjects.kind is
  'What the subject IS, independent of content_bearing. English is kind=language '
  'AND content_bearing=true; Malayalam is kind=language and content_bearing=false.';

-- ── Seed ────────────────────────────────────────────────────────────────────
-- Everything already in the live catalog, derived rather than hand-transcribed
-- so this cannot drift from reality at write time. All content_bearing=true:
-- these are exactly the subjects already appearing in content dropdowns today,
-- and this migration must not change what any existing screen shows.
insert into public.subjects (name, kind, content_bearing)
select distinct s, 'academic', true
from public.exam_categories, unnest(subjects) as s
on conflict (name) do nothing;

-- The 14 names that stream_configs/board_language_config reference but the
-- catalog never had. 7 CORE (content_bearing=true — required somewhere in a
-- stream_mandatory or choice_slots slot) and 7 DEFERRED (content_bearing=false
-- — only ever an optional 6th, or a language), per the owner-reviewed table in
-- §12a.
--
-- Hindi and Sanskrit are NOT in this list on purpose. They are in the deferred
-- group conceptually (languages, not added to Class 11/12), but they already
-- exist in the catalog and are content-bearing for classes 6-10 — Sanskrit is in
-- every Class 10 row. Flagging them false would strip them from dropdowns where
-- they legitimately belong. They stay true above and simply never get added to
-- the Class 11/12 rows, which reaches the same end state without a regression.
insert into public.subjects (name, kind, content_bearing) values
  -- CORE: required in a stream slot, so content follows
  ('Applied Mathematics',    'academic', true),   -- CBSE commerce choice (041 vs 241: distinct from Mathematics, owner-confirmed)
  ('Sociology',              'academic', true),   -- humanities choice, both boards
  ('Psychology',             'academic', true),   -- CBSE + Kerala humanities choice (also optional-6th; required wins)
  ('Statistics',             'academic', true),   -- Kerala commerce choice
  ('Journalism',             'academic', true),   -- Kerala humanities choice
  ('Informatics Practices',  'academic', true),   -- CBSE optional-6th, but a full examined subject (owner correction)
  ('Legal Studies',          'academic', true),   -- CBSE optional-6th, but a full examined subject (owner correction)
  -- DEFERRED: valid on a profile, hidden from content tooling until we serve it
  ('Physical Education',     'activity', false),
  ('Fine Arts',              'activity', false),
  ('Home Science',           'activity', false),
  ('Malayalam',              'language', false),
  ('Arabic',                 'language', false),
  ('Urdu',                   'language', false),
  ('Syriac',                 'language', false)
on conflict (name) do nothing;

-- Classify the languages that came in from the catalog seed above. These stay
-- content_bearing=true (see the note above) — only `kind` changes.
update public.subjects set kind = 'language'
where name in ('English', 'Hindi', 'Sanskrit') and kind <> 'language';

-- ── RLS: read-open, write-closed ────────────────────────────────────────────
-- Same shape as stream_configs and chapter_manifests: any client may read the
-- vocabulary (onboarding and every content screen needs it); writes go only
-- through the admin RPC below, which gates on assert_verified_admin.
alter table public.subjects enable row level security;

drop policy if exists subjects_read on public.subjects;
create policy subjects_read on public.subjects for select using (true);

grant select on public.subjects to anon, authenticated;

-- ── Admin write path ────────────────────────────────────────────────────────
create or replace function public.admin_upsert_subject(
  p_caller          text,
  p_id              uuid,
  p_name            text,
  p_kind            text,
  p_content_bearing boolean
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform assert_verified_admin(p_caller);

  if p_name is null or btrim(p_name) = '' then
    raise exception 'subject name is required' using errcode = '22023';
  end if;
  if p_kind not in ('academic', 'language', 'activity') then
    raise exception 'kind must be academic, language or activity, got %', p_kind using errcode = '22023';
  end if;

  insert into public.subjects (id, name, kind, content_bearing)
  values (coalesce(p_id, gen_random_uuid()), btrim(p_name), p_kind, coalesce(p_content_bearing, true))
  on conflict (id) do update set
    name = excluded.name, kind = excluded.kind,
    content_bearing = excluded.content_bearing, updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- Granted to anon as well as authenticated, deliberately: Firebase ID tokens
-- carry no `role` claim so every PostgREST request runs as anon, and a grant to
-- `authenticated` alone is unreachable. The real gate is assert_verified_admin
-- above. See 20260813080000 for the empirical proof behind that rule.
revoke all on function public.admin_upsert_subject(text, uuid, text, text, boolean) from public;
grant execute on function public.admin_upsert_subject(text, uuid, text, text, boolean) to anon, authenticated;

-- Deleting a subject that a student profile or stream config still references
-- would recreate the exact dangling-reference problem this table exists to fix,
-- so there is no delete RPC. Retire a subject with content_bearing=false.
