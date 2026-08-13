-- Unified Class 11/12 stream & language data model, replacing the
-- exam_categories.streams shape from 20260813030000/20260813040000-adjacent
-- work, which was found to have real modeling errors:
--   - CBSE Science/Commerce forced Physics+Chemistry / Accountancy+Business
--     Studies+Economics into a per-stream `mandatory_core` that should never
--     have existed -- CBSE locks NO stream subjects, only English Core.
--   - Kerala Commerce/Humanities never got the `combination_blocks` shape
--     Science had, and Kerala's real model isn't "named blocks" at the top
--     level at all -- it's LOCKED CORE subjects plus a small CHOICE SLOT
--     (Course Code 1 vs 5, etc.), which is a materially different shape.
--   - Two fields were prose strings, not arrays.
--
-- ONE SHAPE FOR EVERY BOARD X STREAM, so no board name is ever branched on in
-- application code -- only the DATA differs:
--
--   stream_mandatory     locked subjects, may be empty (CBSE: always empty.
--                        Kerala: 3 subjects, common to every course code in
--                        that stream)
--   choice_slots         [{slot_key,label,count,choose_from}], usually one.
--                        CBSE: "pick 4 of N" (Science/Humanities) or "pick 4
--                        of 4" (Commerce -- choose_from.length == count is
--                        VALID and means auto-select-all, not a data bug;
--                        Phase 2 UI must special-case this rendering, not
--                        the data). Kerala: "pick 1 of 2-4" (the course-code
--                        choice).
--   optional_slots       CBSE only, empty everywhere else -- the un-graded
--                        6th subject. choose_from is the SAME pool for all
--                        three CBSE streams; excluding a subject the student
--                        already picked in choice_slots is enforced in the
--                        UI at selection time, deliberately NOT in this
--                        static config -- a stored pool cannot know what a
--                        given student already chose.
--   named_combinations   admin-addable labels for a choice_slots pick, e.g.
--                        Kerala Science's "Course Code 1" (Biology) vs
--                        "Course Code 5" (Computer Science) -- these two ARE
--                        seeded below because the task's own canonical data
--                        states the mapping directly. Kerala Commerce and
--                        Humanities get NO seeded names: over 30 real DHSE
--                        Humanities combinations exist and only the common
--                        block is verified data here -- inventing names for
--                        the rest would be fabricating a curriculum fact a
--                        student relies on. Empty and admin-extensible
--                        (Phase 3) is the honest state until real names are
--                        supplied.
--
-- Board-level language rules are NOT part of a stream row, because they
-- don't vary by stream -- CBSE's mandatory English Core and Kerala's
-- mandatory-English-plus-choice-of-second-language apply identically across
-- Science/Commerce/Humanities. Splitting them into board_language_config
-- is what lets Phase 2 branch UI purely on "is choice_language_slot null"
-- rather than on the board's name.
--
-- exam_categories.streams (20260813030000) is DEPRECATED, NOT DROPPED --
-- additive-only. It still holds the CBSE-corrected-but-Kerala-still-old-shape
-- content from that migration; nothing reads it as of this migration. Kept
-- for history/rollback reference only.

