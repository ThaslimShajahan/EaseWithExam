-- "Backup all data" — full-platform export to a browser-downloaded zip.
-- Superadmin-only (stricter than every other admin_* RPC tonight, which all
-- allow role in ('superadmin','admin') via assert_verified_admin).
--
-- WHY A NEW RPC IS NEEDED AT ALL, GIVEN chapter_manifests/knowledge_base/
-- pyq_questions/content_figures ALL ALREADY HAVE `using (true)` SELECT
-- policies: the client fetches those four tables directly (paginated
-- .select('*').range()), same as the rest of the app already does for its
-- own display purposes — no new RPC needed for them, and gating a read RPC
-- around data that's already openly selectable would be theatre, not
-- security. study_notes is the one exception: `study_notes_read` is
-- `using (is_published = true)`, so a plain anon-key select silently misses
-- every draft/unpublished row (confirmed live: 323 total, 296 published, 27
-- invisible to anon). "Backup ALL data" has to mean all 323, so the export
-- of that one table goes through this SECURITY DEFINER path instead.

-- Stricter than assert_verified_admin: requires the 'superadmin' role
-- specifically, not 'admin'. Same verified_uid()/admins-table shape as
-- assert_verified_admin (20260809030000) — kept as a separate function
-- rather than adding a flag param to assert_verified_admin, since every
-- existing call site (14+ RPCs) assumes the admin-or-superadmin behaviour
-- and a shared signature change would need auditing all of them.
create or replace function public.assert_verified_superadmin(p_caller text)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_sub text; v_role text;
begin
  v_sub := verified_uid();
  if v_sub is null then
    raise exception 'Access denied: unverified caller' using errcode = '42501';
  end if;
  if p_caller is null or p_caller <> v_sub then
    raise exception 'Access denied: caller mismatch' using errcode = '42501';
  end if;
  select role into v_role from admins where uid = v_sub and is_active = true;
  if v_role is null or v_role <> 'superadmin' then
    raise exception 'Access denied: superadmin only' using errcode = '42501';
  end if;
  return v_role;
end;
$function$;

-- Gate + row-count summary, called once before the client starts fetching.
-- Counts study_notes with no is_published filter (SECURITY DEFINER bypasses
-- RLS) so the returned total matches what the export will actually contain,
-- not what an anon SELECT would see.
create or replace function public.admin_start_data_export(p_caller text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare v_counts jsonb;
begin
  perform assert_verified_superadmin(p_caller);

  select jsonb_build_object(
    'chapter_manifests', (select count(*) from public.chapter_manifests),
    'study_notes',       (select count(*) from public.study_notes),
    'knowledge_base',    (select count(*) from public.knowledge_base),
    'pyq_questions',     (select count(*) from public.pyq_questions),
    'content_figures',   (select count(*) from public.content_figures)
  ) into v_counts;

  return v_counts;
end;
$function$;

-- Paginated study_notes export INCLUDING unpublished/draft rows (the one
-- table anon can't fully see — see the file header). Ordered by id so
-- repeated offset/limit calls from the client paginate deterministically
-- even if rows are being edited concurrently mid-export.
create or replace function public.admin_export_study_notes(p_caller text, p_offset int, p_limit int)
returns setof public.study_notes
language plpgsql
security definer
set search_path = public
as $function$
begin
  perform assert_verified_superadmin(p_caller);

  return query
    select * from public.study_notes
    order by id
    limit p_limit offset p_offset;
end;
$function$;

grant execute on function public.admin_start_data_export(text) to anon, authenticated;
grant execute on function public.admin_export_study_notes(text, int, int) to anon, authenticated;
