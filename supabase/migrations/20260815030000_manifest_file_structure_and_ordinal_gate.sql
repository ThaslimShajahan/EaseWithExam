-- Two permanent fixes for the manifest pipeline, both found the same night by
-- the same symptom hitting a second book (CBSE Class 8 Mathematics, after
-- Poorvi): an approved manifest with `fileOrdinal` null on every entry, only
-- discovered when a real upload refused every file. Both times the fix was a
-- hand-written SQL UPDATE against the approved row. This migration makes the
-- bug structurally impossible to approve into production a third time, and
-- separately fixes a real design gap the fix for Poorvi exposed: the
-- page-range check `extractNotesByManifest` runs was built for one combined
-- PDF spanning many chapters (Poorvi: 5 files, 15 entries, 3 per file, page
-- ranges are real book-wide numbers) and is meaningless for a book split into
-- one file per chapter (CBSE Class 8 Maths: 7 files, 7 entries, 1:1) — a
-- per-chapter file's own page 1 is not guaranteed to be the chapter's logical
-- page 1, and fileOrdinal matching is already the real corroboration signal
-- there.

/* ── file_structure ──────────────────────────────────────────────────── */

alter table public.chapter_manifests
  add column if not exists file_structure text not null default 'per_chapter'
    check (file_structure in ('combined', 'per_chapter'));

comment on column public.chapter_manifests.file_structure is
  '''combined'' = one physical file legitimately covers multiple numbered '
  'entries (Poorvi: 5 unit files, 3 texts each, sharing one fileOrdinal per '
  'file) — the printed page range is real corroboration there and stays '
  'enforced. ''per_chapter'' = one file per chapter (fileOrdinal is 1:1 with '
  'ordinal) — a file''s own page 1 is not guaranteed to be the chapter''s '
  'logical page 1 (cover pages, blank pages, back matter vary per file), so '
  'the page-range-vs-file-length check is skipped and fileOrdinal matching '
  'alone is the corroboration signal. Defaults to the more common shape in '
  'this corpus; the admin confirms or overrides it in the manifest screen, '
  'never inferred silently past that point.';

/* ── admin_upsert_chapter_manifest: add p_file_structure ─────────────── */

drop function if exists public.admin_upsert_chapter_manifest(text,uuid,text,text,text,text,text,text,jsonb,text);

create or replace function public.admin_upsert_chapter_manifest(
  p_caller text, p_id uuid, p_exam_type text, p_subject text, p_book text,
  p_class_level text, p_key_prefix text, p_source_file text, p_entries jsonb, p_notes text,
  p_file_structure text default 'per_chapter'
) returns uuid
language plpgsql security definer set search_path = public
as $function$
declare v_id uuid;
begin
  perform assert_verified_admin(p_caller);

  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'entries must be a jsonb array' using errcode = '22023';
  end if;

  if p_file_structure not in ('combined', 'per_chapter') then
    raise exception 'file_structure must be ''combined'' or ''per_chapter'', got %', p_file_structure
      using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.chapter_manifests
      (exam_type, subject, book, class_level, key_prefix, source_file, entries, notes, file_structure)
    values
      (p_exam_type, p_subject, p_book, p_class_level, coalesce(p_key_prefix, 'c'), p_source_file, p_entries, p_notes, p_file_structure)
    returning id into v_id;
  else
    -- An APPROVED manifest is immutable. Editing one in place would silently
    -- change the identity of chapters already loaded against it; supersede and
    -- create a new draft instead.
    update public.chapter_manifests
       set exam_type = p_exam_type, subject = p_subject, book = p_book,
           class_level = p_class_level, key_prefix = coalesce(p_key_prefix, 'c'),
           source_file = p_source_file, entries = p_entries, notes = p_notes,
           file_structure = p_file_structure, updated_at = now()
     where id = p_id and status = 'draft'
    returning id into v_id;
    if v_id is null then
      raise exception 'manifest % is not a draft (approved manifests are immutable)', p_id using errcode = '42501';
    end if;
  end if;
  return v_id;
end;
$function$;

revoke all on function public.admin_upsert_chapter_manifest(text,uuid,text,text,text,text,text,text,jsonb,text,text) from public, anon;
grant execute on function public.admin_upsert_chapter_manifest(text,uuid,text,text,text,text,text,text,jsonb,text,text) to authenticated;

/* ── admin_approve_chapter_manifest: refuse a null fileOrdinal ───────── */
--
-- Applies to every NUMBERED entry (numbered is missing or true) regardless of
-- file_structure — candidatesForFile()'s `own` match is `fileOrdinal ===
-- fileOrdinal` for ANY numbered entry, combined or per_chapter alike (Poorvi's
-- 3 entries-per-file share one fileOrdinal; a per_chapter book gives each
-- entry its own). Either way, a null fileOrdinal can never be matched to a
-- real uploaded file's derived ordinal on purpose — it is always a mistake,
-- never a valid state for a numbered entry. Interleaved entries (numbered =
-- false) are the opposite: validateManifest already REQUIRES fileOrdinal to
-- stay null for those, so this gate does not touch them.

create or replace function public.admin_approve_chapter_manifest(p_caller text, p_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $function$
declare
  v_row public.chapter_manifests%rowtype;
  v_missing text;
begin
  perform assert_verified_admin(p_caller);

  select * into v_row from public.chapter_manifests where id = p_id;
  if not found then raise exception 'manifest % not found', p_id using errcode = 'P0002'; end if;
  if v_row.status <> 'draft' then
    raise exception 'manifest % is %, only a draft can be approved', p_id, v_row.status using errcode = '22023';
  end if;
  if jsonb_array_length(v_row.entries) = 0 then
    raise exception 'refusing to approve an empty manifest' using errcode = '22023';
  end if;

  select string_agg(format('#%s ("%s")', e->>'ordinal', e->>'title'), ', ' order by (e->>'ordinal')::int)
    into v_missing
    from jsonb_array_elements(v_row.entries) e
   where coalesce((e->>'numbered')::boolean, true) = true
     and e->>'fileOrdinal' is null;

  if v_missing is not null then
    raise exception 'refusing to approve: missing File # on % — set fileOrdinal on every numbered entry before approving (see the File # column)', v_missing
      using errcode = '22023';
  end if;

  -- Supersede whatever this book had before, so the partial unique index has
  -- exactly one approved row to protect.
  update public.chapter_manifests
     set status = 'superseded', updated_at = now()
   where status = 'approved'
     and exam_type = v_row.exam_type
     and subject   = v_row.subject
     and coalesce(book, '') = coalesce(v_row.book, '');

  update public.chapter_manifests
     set status = 'approved', approved_by = p_caller, approved_at = now(), updated_at = now()
   where id = p_id;

  return p_id;
end;
$function$;
