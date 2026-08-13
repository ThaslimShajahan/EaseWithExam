-- Step 2 of the reconciliation (docs/STREAM_SELECTION_HANDOFF.md §12a): close the
-- existing drift, then make it structurally impossible to reopen.
--
-- Three parts:
--   1. rename `English Core` -> `English` in board_language_config
--   2. add the 11 CORE subjects to the Class 11/12 exam_categories rows
--   3. validate every subject written through the stream RPCs against
--      public.subjects, so SQL and manual writes can't bypass the UI picker
--
-- Part 3 is the point. Parts 1-2 fix today's drift; part 3 is why it stays fixed.

-- ── 1. English Core -> English ──────────────────────────────────────────────
-- CBSE's formal name for the compulsory paper is "English Core", but the catalog
-- has `English`, content/syllabus/PYQ file under `English`, and two names for one
-- paper is exactly the drift being closed. Owner-confirmed.
-- (If English Elective is ever offered, `English` becomes ambiguous and both
-- names come back — noted in §12a as the accepted trade-off.)
update public.board_language_config
set mandatory_languages = array_replace(mandatory_languages, 'English Core', 'English'),
    updated_at = now()
where 'English Core' = any(mandatory_languages);

-- ── 2. The 11 CORE subjects onto the Class 11/12 rows ───────────────────────
-- CORE = required in some stream's stream_mandatory or choice_slots, plus
-- Informatics Practices and Legal Studies (owner correction: full examined CBSE
-- subjects, not enrichment). Appended only where missing, preserving existing
-- order so no screen's subject ordering shifts.
--
-- Deliberately NOT added: the 6 languages and PE/Fine Arts/Home Science. They are
-- valid on a student profile (they exist in public.subjects) but content_bearing
-- =false, so they stay out of content tooling until we actually serve them.
update public.exam_categories ec
set subjects = ec.subjects || array(
      select x from unnest(array[
        'Applied Mathematics', 'History', 'Geography', 'Political Science',
        'Sociology', 'Psychology', 'Informatics Practices', 'Legal Studies'
      ]) x where not (x = any(ec.subjects))),
    updated_at = now()
where ec.category_kind = 'board_class' and ec.board_key = 'CBSE'
  and ec.class_key in ('11', '12');

update public.exam_categories ec
set subjects = ec.subjects || array(
      select x from unnest(array[
        'History', 'Geography', 'Political Science', 'Sociology', 'Psychology',
        'Computer Applications', 'Statistics', 'Journalism'
      ]) x where not (x = any(ec.subjects))),
    updated_at = now()
where ec.category_kind = 'board_class' and ec.board_key = 'Kerala State'
  and ec.class_key in ('11', '12');

-- ── 3. Validation: every subject written must exist in the vocabulary ───────
-- Validates against public.subjects, NOT exam_categories. That distinction is
-- the whole unlock: Malayalam is a legitimate Kerala language choice and must be
-- writable to a stream config, while staying out of every content dropdown.
-- exam_categories answers "which board+class offers it", which is a different
-- question and not this check's job.
create or replace function public.assert_known_subjects(p_names text[])
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_unknown text[];
begin
  if p_names is null or cardinality(p_names) = 0 then return; end if;

  select array_agg(distinct n) into v_unknown
  from unnest(p_names) n
  where n is not null and btrim(n) <> ''
    and not exists (select 1 from public.subjects s where s.name = n);

  if v_unknown is not null and cardinality(v_unknown) > 0 then
    raise exception 'unknown subject(s): %. Add them under Admin > Platform > Subjects first.',
      array_to_string(v_unknown, ', ')
      using errcode = '22023';
  end if;
end;
$$;

comment on function public.assert_known_subjects(text[]) is
  'Rejects subject names absent from public.subjects. Checks the vocabulary, not '
  'exam_categories: a subject may be valid on a profile (e.g. Malayalam) without '
  'being offered to content tooling. See 20260813110000.';

revoke all on function public.assert_known_subjects(text[]) from public;
grant execute on function public.assert_known_subjects(text[]) to anon, authenticated;

create or replace function public.admin_upsert_stream_config(
  p_caller text, p_id uuid, p_board_key text, p_class_tier text, p_stream_key text,
  p_label text, p_stream_mandatory text[], p_choice_slots jsonb, p_optional_slots jsonb,
  p_named_combinations jsonb, p_sort_order integer
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform assert_verified_admin(p_caller);

  if p_stream_key not in ('science', 'commerce', 'humanities') then
    raise exception 'stream_key must be science, commerce or humanities, got %', p_stream_key using errcode = '22023';
  end if;
  if p_choice_slots is null or jsonb_typeof(p_choice_slots) <> 'array' then
    raise exception 'choice_slots must be a jsonb array' using errcode = '22023';
  end if;

  -- NEW in 20260813110000: every subject named anywhere in this config must
  -- exist in the vocabulary. Covers locked subjects, both slot kinds, and the
  -- resulting_subjects of named combinations — a typo in any of them would
  -- otherwise reach a student profile and then fail silently downstream.
  perform public.assert_known_subjects(
    coalesce(p_stream_mandatory, '{}')
    || coalesce((select array_agg(v) from jsonb_array_elements(p_choice_slots) s,
                 jsonb_array_elements_text(coalesce(s->'choose_from', '[]'::jsonb)) v), '{}')
    || coalesce((select array_agg(v) from jsonb_array_elements(coalesce(p_optional_slots, '[]'::jsonb)) s,
                 jsonb_array_elements_text(coalesce(s->'choose_from', '[]'::jsonb)) v), '{}')
    || coalesce((select array_agg(v) from jsonb_array_elements(coalesce(p_named_combinations, '[]'::jsonb)) c,
                 jsonb_array_elements_text(coalesce(c->'resulting_subjects', '[]'::jsonb)) v), '{}')
  );

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
$$;

create or replace function public.admin_upsert_board_language_config(
  p_caller text, p_id uuid, p_board_key text, p_class_tier text,
  p_mandatory_languages text[], p_choice_language_slot jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform assert_verified_admin(p_caller);

  -- NEW in 20260813110000: same vocabulary check for languages. p_choice_language_slot
  -- stays nullable — null means "this board asks for no second language" (CBSE)
  -- and must remain representable; only a non-null slot's pool is checked.
  perform public.assert_known_subjects(
    coalesce(p_mandatory_languages, '{}')
    || coalesce((select array_agg(v) from jsonb_array_elements_text(
                   coalesce(p_choice_language_slot->'choose_from', '[]'::jsonb)) v), '{}')
  );

  insert into public.board_language_config
    (id, board_key, class_tier, mandatory_languages, choice_language_slot)
  values
    (coalesce(p_id, gen_random_uuid()), p_board_key, coalesce(p_class_tier, '11-12'),
     coalesce(p_mandatory_languages, '{}'), p_choice_language_slot)
  on conflict (id) do update set
    board_key = excluded.board_key, class_tier = excluded.class_tier,
    mandatory_languages = excluded.mandatory_languages,
    choice_language_slot = excluded.choice_language_slot,
    updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- Grants are re-asserted because CREATE OR REPLACE keeps them, but an earlier
-- migration in this project silently lost them once; cheap insurance. See
-- 20260813080000 for why anon must be included.
grant execute on function public.admin_upsert_stream_config(
  text, uuid, text, text, text, text, text[], jsonb, jsonb, jsonb, integer
) to anon, authenticated;
grant execute on function public.admin_upsert_board_language_config(
  text, uuid, text, text, text[], jsonb
) to anon, authenticated;
