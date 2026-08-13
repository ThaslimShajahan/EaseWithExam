# Security Incidents

One entry per finding. Status is either **OPEN** (found, not yet fixed) or **FIXED** (with the fixing
commit). Do not assume anything here is resolved without checking the live RPC definitions or git log —
a stale "FIXED" is worse than an honest "OPEN".

---

## 2026-08-13 — `upsert_own_user`/`update_own_user`: anon can overwrite any student's profile

**Status: FIXED** — `supabase/migrations/20260813070000_verified_self_rpcs.sql` (commit `c093ab8`).
Applied live and verified independently via `supabase migration list --linked`.

### What's wrong

`public.upsert_own_user(p_uid text, p_fields jsonb)` and `public.update_own_user(p_uid text, p_fields
jsonb)` are `GRANT EXECUTE ... TO anon` (see `supabase/migrations/20260806005045_users_rls_lockdown.sql`)
with **no caller-identity check in the function body** — no `verified_uid()` comparison, nothing binding
the call to the caller's actual Firebase identity. `p_uid` is trusted as given, from any caller.

### How it was found

Discovered incidentally while extending `upsert_own_user` for the Class 11/12 stream-selection feature
(`docs/STREAM_SELECTION_HANDOFF.md`) — unrelated to that feature's scope, just found along the way while
reading the function to extend it safely.

### Proof (not theoretical — actually exploited against live, then cleaned up)

A request carrying only the public anon key (which ships in the client bundle by design, no
authentication) successfully created a full `users` row for an arbitrary, made-up UID:

```
POST /rest/v1/rpc/upsert_own_user
{ "p_uid": "SECURITY-TEST-SYNTHETIC-UID-<timestamp>", "p_fields": { "display_name": "..." } }
-> HTTP 200, row created
```

Test row deleted immediately after confirming (`delete from public.users where firebase_uid like
'SECURITY-TEST-SYNTHETIC-UID-%'`, confirmed 0 remaining).

### Impact

**Right now, anyone who knows or guesses a student's `firebase_uid` can overwrite their
`target_exam`, `syllabus`, `class_level`, `display_name`, `onboarding_completed`**, and — since
2026-08-13 — also `subjects`/`academic_track` (extended for the stream-selection feature; this did not
create a new category of exposure, it added two fields to an already fully-open door). Pre-dates this
entire rebuild; not caused by anything in `docs/REBUILD_HANDOFF.md` or
`docs/STREAM_SELECTION_HANDOFF.md`.

### Owner decision (asked via `AskUserQuestion`, not assumed)

Log this, continue feature work, fix separately. Rationale accepted: extending the RPC for stream
selection grows the blast radius on an already fully-open door, it doesn't open a new one.

### The fix

A single reusable helper, not one-off patches — per explicit instruction not to hand-patch 8 RPCs
independently if the gap is a repeated pattern:

```sql
assert_verified_self(p_claimed_uid text) returns text
```

Mirrors `assert_verified_admin()`'s existing two-step shape (unverified caller → `42501`, caller/claimed
mismatch → `42501`), `security definer`, granted to `authenticated` only, revoked from `public`/`anon`.
Each fixed RPC now calls it as its first statement.

**8 RPCs in scope, 7 got the helper, 1 got a different fix:**

| RPC | Fix |
|---|---|
| `upsert_own_user` | `assert_verified_self(p_uid)` added |
| `update_own_user` | `assert_verified_self(p_uid)` added |
| `check_and_increment_quota` | `assert_verified_self(p_uid)` added |
| `get_user_notifications` | `assert_verified_self(p_uid)` added |
| `save_wrong_answers` | `assert_verified_self(p_uid)` added |
| `publish_test_by_student` | `assert_verified_self(p_uid)` added |
| `student_submit_centre_result` | `assert_verified_self(p_uid)` added (kept its pre-existing independent centre-membership check as a second layer) |
| `referral_grant_premium_days` | **Not given the helper.** Traced its only real caller: `complete_referral()` (itself `security definer`, invoked from the razorpay-verify edge function) legitimately calls it with `v_referrer` — a *different* uid than the request caller (`PERFORM referral_grant_premium_days(v_referrer, v_days);` in `20260809070000_referral_convert_on_payment.sql`). Applying a self-match check here would break real referral payouts. Instead: `revoke all on function ... from public, anon, authenticated;` so it's reachable only through the `security definer` call chain, never directly by a client. |

