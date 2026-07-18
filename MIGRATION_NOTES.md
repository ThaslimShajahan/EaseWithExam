# Migration Notes

All schema changes are additive with rollback comments. Run migrations in order.
Never delete or destructively alter existing tables or data.

---

## 0001_feature_flags.sql
**Date:** 2026-07-14  
**Purpose:** Gate new Phase 0–6 flows behind DB-driven flags. Flags default to `false`; existing behaviour is unchanged.  
**Tables added:** `feature_flags`  
**Seeded keys (all false):**
- `syllabus_graph_enabled`
- `content_review_queue_enabled`
- `content_versioning_enabled`
- `centre_content_pool_enabled`
- `centre_test_builder_enabled`
- `exam_blueprint_enabled`
- `misconception_engine_enabled`
- `atomic_quota_rpc_enabled`
- `dalle_proxy_enabled`

**RLS:** authenticated SELECT only; writes via service role only.  
**Helper:** `src/lib/featureFlags.js` — `getFeatureFlag(key)`, `useFeatureFlag(key)`, `FLAGS.*` constants.  
**Rollback:** see SQL file bottom section.

---

## 0002_changelog.sql
**Date:** 2026-07-14  
**Purpose:** Immutable append-only audit trail for every admin/coaching mutation.  
**Tables added:** `changelog`  
**Indexes:** `(entity_type, entity_id)`, `actor_uid`, `created_at desc`  
**RLS:** authenticated INSERT and SELECT; no UPDATE or DELETE.  
**Helper:** `src/lib/changelog.js` — `logChange()`, `ENTITY.*`, `ACTION.*`.  
**Wired into:**
- `supabase.js`: `adminGrantPremium`, `adminSaveKnowledgeChunks`, `adminDeletePapers`, `adminDeleteAllPapers`, `adminClearAllData`, `publishTest`, `publishPYQPaper`, `deletePublishedTest`
- `AdminPDFUpload.jsx`: pyq_questions insert, knowledge_base insert
- `AdminPricing.jsx`: plan_config upsert
- `AdminStudyNotes.jsx`: upsert, toggle publish, delete
- `AdminCoaching.jsx`: coaching_centres insert/update, coaching_students insert/delete, coaching_assignments insert/delete

**Rollback:** see SQL file bottom section.

---

## 0003_syllabus_nodes.sql
**Date:** 2026-07-14  
**Purpose:** Canonical syllabus graph — DB-driven chapter list per exam_type/subject. Replaces hardcoded `syllabusData.js` when `syllabus_graph_enabled` flag is on.  
**Tables added:** `syllabus_nodes`  
**RLS:** authenticated SELECT where `is_active = true`; no client writes.  
**Helper:** `src/lib/syllabus.js` — `getChapters(examType, subject)`, `getAllChapters(examType)`.  
**Rollback:** see SQL file bottom section.

---

## 0004_syllabus_seed.sql
**Date:** 2026-07-14  
**Purpose:** Seeds `syllabus_nodes` with NEET (Biology 38, Physics 19, Chemistry 30) and JEE Main (Physics 27, Chemistry 24, Mathematics 13) chapters. Safe to re-run (`ON CONFLICT DO NOTHING`).  
**Rollback:** delete rows by exam_type only.

---

## 0005_content_pipeline.sql
**Date:** 2026-07-14  
**Purpose:** Review queue for uploaded content. New PDF extractions land as `in_review` when `content_review_queue_enabled` is on.  
**Schema changes:**
- `pyq_questions.status` column added (default `'published'`, check `in_review|published|archived`)
- `content_versions` table added (append-only, no UPDATE/DELETE policy)

**UI:** `AdminContentReview.jsx` — bulk approve/reject queue at `/admin/review`.  
**Wired into:** `AdminPDFUpload.jsx` (sets status from flag), `supabase.js` `getPYQQuestions` (filters by status).  
**Rollback:** see SQL file bottom section.

---

