create or replace function public._debug_get_columns2(tbl_names text[])
returns table(table_name text, column_name text, data_type text)
language sql
security definer
set search_path = public
as $$
  select c.table_name, c.column_name, c.data_type
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = any(tbl_names)
  order by c.table_name, c.ordinal_position
$$;

grant execute on function public._debug_get_columns2(text[]) to anon;
