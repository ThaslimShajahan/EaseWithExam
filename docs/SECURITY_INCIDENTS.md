# Security Incidents

One entry per finding. Status is either **OPEN** (found, not yet fixed) or **FIXED** (with the fixing
commit). Do not assume anything here is resolved without checking the live RPC definitions or git log —
a stale "FIXED" is worse than an honest "OPEN".

---

## 2026-08-13 — `upsert_own_user`/`update_own_user`: anon can overwrite any student's profile

**Status: OPEN.** Found, confirmed, logged. Not yet fixed. Owner decision was to log and defer, not
ignore — see below.

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

### The fix, when it happens

Bind both RPCs to `verified_uid()` (`where p_uid = verified_uid()` or equivalent), matching the pattern
every admin RPC in this project already uses via `assert_verified_admin`. **Needs care**: this touches
the live onboarding/profile-save path every student uses — verify against a real signup/onboarding flow
end-to-end before shipping, not just a unit test, the same way the stream-selection UI's board-key bug
was only caught by an actual click-through run and not by code review alone.

A prior, related task brief for this fix (not yet executed) also asked for:
1. Grep every other `SECURITY DEFINER` RPC granted to `anon`/`authenticated` for the same
   missing-caller-check pattern, and list them all here even if not fixed immediately — the full
   exposure surface, not just these two.
2. If no `verified_uid()`-equivalent binding pattern turns out to exist consistently across the
   codebase, that's a bigger structural gap than these two RPCs — report that finding on its own before
   attempting a fix.
3. Re-attempt the exact exploit above after the fix ships and confirm it now fails with a permission
   error, plus confirm a real logged-in student's own onboarding save still works end-to-end.