Before relying on the revoke-from-inner-function mechanism, proved it actually enforces (rather than
assuming Postgres grant semantics): an isolated `_probe_inner`/`_probe_outer` pair in a rolled-back
transaction, `set role anon`, confirmed a direct anon call to the revoked inner function fails `42501`,
but a `security definer` outer function calling it internally still succeeds — which is exactly why
`referral_grant_premium_days`'s real caller chain keeps working after the revoke.

### Verification (both halves, real evidence, not assumed)

1. **14-assertion rolled-back transaction test** — DENY (unverified caller, mismatched uid) and PERMIT
   (matching uid) for all 7 helper-gated RPCs, plus the revoke mechanism itself.
2. **Re-ran the exact original exploit** via genuine unauthenticated anon HTTP against all 8 RPCs — all
   now return `401`/`42501`, zero rows created for any test uid.
3. **Real Firebase JWT test** — minted a real Firebase ID token (Admin SDK `createCustomToken` →
   Identity Toolkit `signInWithCustomToken` exchange for a genuinely signed token — *not* the QA-bypass
   dev harness in `AuthContext.jsx`, which sets `currentUser` client-side with no real JWT and can't test
   a server-side JWT check). Called `upsert_own_user`:
   - matching `p_uid` → `HTTP 200`, row created with real fields
   - same valid token, mismatched `p_uid` → `HTTP 401 {"code":"42501","message":"Access denied: caller mismatch"}`

   This proves the fix holds through the real Firebase→Supabase trust chain, not just a simulated
   `set local request.jwt.claims`.
4. `npx vitest run`: 424/424 passing. `npx vite build`: clean.

Test data cleaned up (Firebase test user deleted via Admin SDK, `public.users` test rows deleted,
temp scripts removed from repo root).

---

## 2026-08-13 — Remaining 68 RPCs with the same missing-caller-check pattern

> # 🚨 HARD GATE — Batch 2 MUST ship before the first coaching centre exists
>
> ```sql
> select count(*) from coaching_centres;   -- if this is > 0, Batch 2 is OVERDUE, not "next"
> ```
>
> **Check this before onboarding any coaching centre, and before starting any other feature work
> that creates one.** Batch 2 (the 9-RPC invite/privilege-escalation surface, listed below) was
> deliberately sequenced *after* the stream-selection admin editor on 2026-08-13, on the explicit
> reasoning that **every table it protects was empty at the time** — verified live that day:
>
> | table | rows on 2026-08-13 |
> |---|---|
> | `coaching_centres` | 0 |
> | `coaching_admins` | 0 |
> | `coaching_admin_invites` | 0 |
> | `centre_invites` | 0 |
> | `coaching_students` | 0 |
>
> The exposure is **latent, not theoretical**: `create_coaching_admin_invite` lets an unverified
> caller mint themselves ongoing coaching-admin access to any centre — it just needs a real
> `p_centre_id` to aim at, and there were none. **The day a coaching centre is created, this becomes
> a live privilege-escalation hole.** The deferral is only valid while that count is zero.
>
> Owner-agreed gate, 2026-08-13. Not a calendar promise — a checkable condition.

**Status: OPEN**, catalogued below by risk, with a remediation batch plan. Not fixed in this pass —
the 8 above were the confirmed-severe + originally-reported set; these 68 are the rest of the same
live-audit result (`SECURITY DEFINER` functions granted to `anon`/`authenticated` whose body doesn't
mention `verified_uid()`/`assert_verified_admin`).

### How this list was produced

