create or replace function public._debug_get_constraints2(tbl_names text[])
returns table(table_name text, constraint_name text, def text)
language sql
security definer
set search_path = public
as $$
  select t.relname, con.conname, pg_get_constraintdef(con.oid)
  from pg_constraint con
  join pg_class t on t.oid = con.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public' and t.relname = any(tbl_names)
$$;

grant execute on function public._debug_get_constraints2(text[]) to anon;