## 0006_centre_content.sql
**Date:** 2026-07-14  
**Purpose:** Multi-tenancy — coaching centres can publish their own tests scoped to their students.  
**Tables added:**
- `centre_published_tests` (centre-scoped, RLS: students read their centre's tests only)
- `centre_student_results` (students can insert/read own results)

**UI:** `src/coaching/CoachingTestBuilder.jsx` — test builder in coaching portal at `/coaching/tests`.  
**Gated by:** `centre_test_builder_enabled` flag.  
**Rollback:** see SQL file bottom section.

---

## 0007_exam_blueprints.sql
**Date:** 2026-07-14  
**Purpose:** DB-driven paper structure so admins can tune question counts and marks without a code deploy.  
**Tables added:** `exam_blueprints` (seeded for NEET, JEE Main, JEE Advanced, CBSE)  
**RLS:** authenticated SELECT where `is_active = true`; no client writes.  
**Gated by:** `exam_blueprint_enabled` flag.  
**Wired into:** `questionGen.js` `generateQuestionPaper()` — overlays DB blueprint values on top of JS `PAPER_PATTERNS`.  
**Rollback:** see SQL file bottom section.

---

## 0008_misconceptions.sql
**Date:** 2026-07-14  
**Purpose:** Log wrong answers per student for AI-targeted remediation.  
**Tables added:** `concept_misconceptions` (user-scoped RLS: select/insert/update own rows)  
**Functions added:** `upsert_misconception(...)` — atomic insert-or-increment.  
**Gated by:** `misconception_engine_enabled` flag.  
**Wired into:** `PracticeGeneratorPage.jsx` `handleNext()` — logs wrong MCQ answers via RPC (fire-and-forget).  
**Rollback:** see SQL file bottom section.

---

## 0009_atomic_quota_rpc.sql
**Date:** 2026-07-14  
**Purpose:** Eliminate client-side read-modify-write race in quota increment. Two concurrent requests both reading 0 and both writing 1 bypassed the daily gate.  
**Functions added:** `check_and_increment_quota(p_uid, p_field, p_amount, p_date)` — single transaction with `FOR UPDATE` lock.  
**Gated by:** `atomic_quota_rpc_enabled` flag.  
**Wired into:** `src/lib/quota.js` `incrementQuota()` — uses RPC path when flag is on, legacy path otherwise.  
**Rollback:** see SQL file bottom section.

---

## Phase 6 (DALL-E proxy)
**Date:** 2026-07-14  
**No migration needed** — client-only change.  
**Edge Function updated:** `supabase/functions/ai-proxy/index.ts` — added `?route=images` path that forwards to `https://api.openai.com/v1/images/generations`.  
**Helper updated:** `src/lib/aiProxy.js` — `generateImage(prompt, opts)` routes through Edge Function when `VITE_USE_EDGE_FUNCTIONS=true`.  
**Gated by:** `dalle_proxy_enabled` flag (consumers check this before calling `generateImage`).

---

## 0010_centre_invites.sql
**Date:** 2026-07-14
**Purpose:** Coaching centre student invite link system — coaches share short links/QR codes to enrol students without manual data entry.
**Tables added:** `centre_invites` (id, centre_id FK→coaching_centres, invite_code unique 8-char, batch, max_uses, used_count, expires_at, is_active, created_by, created_at)
**RLS:** deny all direct writes; SELECT scoped to centre admins. All mutations through SECURITY DEFINER RPCs only.
**RPCs added:**
- `generate_invite_code()` — internal helper, unambiguous 56-char alphabet (no 0/O/1/l)
- `get_invite_preview(p_code)` — anon-callable; returns centre name/logo/brand/batch or typed error
- `redeem_centre_invite(p_code, p_uid)` — atomic FOR UPDATE; validates, inserts coaching_students, increments used_count; idempotent
- `create_centre_invite(p_caller_uid, p_centre_id, p_batch, p_max_uses, p_expires_at)` — coaching admins only
- `deactivate_centre_invite(p_invite_id, p_caller_uid)` — coaching admins only
- `get_centre_invites(p_caller_uid)` — coaching admins only, returns their centre's invites
- `admin_get_centre_invites(p_centre_id)` — platform admin read-only view
**Feature flag seeded:** `centre_invites_enabled = false`
**Client helpers:** `src/lib/invites.js`
**UI changes:**
- `src/coaching/CoachingStudentsPage.jsx` — "Invite students" collapsible card with per-link Copy/WhatsApp/QR
- `src/pages/JoinCentrePage.jsx` — public `/join/:code` route; branded join card; auto-redeem after auth
- `src/pages/DashboardPage.jsx` — pending invite redirect (`edu_pending_invite` localStorage key)
- `src/admin/AdminCoaching.jsx` — read-only "Invites" tab in CentreDetail
- `src/App.jsx` — `/join/:code` public route
**Rollback:** see SQL file bottom section.

---

## 0011_quota_rls_scope.sql
**Date:** 2026-07-14
**Purpose:** Close write-RLS gap on `daily_usage_quota` (anon key could upsert arbitrary user rows) and add `scope_key` to `daily_challenges` for per-exam-track filtering.
**Schema changes:**
- `daily_usage_quota` — REVOKE INSERT, UPDATE from anon + authenticated; writes now only through `upsert_usage_quota` RPC
- `daily_challenges.scope_key text` column added; existing rows back-filled with `'NEET'`
**RPC added:** `upsert_usage_quota(p_uid, p_date, p_field, p_amount)` — SECURITY DEFINER, whitelists field names to prevent injection; grant to anon + authenticated
**Wired into:** `src/lib/quota.js` — should call `upsert_usage_quota` RPC instead of direct upsert (update `incrementQuota` to use RPC)
**Rollback:** see SQL file bottom section.

---

## 0012_admin_flag_rpcs.sql
**Date:** 2026-07-14
**Purpose:** Expose feature flag read/write and changelog read to admin UI without giving the browser direct table write access.
**Tables affected:** `feature_flags` (reads), `changelog` (reads)
**RPCs added:**
- `admin_get_feature_flags(p_caller text)` — SECURITY DEFINER; caller must be an admin; returns all rows from `feature_flags`
- `admin_toggle_feature_flag(p_caller text, p_key text, p_enabled boolean)` — SECURITY DEFINER; superadmin-only; UPDATE + changelog entry
- `admin_get_activity_log(p_caller text, p_limit int, p_offset int)` — SECURITY DEFINER; admin-only; returns `changelog` rows newest-first
**UI wired into:**
- `src/admin/AdminFeatureFlags.jsx` — toggle UI at `/admin/flags` (superadmin only)
- `src/admin/AdminActivityLog.jsx` — audit trail viewer at `/admin/activity` (superadmin only)
- `src/admin/AdminStudentLookup.jsx` — direct-table reads (quota, gamification, test sessions) at `/admin/lookup` (superadmin only)
**Routes added to:** `src/App.jsx` (`/admin/flags`, `/admin/activity`, `/admin/lookup`)
**Nav added to:** `src/admin/AdminLayout.jsx` SUPER_NAV section
**Rollback:** see SQL file bottom section.

---

## Activation checklist (run in DB console after each migration)

To enable a phase for the first time:
```sql
update feature_flags set enabled = true where key = '<flag_key>';
```

All flags remain `false` by default — existing student flows are unaffected until you explicitly enable them.
