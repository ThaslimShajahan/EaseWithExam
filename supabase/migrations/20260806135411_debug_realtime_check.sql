create or replace function public._debug_realtime_and_rls(tbl_names text[])
returns table(table_name text, in_realtime_pub boolean, rls_enabled boolean, policy_name text, cmd text, roles text, using_expr text)
language sql
security definer
set search_path = public
as $$
  select
    c.relname,
    exists (
      select 1 from pg_publication_tables pt
      where pt.pubname = 'supabase_realtime' and pt.tablename = c.relname and pt.schemaname = 'public'
    ),
    c.relrowsecurity,
    p.polname,
    p.polcmd::text,
    array_to_string(p.polroles::regrole[]::text[], ','),
    pg_get_expr(p.polqual, p.polrelid)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_policy p on p.polrelid = c.oid
  where n.nspname = 'public' and c.relname = any(tbl_names)
$$;

grant execute on function public._debug_realtime_and_rls(text[]) to anon;
