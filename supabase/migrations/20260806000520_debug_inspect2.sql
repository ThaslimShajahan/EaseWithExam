create or replace function public._debug_get_columns(tbl_names text[])
returns table(table_name text, column_name text, data_type text, is_nullable text, column_default text)
language sql
security definer
set search_path = public
as $$
  select c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = any(tbl_names)
  order by c.table_name, c.ordinal_position
$$;

grant execute on function public._debug_get_columns(text[]) to anon;

create or replace function public._debug_get_constraints(tbl_names text[])
returns table(table_name text, constraint_name text, constraint_type text, def text)
language sql
security definer
set search_path = public
as $$
  select t.relname, con.conname, con.contype::text, pg_get_constraintdef(con.oid)
  from pg_constraint con
  join pg_class t on t.oid = con.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public' and t.relname = any(tbl_names)
$$;

grant execute on function public._debug_get_constraints(text[]) to anon;
