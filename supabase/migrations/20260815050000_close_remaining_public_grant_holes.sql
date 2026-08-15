-- Close the PUBLIC-EXECUTE hole (same class as 20260815041500) on every OTHER
-- admin_* function the audit script currently flags — 18 of them, all created
-- after 20260811140000's one-time sweep and never individually revoked since.
--
-- AUDITED BEFORE WRITING THIS, NOT ASSUMED: every one of the 18 was read in
-- its defining migration and confirmed to call assert_verified_admin(p_caller)
-- as its first real statement (admin_list_inbound_emails and
-- admin_set_inbound_email_status additionally re-check `admins.is_active`,
-- belt and braces). Live-probed five of them with the anon key and a bogus
-- p_caller — admin_clear_knowledge_base (the most destructive one on the
-- list, an unconditional DELETE), admin_delete_pyq_rows, and
-- admin_list_inbound_emails all returned "Access denied: unverified caller";
-- the other two in the sample failed on argument-shape (PostgREST can't
-- resolve an overload from partial args), not a security signal.
--
-- So: none of these 18 are exploitable beyond the existing body-level check,
-- same defense-in-depth reasoning as 20260815041500. This closes the role
-- layer everywhere that layer was missing, matching 20260809030000's
-- original two-layer design intent, and closes what
-- scripts/audit-admin-rpc-grants.mjs currently reports as PASS.
--
-- Grouped by defining migration, for anyone tracing a signature back later:
--   20260812020000 (pyq admin write RPCs)
--   20260814020000 (admin_insert_pyq_rows, chapter_key revision)
--   20260814030000 (categories validation)
--   20260814050000 (content_jobs, Tier 1)
--   20260814080000 (quota overrides)
--   20260814130000 (inbound support inbox)
--   20260815020000 (knowledge_base / syllabus_nodes lockdown)

revoke execute on function public.admin_clear_pyq_questions(text) from public;
revoke execute on function public.admin_delete_pyq_rows(text, uuid[]) from public;
revoke execute on function public.admin_set_pyq_image(text, uuid, text) from public;
revoke execute on function public.admin_update_pyq_status(text, uuid[], text) from public;

revoke execute on function public.admin_insert_pyq_rows(text, jsonb) from public;

revoke execute on function public.admin_upsert_syllabus_node(text, text, text, text, text, text, integer, jsonb, uuid, text) from public;

revoke execute on function public.admin_record_content_job(text, uuid, uuid, text, text, text, text, integer, text, text[], text[], integer, text) from public;
revoke execute on function public.admin_list_content_jobs(text, integer) from public;

revoke execute on function public.admin_set_quota_override(text, text, integer, integer, integer, integer, integer, integer, timestamp with time zone, text) from public;
revoke execute on function public.admin_clear_quota_override(text, text) from public;
revoke execute on function public.admin_get_quota_override(text, text) from public;

revoke execute on function public.admin_list_inbound_emails(text, text) from public;
revoke execute on function public.admin_set_inbound_email_status(text, uuid, text) from public;

revoke execute on function public.admin_insert_knowledge_chunks(text, jsonb) from public;
revoke execute on function public.admin_delete_knowledge_chunks(text, uuid[]) from public;
revoke execute on function public.admin_clear_knowledge_base(text) from public;
revoke execute on function public.admin_insert_syllabus_nodes(text, jsonb) from public;
revoke execute on function public.admin_migrate_syllabus_exam_type(text, text, text, text) from public;