Live audit query against `pg_proc`/`pg_get_functiondef`, not migration files (which can be superseded
out of order) — see `mentions_identity_check` in the query in the earlier finding's audit. 174 total
`SECURITY DEFINER` functions granted to `anon`/`authenticated`; 76 have no identity-check mention; 8
fixed above; **68 remain**.

**Known blind spot in the audit query itself**: it only pattern-matches param names `p_uid`, `p_caller`,
`p_firebase_uid`. Two real identity params slipped past that regex and needed manual catch:
- `coaching_centre_update_branding(p_admin_uid, ...)` — `p_admin_uid` doesn't contain the substring
  `p_uid` positioned as the regex expects... actually it does contain `n_uid` not `p_uid`, so it was
  missed. Confirmed manually: this RPC has **no check of any kind**, not even `assert_verified_admin`,
  and lets any caller rebrand *any* coaching centre. Included below under auth-bypass-capable.
- `upsert_misconception(p_user_id, ...)` (both overloads) — `p_user_id` doesn't match `p_uid`. Real
  identity param, missed by the regex, manually included below.

Any future scripted sweep of this list should fix the regex first (`p_uid|p_caller|p_user_id|p_admin_uid|p_firebase_uid` at minimum) rather than trust the original query's `takes_identity_param` column as exhaustive.

### auth-bypass-capable (20) — arbitrary identity lets you escalate privilege, act as/against someone else, or defeat an integrity control

| RPC | Args | Why it's here |
|---|---|---|
| `admin_verify_passcode` | `p_uid, p_hash` | passcode-hash comparison oracle for an arbitrary uid |
| `coaching_centre_update_branding` | `p_admin_uid, p_centre_id, p_field, p_value` | **no check at all** (missed by the audit regex, see above); cross-tenant write to any centre |
| `coaching_delete_assignment` | `p_caller, p_id` | arbitrary caller deletes any centre's assignment |
| `coaching_delete_test` | `p_caller, p_id` | arbitrary caller deletes any centre's test |
| `coaching_upsert_assignment` | `p_caller, p_id, p_fields` | arbitrary caller writes any centre's assignment |
| `coaching_upsert_test` | `p_caller, p_id, p_fields` | arbitrary caller writes any centre's test |
| `complete_referral` | `p_uid` | financial impact — referral premium-day grants |
| `confirm_email_connect` | `p_uid, p_code` | connects an email to an arbitrary account — account-takeover shaped |
| `create_centre_invite` | `p_caller_uid, p_centre_id, ...` | mints an access-granting invite for any centre |
| `create_coaching_admin_invite` | `p_caller, p_centre_id, ...` | **privilege escalation** — mints a coaching-admin invite for any centre |
| `deactivate_centre_invite` | `p_invite_id, p_caller_uid` | arbitrary caller deactivates any centre's invite |
| `get_centre_invites` | `p_caller_uid` | lists any centre's live invite codes (access-granting, not just data) |
| `list_coaching_admin_invites` | `p_caller, p_centre_id` | lists any centre's pending admin invites |
| `redeem_centre_invite` | `p_code, p_uid` | binds a redeemed invite to an arbitrary uid, not the caller |
| `redeem_coaching_admin_invite` | `p_code, p_uid, p_email` | same shape, admin-tier invite |
| `revoke_coaching_admin_invite` | `p_caller, p_invite_id` | arbitrary caller revokes any centre's invite |
| `set_email_enabled` | `p_uid, p_enabled` | could silence security/account emails to a victim |
| `clear_exam_attempt_mode` | `p_uid, p_test_id` | defeats an exam-integrity control for another student |
| `lock_exam_attempt_mode` | `p_uid, p_test_id, p_mode` | same — arbitrary caller locks/unlocks another student's exam mode |
| `_coaching_admin_centre` | `p_caller` | leading-underscore internal helper, but it's directly `EXECUTE`-granted to anon/authenticated — worth confirming it isn't meant to be internal-only (same shape as `referral_grant_premium_days` before this fix) |

### data-exposure (29) — arbitrary identity reads someone else's private data, no write/escalation

