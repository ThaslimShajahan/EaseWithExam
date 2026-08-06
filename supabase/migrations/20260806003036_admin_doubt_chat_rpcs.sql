-- Locking doubt_chats/doubt_messages down (previous migration) breaks the
-- existing admin oversight screens (AdminVeda.jsx, AdminOverview.jsx),
-- which read these tables directly with no caller check at all today.
-- Give them the same admin-checked RPC pattern as the rest of the admin_*
-- surface instead of leaving them broken.

create or replace function public.admin_list_doubt_chats(p_caller text, p_limit int default 100)
returns setof doubt_chats
language plpgsql
security definer
set search_path = public
as $$
declare v_role text;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;
  return query select * from doubt_chats order by created_at desc limit p_limit;
end;
$$;

create or replace function public.admin_list_doubt_messages(p_caller text, p_chat_ids uuid[])
returns setof doubt_messages
language plpgsql
security definer
set search_path = public
as $$
declare v_role text;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;
  return query select * from doubt_messages where chat_id = any(p_chat_ids) order by created_at asc;
end;
$$;

grant execute on function public.admin_list_doubt_chats(text, int) to anon;
grant execute on function public.admin_list_doubt_messages(text, uuid[]) to anon;
