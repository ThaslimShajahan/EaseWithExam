-- Genuine hard-delete for chapter_manifests, distinct from Revise (which
-- never touches the old row) and from Approve's own auto-supersede (which
-- also never deletes). This is for real one-off cleanup: a manifest created
-- by mistake, duplicate test data, or a discontinued book. Same
-- assert_verified_admin gating as admin_upsert_chapter_manifest /
-- admin_approve_chapter_manifest (20260813020000) — no status restriction
-- here (draft, approved, and superseded rows are all deletable); the extra
-- guard for deleting an APPROVED manifest lives client-side
-- (AdminChapterManifest.jsx's confirm panel), same split already used for
-- Approve's own confirm (window.confirm) vs. the RPC's own gate.
create or replace function public.admin_delete_chapter_manifest(p_caller text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_row public.chapter_manifests%rowtype;
begin
  perform assert_verified_admin(p_caller);

  select * into v_row from public.chapter_manifests where id = p_id;
  if not found then
    raise exception 'manifest % not found', p_id using errcode = 'P0002';
  end if;

  delete from public.chapter_manifests where id = p_id;
end;
$function$;

-- Every PostgREST request runs as `anon` regardless of Firebase sign-in
-- state (Firebase ID tokens carry no Postgres role claim) — grant to
-- `authenticated` alone silently 403s every real caller. Learned the hard
-- way on 20260811180000/20260813090000; repeating the fix here rather than
-- rediscovering it.
grant execute on function public.admin_delete_chapter_manifest(text, uuid) to anon, authenticated;
