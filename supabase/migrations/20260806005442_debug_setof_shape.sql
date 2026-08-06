create or replace function public._debug_setof_text()
returns setof text
language sql
security definer
as $$ select unnest(array['alpha','beta','gamma']); $$;

grant execute on function public._debug_setof_text() to anon;
