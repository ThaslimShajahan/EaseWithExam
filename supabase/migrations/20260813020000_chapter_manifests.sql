-- Chapter manifests — the approved contents page of a book, and the thing that
-- makes chapter identity checkable instead of asserted.
--
-- WHY THIS TABLE EXISTS
--
-- The 2026-08-12/13 load measured a 0% defect rate on board, class, subject and
-- content_type over 4,866 rows, and 9.4% on chapter name (456 rows, 48 bad
-- chapters). Board/class/subject were derived from the FILE PATH. Chapter was
-- derived from model prose, and identity was derived from that name -- so a
-- naming error WAS an identity error, and three things followed:
--
--   rename   'World Climate and Climate Classification' minted a new chapter
--            rather than matching '...Change'                        (23 rows)
--   capture  keps101 -- Political Theory chapter 1 -- was filed as 'Equality'
--            (chapter 3), merging 13 rows into a REAL chapter where no orphan
--            report could ever surface them
--   invent   a section heading was as valid a key as a chapter:
--            'Critical Reflection' (28 rows), 'Poorvi' -- a BOOK name (33 rows)
--
-- A manifest is the book's own contents page, extracted once and APPROVED BY A
-- HUMAN before any of that book's chapters load. Per-file assignment then
-- becomes closed-set selection against it, which is a checkable operation. An
-- ordinal that is not in the manifest cannot be written at all.
--
-- WHY ENTRIES CARRY THREE DIFFERENT NUMBERS
--
-- `ordinal` is identity and sort order. `printed_number` is what the book prints
-- on the page. `file_ordinal` is the number in the filename. They are NOT the
-- same, and assuming they were would reject correct content:
--
--   kehb101..106  Hornbill Reading Skills  printed 1-6   file 1-6    (agree)
--   kehb111..116  Hornbill Writing Skills  printed 1-6   file 11-16  (differ)
--
-- Writing Skills restarts its printed numbering at 1 while the filenames keep
-- counting, so a rule of `file_ordinal = ordinal` would reject all six Writing
-- Skills files. The manifest records the binding instead of inferring it.
--
-- `numbered = false` marks INTERLEAVED entries. 20260812040000 records that
-- Hornbill's five poems are unnumbered and sit INSIDE the prose chapter PDFs --
-- 'A Photograph' in kehb101, 'The Laburnum Top' and 'The Voice of the Rain'
-- both in kehb103. They have no printed number and no file of their own, so
-- their identity is POSITIONAL: the page range must fall inside the host file.
-- A "one file, one chapter" rule rejects them; treating every extra entry as
-- interleaved re-opens the over-split hole that fragmented kecs101 into 7
-- sections. The approved manifest is what separates the two cases.