| RPC | Args | Note |
|---|---|---|
| `can_student_view_test` | `p_test_id, p_uid` | trivial boolean leak |
| `coaching_get_own_centre` | `p_caller` | reads any centre's record as if you administer it |
| `coaching_list_centre_results` | `p_caller` | cross-tenant results/scores |
| `coaching_list_own_assignments` | `p_caller` | |
| `coaching_list_own_students` | `p_caller` | cross-tenant full student roster |
| `coaching_list_own_tests` | `p_caller` | |
| `get_admin_record` | `p_uid` | **check whether the returned row includes `passcode_hash`** before batching — if so this pairs with `admin_verify_passcode` above for offline cracking, raise to auth-bypass-capable |
| `get_coaching_admin_record` | `p_uid` | |
| `get_coaching_centre_assignments` | `p_uid` | |
| `get_coaching_centre_notes` | `p_uid` | |
| `get_coaching_centre_students` | `p_uid` | |
| `get_due_questions` | `p_uid, p_limit` | |
| `get_error_notebook` | `p_uid, p_subject, p_mastered, p_limit` | |
| `get_exam_attempt_mode` | `p_uid, p_test_id` | read-only counterpart of the two auth-bypass ones above |
| `get_flashcard_summary` | `p_uid` | |
| `get_notebook_stats` | `p_uid` | |
| `get_published_test_for_student` | `p_id, p_uid` | may expose test content/answers meant for someone else — check response shape before batching |
| `get_published_tests_for_student` | `p_uid` | |
| `get_recent_challenge_topics` | `p_uid, p_cutoff` | |
| `get_recent_doubt_chat` | `p_uid` | |
| `get_user_flashcards` | `p_uid, p_chapter_key` | |
| `get_user_misconceptions` | `p_uid, p_limit` | |
| `get_weak_topics` | `p_uid, p_limit` | |
| `is_active_admin` | `p_uid` | boolean probe |
| `student_get_own_centre` | `p_uid` | |
| `student_list_assigned_tests` | `p_uid` | |
| `student_list_centre_assignments` | `p_uid` | |
| `student_list_centre_tests` | `p_uid` | |
| `student_list_own_results` | `p_uid` | scores/grades |

### low-impact-but-still-open (19)

| RPC | Args | Note |
|---|---|---|
| `check_phone_registered` | `p_phone` | no identity param — pre-auth signup check; real issue (if any) is phone-number enumeration, a different bug class |
| `create_doubt_chat` | `p_uid, p_subject` | creates a chat as an arbitrary uid — spam/annoyance more than sensitive |
| `delete_chapter_flashcards` | `p_uid, p_chapter_key` | |
| `expire_subscriptions` | *(none)* | **no identity param at all** — this looks like a cron/maintenance job that shouldn't be `EXECUTE`-granted to `anon`/`authenticated` in the first place; the fix here is likely "revoke the grant entirely, restrict to a service role" rather than a caller check |
| `generate_invite_code` | *(none)* | no identity param; verify it's side-effect-free before assuming this is fine |
| `get_coaching_admin_invite_preview` | `p_code` | code-gated not uid-gated; real risk (if any) is invite-code brute-forcing/enumeration, a different bug class |
| `get_invite_preview` | `p_code` | same |
| `get_onboarding_options` | *(none)* | returns intentionally public data — not a bug, keep for completeness |
| `insert_flashcards` | `p_uid, p_cards` | |
| `mark_all_notifications_read` | `p_uid` | |
| `mark_notification_read` | `p_uid, p_notif_id` | |
| `record_review` | `p_uid, p_history_id, p_grade` | |
| `review_flashcard` | `p_uid, p_id, p_grade` | |
| `save_doubt_message` | `p_chat_id, p_role, p_content` | **no `p_uid` at all** — different bug class from the rest of this list: there's no chat-ownership check, so anyone who knows/guesses a `p_chat_id` (uuid) can post into it, including forging `p_role='assistant'` to inject fake AI answers. Worth its own look before batching, not a mechanical fix. |
| `update_weak_topics` | `p_uid, p_rows` | |
| `upsert_challenge_history` | `p_uid, p_subject, p_topic, p_date` | |
| `upsert_misconception` (2 overloads) | `p_user_id, ...` | audit-regex blind spot (see above); writes pollute another student's misconception-tracking data |
| `upsert_usage_quota` | `p_uid, p_date, p_field, p_amount` | could be used to grief another student's quota counters (zero them out or inflate them) |

