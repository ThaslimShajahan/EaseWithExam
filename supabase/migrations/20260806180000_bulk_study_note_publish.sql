-- PART C (batch 6): Study Notes default to hidden and had to be toggled
-- visible one at a time — a real problem with 668+ notes. Single bulk RPC
-- (one UPDATE, not N client-side round-trips) so "make all visible" on a
-- large filtered set is one atomic statement instead of hundreds of calls.
create or replace function public.admin_bulk_set_study_notes_published(
  p_caller text, p_ids uuid[], p_published boolean
)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare v_role text; v_count int;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;

  update study_notes set is_published = p_published, updated_at = now()
  where id = any(p_ids);
  get diagnostics v_count = row_count;

  return json_build_object('ok', true, 'updated', v_count);
end;
$function$;

grant execute on function public.admin_bulk_set_study_notes_published(text, uuid[], boolean) to anon, authenticated;
