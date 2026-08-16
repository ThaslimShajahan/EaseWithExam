-- Same mistake 20260815060000 already found and named: Firebase third-party
-- auth requests carry no Postgres `role` claim, so they run as `anon` in
-- PostgREST, not `authenticated`. 20260816000000 granted
-- admin_list_ai_call_log / admin_ai_usage_summary to `authenticated` only,
-- making both unreachable for every real caller — confirmed live, "permission
-- denied for function admin_list_ai_call_log" on first use, same shape as the
-- admin_upsert_chapter_manifest incident four hours earlier the same night.
--
-- assert_verified_admin(p_caller) in the function body is still the real
-- security boundary regardless of which Postgres role can reach it.

grant execute on function public.admin_list_ai_call_log(text,timestamptz,text,integer) to anon;
grant execute on function public.admin_ai_usage_summary(text,timestamptz) to anon;