### Remediation sequence

**Not all 68 can take the same naive `assert_verified_self(p_uid)` patch that worked for the first 8.**
The first 8 worked because in every case `p_uid` genuinely meant "the caller, acting for themselves."
That's not true for the coaching/admin-scoped RPCs above — `p_caller` there usually means "a coaching
admin, acting on a specific `centre_id` they're supposed to own," which needs a **second**, different
check (is `p_caller` actually an admin of *this* `centre_id`?) on top of identity verification, the same
shape `student_submit_centre_result` already had as an independent pre-existing check. Applying
`assert_verified_self` alone to those would prove *who* is calling but not *whether they're allowed to
touch that centre* — a half-fix that could still ship with the resource-authorization gap.

So there are three real fix shapes here, not one:

- **Pattern A — `assert_verified_self(p_uid)` alone is enough.** RPCs where the uid genuinely means
  "self." This is everything in the low-impact tier plus the read-only student-personal-data half of
  data-exposure (`get_due_questions`, `get_flashcard_summary`, `get_weak_topics`,
  `student_list_own_results`, etc.) — mechanical, same one-line insertion as the first 8. **Scriptable**:
  a migration could generate this insertion for all of them in one pass once each is confirmed to
  actually fit Pattern A.
- **Pattern B — needs `assert_verified_self` *plus* a resource-ownership check.** The coaching-centre-
  scoped and admin-scoped RPCs (most of auth-bypass-capable, the `coaching_*` half of data-exposure).
  Each needs tracing which table proves "`p_caller` administers this `centre_id`" (likely a
  `coaching_admins`-shaped table, same one `student_submit_centre_result`'s existing check already
  reads) — **not scriptable in bulk**, each needs the same kind of call-site/schema tracing
  `referral_grant_premium_days` needed, even though the boilerplate once the check is known can be
  templated.
- **Pattern C — structural exception, may need no self-check or a different check entirely.**
  `_coaching_admin_centre` needs tracing its actual callers before touching it (same shape as
  `referral_grant_premium_days` — could turn out to be internal-only and just need a grant revoke, not a
  body change). `save_doubt_message`, `expire_subscriptions`, `get_admin_record` (pending the
  passcode-hash question), and the two invite-preview RPCs each need individual review before they fit
  any pattern — flagged inline in the tables above.

**Proposed batches**, ordered by severity and roughly how much per-RPC tracing each needs (the 8-RPC fix
above took real evidence — rolled-back-transaction tests, re-exploit-via-HTTP, and a real-JWT proof — for
every RPC touched; that pace, not raw patch-writing speed, is what should set batch size):