create table if not exists public.chapter_manifests (
  id          uuid primary key default gen_random_uuid(),
  exam_type   text        not null,
  subject     text        not null,
  book        text,                          -- NULL = single-book subject
  class_level text,
  key_prefix  text        not null default 'c',   -- 'k' for Kerala; see chapterKeyFor
  source_file text,                          -- the PDF the contents page came from
  entries     jsonb       not null default '[]'::jsonb,
  status      text        not null default 'draft'
                          check (status in ('draft', 'approved', 'superseded')),
  approved_by text,
  approved_at timestamptz,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ONE approved manifest per book, and the NULL trap from 20260812040000 applies
-- again: `book` is nullable and Postgres treats NULLs as DISTINCT, so a plain
-- unique index on (exam_type, subject, book) would permit unlimited duplicate
-- manifests for every single-book subject -- which is every STEM subject. The
-- coalesce() collapses NULL to '' so single-book subjects are protected too.
-- Partial on status so drafts and superseded revisions can pile up freely.
create unique index if not exists chapter_manifests_approved_uniq
  on public.chapter_manifests (exam_type, subject, coalesce(book, ''))
  where status = 'approved';

create index if not exists chapter_manifests_lookup_idx
  on public.chapter_manifests (exam_type, subject, status);

comment on table public.chapter_manifests is
  'A book''s contents page: ordinal, printed title and page range per chapter, approved by a human before that book''s content may load. Per-file chapter assignment is closed-set selection against the approved manifest, which is what stops a wrong or invented chapter name becoming a chapter identity.';
comment on column public.chapter_manifests.entries is
  'jsonb array: [{ordinal, title, pageStart, pageEnd, numbered, printedNumber, fileOrdinal, band}]. ordinal is identity+sort; printedNumber is what the book prints (restarts per section); fileOrdinal is the filename index. They differ -- see this migration''s header.';

-- ── RLS ──────────────────────────────────────────────────────────────────
-- Reads are open (the app resolves chapters at runtime, and every request runs
-- as anon). Writes have NO policy at all: they go through the admin RPCs below,
-- exactly as pyq_questions does since 20260812030000. A permissive write policy
-- here would be the same anon-writable hole that migration closed -- the anon
-- key ships in the client bundle and is public by design.
alter table public.chapter_manifests enable row level security;

drop policy if exists chapter_manifests_read on public.chapter_manifests;
create policy chapter_manifests_read
  on public.chapter_manifests for select
  using (true);

-- ── knowledge_base.book ──────────────────────────────────────────────────
-- 20260812040000 deliberately did NOT add this, deferring it until there was
-- evidence of a real within-subject chapter-name collision. The 2026-08-13
-- audit looked and found none among the loaded books -- but knowledge_base is
-- keyed on (exam_type, subject, chapter), so if two books in one subject ever
-- share a chapter name their chunks merge silently, and 'Introduction' opening
-- more than one commerce book is the obvious candidate. The table is EMPTY as
-- of the 2026-08-13 wipe, so adding the column costs no backfill and no
-- migration of 9,243 rows. This window does not come round again.
alter table public.knowledge_base
  add column if not exists book text;

comment on column public.knowledge_base.book is
  'The textbook volume a chunk belongs to, mirroring syllabus_nodes.book. NULL means the subject has a single book. Added while the table was empty (2026-08-13 wipe) to close the risk of two books in one subject sharing a chapter name and merging their chunks.';

create index if not exists kb_exam_subject_book_idx
  on public.knowledge_base (exam_type, subject, book)
  where book is not null;

-- ── Admin write surface ──────────────────────────────────────────────────
-- assert_verified_admin resolves identity from the JWT via verified_uid() and
-- requires p_caller to match it plus an active admins row, so a caller cannot
-- act as someone else. See 20260809030000.

create or replace function public.admin_upsert_chapter_manifest(
  p_caller text, p_id uuid, p_exam_type text, p_subject text, p_book text,
  p_class_level text, p_key_prefix text, p_source_file text, p_entries jsonb, p_notes text
) returns uuid
language plpgsql security definer set search_path = public
as $function$
declare v_id uuid;
begin
  perform assert_verified_admin(p_caller);

  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'entries must be a jsonb array' using errcode = '22023';
  end if;

  if p_id is null then
    insert into public.chapter_manifests
      (exam_type, subject, book, class_level, key_prefix, source_file, entries, notes)
    values
      (p_exam_type, p_subject, p_book, p_class_level, coalesce(p_key_prefix, 'c'), p_source_file, p_entries, p_notes)
    returning id into v_id;
  else
    -- An APPROVED manifest is immutable. Editing one in place would silently
    -- change the identity of chapters already loaded against it; supersede and
    -- create a new draft instead.
    update public.chapter_manifests
       set exam_type = p_exam_type, subject = p_subject, book = p_book,
           class_level = p_class_level, key_prefix = coalesce(p_key_prefix, 'c'),
           source_file = p_source_file, entries = p_entries, notes = p_notes,
           updated_at = now()
     where id = p_id and status = 'draft'
    returning id into v_id;
    if v_id is null then
      raise exception 'manifest % is not a draft (approved manifests are immutable)', p_id using errcode = '42501';
    end if;
  end if;
  return v_id;
end;
$function$;

create or replace function public.admin_approve_chapter_manifest(p_caller text, p_id uuid)
returns uuid
language plpgsql security definer set search_path = public
as $function$
declare v_row public.chapter_manifests%rowtype;
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

revoke all on function public.admin_upsert_chapter_manifest(text,uuid,text,text,text,text,text,text,jsonb,text) from public, anon;
revoke all on function public.admin_approve_chapter_manifest(text,uuid) from public, anon;
grant execute on function public.admin_upsert_chapter_manifest(text,uuid,text,text,text,text,text,text,jsonb,text) to authenticated;
grant execute on function public.admin_approve_chapter_manifest(text,uuid) to authenticated;
