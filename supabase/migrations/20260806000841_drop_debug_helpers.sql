-- Cleanup: drop the temporary schema-introspection helpers used to inspect
-- existing function/table definitions while diagnosing BUG-004. Not meant to
-- ship — they exposed pg_get_functiondef/information_schema to anon.
drop function if exists public._debug_get_defs(text[]);
drop function if exists public._debug_get_columns(text[]);
drop function if exists public._debug_get_constraints(text[]);