create table if not exists public.stream_configs (
  id                  uuid primary key default gen_random_uuid(),
  board_key           text        not null,              -- matches exam_categories.board_key
  class_tier          text        not null default '11-12',
  stream_key          text        not null check (stream_key in ('science', 'commerce', 'humanities')),
  label               text        not null,
  stream_mandatory    text[]      not null default '{}',
  choice_slots        jsonb       not null default '[]'::jsonb,
  optional_slots      jsonb       not null default '[]'::jsonb,
  named_combinations  jsonb       not null default '[]'::jsonb,
  sort_order          integer     not null default 0,
  is_active           boolean     not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Partial on is_active for the same reason as chapter_manifests_approved_uniq:
-- lets a superseded/retired config be kept for history without blocking a
-- replacement from using the same (board, tier, stream) identity.
create unique index if not exists stream_configs_identity_uniq
  on public.stream_configs (board_key, class_tier, stream_key)
  where is_active;

create index if not exists stream_configs_lookup_idx
  on public.stream_configs (board_key, class_tier);

comment on table public.stream_configs is
  'One row per (board, class tier, stream). The complete Class 11/12 subject-selection rule for that board+stream: locked subjects, the graded choice slot(s), CBSE''s optional ungraded 6th subject, and any admin-named combinations. UI branches on this DATA, never on a board name literal.';
comment on column public.stream_configs.choice_slots is
  'jsonb array: [{slot_key,label,count,choose_from:text[]}]. choose_from.length may equal count (CBSE Commerce: 4 of 4) -- that is a valid auto-select-all case, not a data error.';
comment on column public.stream_configs.optional_slots is
  'CBSE only; empty array for every Kerala row. Excluding a subject already picked in choice_slots is UI-time logic, not encoded here.';
comment on column public.stream_configs.named_combinations is
  'jsonb array: [{name,resulting_subjects:text[]}]. Admin-addable via Phase 3 UI without a schema change. Seeded only where the source data gives a real name (Kerala Science''s two course codes); left empty elsewhere rather than invented.';

alter table public.stream_configs enable row level security;
drop policy if exists stream_configs_read on public.stream_configs;
create policy stream_configs_read on public.stream_configs for select using (true);

-- ── Board-level language rules ──────────────────────────────────────────

create table if not exists public.board_language_config (
  id                    uuid primary key default gen_random_uuid(),
  board_key             text        not null,
  class_tier            text        not null default '11-12',
  mandatory_languages    text[]      not null default '{}',
  choice_language_slot  jsonb,      -- null = no second-language choice (CBSE); populated = Kerala shape
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists board_language_config_identity_uniq
  on public.board_language_config (board_key, class_tier);

comment on table public.board_language_config is
  'Board-level Class 11/12 language rule, separate from stream_configs because it does not vary by stream. choice_language_slot is null for a board with no second-language choice (CBSE) and {slot_key,label,count,choose_from} for one that has it (Kerala) -- Phase 2 UI branches on nullness, never on board_key.';

alter table public.board_language_config enable row level security;
drop policy if exists board_language_config_read on public.board_language_config;
create policy board_language_config_read on public.board_language_config for select using (true);

comment on column public.exam_categories.streams is
  'DEPRECATED 2026-08-13 -- superseded by stream_configs + board_language_config, which fix real modeling errors this shape had (CBSE over-locking Physics/Chemistry/Accountancy as mandatory; Kerala Commerce/Humanities never getting a combination-block shape; two fields stored as prose strings). Not dropped (additive-only rule) and not backfilled further; kept for history. Nothing reads this column as of 20260813040000.';

-- ── Admin write surface, same pattern as chapter_manifests ──────────────

create or replace function public.admin_upsert_stream_config(
  p_caller text, p_id uuid, p_board_key text, p_class_tier text, p_stream_key text,
  p_label text, p_stream_mandatory text[], p_choice_slots jsonb, p_optional_slots jsonb,
  p_named_combinations jsonb, p_sort_order integer
) returns uuid
language plpgsql security definer set search_path = public
as $function$
declare v_id uuid;
begin
  perform assert_verified_admin(p_caller);

  if p_stream_key not in ('science', 'commerce', 'humanities') then
    raise exception 'stream_key must be science, commerce or humanities, got %', p_stream_key using errcode = '22023';
  end if;
  if p_choice_slots is null or jsonb_typeof(p_choice_slots) <> 'array' then
    raise exception 'choice_slots must be a jsonb array' using errcode = '22023';
  end if;

  insert into public.stream_configs
    (id, board_key, class_tier, stream_key, label, stream_mandatory, choice_slots, optional_slots, named_combinations, sort_order)
  values
    (coalesce(p_id, gen_random_uuid()), p_board_key, coalesce(p_class_tier, '11-12'), p_stream_key, p_label,
     coalesce(p_stream_mandatory, '{}'), p_choice_slots, coalesce(p_optional_slots, '[]'::jsonb),
     coalesce(p_named_combinations, '[]'::jsonb), coalesce(p_sort_order, 0))
  on conflict (id) do update set
    board_key = excluded.board_key, class_tier = excluded.class_tier, stream_key = excluded.stream_key,
    label = excluded.label, stream_mandatory = excluded.stream_mandatory, choice_slots = excluded.choice_slots,
    optional_slots = excluded.optional_slots, named_combinations = excluded.named_combinations,
    sort_order = excluded.sort_order, updated_at = now()
  returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.admin_upsert_board_language_config(
  p_caller text, p_id uuid, p_board_key text, p_class_tier text,
  p_mandatory_languages text[], p_choice_language_slot jsonb
) returns uuid
language plpgsql security definer set search_path = public
as $function$
declare v_id uuid;
begin
  perform assert_verified_admin(p_caller);

  insert into public.board_language_config
    (id, board_key, class_tier, mandatory_languages, choice_language_slot)
  values
    (coalesce(p_id, gen_random_uuid()), p_board_key, coalesce(p_class_tier, '11-12'), coalesce(p_mandatory_languages, '{}'), p_choice_language_slot)
  on conflict (id) do update set
    board_key = excluded.board_key, class_tier = excluded.class_tier,
    mandatory_languages = excluded.mandatory_languages, choice_language_slot = excluded.choice_language_slot,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.admin_upsert_stream_config(text,uuid,text,text,text,text,text[],jsonb,jsonb,jsonb,integer) from public, anon;
revoke all on function public.admin_upsert_board_language_config(text,uuid,text,text,text[],jsonb) from public, anon;
grant execute on function public.admin_upsert_stream_config(text,uuid,text,text,text,text,text[],jsonb,jsonb,jsonb,integer) to authenticated;
grant execute on function public.admin_upsert_board_language_config(text,uuid,text,text,text[],jsonb) to authenticated;
