create or replace function public._debug_get_policies2(tbl_names text[])
returns table(table_name text, policy_name text, cmd text, roles text, using_expr text, check_expr text, rls_enabled boolean)
language sql
security definer
set search_path = public
as $$
  select
    c.relname,
    p.polname,
    p.polcmd::text,
    array_to_string(p.polroles::regrole[]::text[], ','),
    pg_get_expr(p.polqual, p.polrelid),
    pg_get_expr(p.polwithcheck, p.polrelid),
    c.relrowsecurity
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = any(tbl_names)
  union all
  select c.relname, null, null, null, null, null, c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = any(tbl_names)
    and not exists (select 1 from pg_policy p where p.polrelid = c.oid)
$$;

grant execute on function public._debug_get_policies2(text[]) to anon;
