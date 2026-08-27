-- Fixes a false-positive "page ranges overlap" bug in validateManifest
-- (src/lib/chapterManifest.js) for any book with a Unit -> Chapter structure,
-- where the book's contents page prints a Unit/Theme heading WITH ITS OWN
-- page range that is supposed to fully contain its child chapters' ranges
-- (Kerala State English Class 8: "Unit II Wings of Hope" pp41-72 containing
-- "Hope is the Thing with Feathers" pp43-46). The JS validator used to treat
-- every entry as a flat sibling and flag that expected containment as an
-- overlap, blocking save/approve for any such manifest.
--
-- The JS fix adds a new `isUnit: true` flag to an entry, marking it as the
-- printed heading itself rather than a real leaf chapter (see chapterManifest.js
-- for the full containment logic: a container's own children are whichever
-- leaf entries carry `unit === container.title`, the same field every leaf
-- already had).
--
-- That JS fix alone is not enough, though: admin_approve_chapter_manifest
-- (20260815030000) independently refuses to approve ANY manifest with a null
-- fileOrdinal on any entry where numbered is true (the default) -- a
-- container never has a fileOrdinal (it spans several chapters' files, not
-- one), so without this migration a manifest that passes the JS validator
-- would still be refused by this DB-side gate on Approve.

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
     and coalesce((e->>'isUnit')::boolean, false) = false
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

comment on column public.chapter_manifests.entries is
  'jsonb array: [{ordinal, title, unit, pageStart, pageEnd, numbered, printedNumber, fileOrdinal, band, isUnit}]. ordinal is identity+sort; printedNumber is what the book prints (restarts per section); fileOrdinal is the filename index. isUnit=true marks a UNIT CONTAINER row -- the printed Unit/Theme heading itself (e.g. "Unit II Wings of Hope" pp41-72), whose own children are whichever OTHER entries carry unit === this entry''s title. A container never has a fileOrdinal and is never itself a candidate for a file''s content -- see chapterManifest.js.';