1. **Batch 2 — invite/privilege-escalation surface (9 RPCs, Pattern B):** `create_coaching_admin_invite`,
   `revoke_coaching_admin_invite`, `list_coaching_admin_invites`, `create_centre_invite`,
   `get_centre_invites`, `deactivate_centre_invite`, `redeem_centre_invite`,
   `redeem_coaching_admin_invite`, `coaching_centre_update_branding`. Highest urgency — this is the only
   group that lets an attacker mint themselves *ongoing* coaching-admin access, not just touch one
   record.

   **Pre-work already done (2026-08-13) — read this before writing the migration; two findings correct
   the assumption above:**

   a. **These do NOT need a centre-ownership check added — 7 of the 9 already have one.**
      `create_coaching_admin_invite`, `list_coaching_admin_invites`, `revoke_coaching_admin_invite`,
      `coaching_centre_update_branding`, `create_centre_invite`, `deactivate_centre_invite`, and
      `get_centre_invites` all already query `admins`/`coaching_admins` correctly for the claimed
      caller. What they lack is only the *identity* half — an attacker passes a known real
      centre-admin's uid and sails through the existing check. So the fix is the same one-line
      `assert_verified_self()` insertion used for the first 8, **preserving each existing check**, not
      a new Pattern B check. (`redeem_centre_invite`/`redeem_coaching_admin_invite` are plain
      self-redemption — Pattern A on `p_uid`.)

   b. **3 of the 9 are already broken in production** — proven live, in a rolled-back probe:

      | RPC | sqlstate | error |
      |---|---|---|
      | `get_centre_invites` | `42703` | `column cc.created_by does not exist` |
      | `create_centre_invite` | `42703` | `column "created_by" does not exist` |
      | `deactivate_centre_invite` | `42703` | `column cc.created_by does not exist` |

      All three authorize against `coaching_centres.created_by`, **a column that does not exist on that
      table** (`centre_invites` has `created_by`; `coaching_centres` does not). They throw before
      reaching any logic, so they can be neither used nor exploited. `redeem_centre_invite` similarly
      references `coaching_students.student_uid` (real column: `firebase_uid`) — *suspected* broken,
      unproven, because the probe hit the invite-not-found early exit first.

      **This is a data-model gap, not just a bug: "who owns a coaching centre" is currently undefined
      in the schema.** Needs an owner decision before Batch 2 ships — either (a) add the identity check
      only and leave them broken, documenting it, or (b) resolve the ownership model and repair them
      too. Do not guess.
2. **Batch 3 — coaching-admin data & content management (13 RPCs, Pattern B):**
   `coaching_get_own_centre`, `coaching_list_centre_results`, `coaching_list_own_assignments`,
   `coaching_list_own_students`, `coaching_list_own_tests`, `coaching_delete_assignment`,
   `coaching_delete_test`, `coaching_upsert_assignment`, `coaching_upsert_test`,
   `get_coaching_admin_record`, `get_coaching_centre_assignments`, `get_coaching_centre_notes`,
   `get_coaching_centre_students`. Reuses the same centre-ownership check from batch 2.
3. **Batch 4 — account-sensitive singletons (6 RPCs, individual review each, no shared pattern):**
   `admin_verify_passcode`, `complete_referral`, `confirm_email_connect`, `set_email_enabled`,
   `get_admin_record`, `is_active_admin`, `_coaching_admin_centre`. Small batch on purpose — each one
   needs its own semantic read (is the uid really "self"? does the response leak a hash?) before any fix
   is written.
4. **Batch 5a/5b — student personal-data reads/writes (29 RPCs total, Pattern A, split into two ~15-RPC
   passes):** everything in data-exposure not already claimed by batch 2/3/4, plus
   `clear_exam_attempt_mode`/`lock_exam_attempt_mode`/`get_exam_attempt_mode`/`can_student_view_test`.
   Mechanical patch, but still one real e2e check per RPC that's actually wired into a live UI flow (most
   of the earlier 8 were; `student_submit_centre_result` had zero call sites and got the lighter check as
   a result — expect the same split here).
5. **Batch 6 — the rest of low-impact-but-still-open (remaining ~13 RPCs, Pattern A, mechanical):**
   flashcard/notification/quota/review RPCs.
6. **One-offs needing their own fix, not a batch:** `save_doubt_message` (chat-ownership check, not a
   caller-uid check), `expire_subscriptions` (revoke the anon/authenticated grant outright, don't add a
   caller check), `upsert_misconception` ×2 (Pattern A once the `p_user_id` naming is accounted for),
   `get_coaching_admin_invite_preview`/`get_invite_preview` (rate-limiting/enumeration concern, not this
   bug class).

**On batch size**: 6–13 RPCs per batch, matching what's above, not a fixed number — Pattern A batches can
run larger (13–15) since the fix is mechanical and the main cost is per-RPC verification; Pattern B
batches should stay smaller (6–9) since the ownership-check design itself needs verifying before it's
reused across RPCs, the same way `referral_grant_premium_days`'s exception had to be traced by hand
before this migration could ship.
