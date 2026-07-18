# Action Items — Only You Can Do These

Everything below is blocked on your credentials, your accounts, or a judgment call only you can make. I can't proceed on the related work until these are done. Everything else is being handled in code.

---

## 1. Rotate the OpenAI key — do this first, today

The key that's been in `.env` (`VITE_OPENAI_API_KEY`) shipped in production JS bundles for a while before this session's fix. Even though the code no longer uses it, that old key was already public. Also: the `OPENAI_API_KEY` secret currently stored server-side (set 2026-06-28) is itself already invalid/expired (confirmed by testing `ai-proxy` directly — OpenAI rejects it), so you need a fresh one regardless.

1. Go to platform.openai.com → API keys → revoke the old key (the one in `.env`, starts `sk-proj-uxP_e...`).
2. Generate a new key.
3. Set it yourself (don't paste the value to me): `supabase secrets set OPENAI_API_KEY=<new-key>`
4. Tell me once it's done and I'll test `ai-proxy` end-to-end to confirm AI features work again.

## 2. Set Razorpay secrets so I can deploy the payment fix

The new order-verification flow (`create-razorpay-order` + `razorpay-verify`) is written and ready, but neither function is deployed yet — they need real Razorpay credentials first, which I don't have and shouldn't handle even if you gave them to me (same reasoning as the OpenAI key — set secrets yourself, don't paste them in chat).

```
supabase secrets set RAZORPAY_KEY_ID=rzp_test_or_live_... RAZORPAY_KEY_SECRET=your_secret
supabase secrets set ACTIVATE_CALLER_SECRET=<any-long-random-string-you-generate>
```

Note: your client-side `VITE_RAZORPAY_KEY_ID` is currently `rzp_test_...` — you're in Razorpay **test mode**, not live charging real money. That makes this less urgent than I originally implied, but still worth closing before you ever flip to live keys.

Once these are set, tell me and I'll deploy both functions and verify a test payment end-to-end.

## 3. Paste these function definitions so I can write precise SQL fixes

I can't read your live database schema directly (this environment doesn't have Docker, which the Supabase CLI needs for `db pull`/`dump`/`diff`). To fix the RPCs that are missing caller-authorization checks (letting anyone read subscription data, your VAPID private key, or write study notes) and the two broken quota functions, I need their exact current source so I don't accidentally break something that already works.

Run each of these in the Supabase SQL Editor and paste me the results, whenever convenient:

```sql
select pg_get_functiondef('admin_list_subscriptions'::regproc);
select pg_get_functiondef('admin_get_platform_settings'::regproc);
select pg_get_functiondef('admin_upsert_study_note'::regproc);
select pg_get_functiondef('admin_delete_study_note'::regproc);
select pg_get_functiondef('coaching_admin_set_passcode'::regproc);
select pg_get_functiondef('activate_subscription'::regproc);
select pg_get_functiondef('check_and_increment_quota'::regproc);
select pg_get_functiondef('upsert_usage_quota'::regproc);
```

(`check_and_increment_quota` has two overloaded versions in your DB right now, which is itself the bug — if the query above only returns one, let me know and we'll track down the second via `select proname, pg_get_functiondef(oid) from pg_proc where proname = 'check_and_increment_quota';`.)

## 4. Legacy syllabus data cleanup (already discussed, no action needed unless you want it)

You already chose to re-enter JEE Advanced / Kerala State content manually via Admin > Syllabus rather than have me auto-migrate the old inconsistent rows (`JEE_ADVANCED`, `Kerala_State` underscore-keyed data). No action needed from you unless you want to revisit that decision.

## 5. GitHub remote (optional, only if you want CI actually running)

I initialized git locally and added a CI workflow file, but there's no GitHub remote yet, so nothing runs. If you want CI live:
1. Create a GitHub repo (empty, no README/license).
2. Tell me the URL and I'll add it as a remote and push (I won't do this without you telling me to, since pushing creates a permanent public/private history).
3. Add these secrets in GitHub repo Settings → Secrets and variables → Actions, matching what's in your `.env`: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`, `VITE_RAZORPAY_KEY_ID`.

## 6. The big one: Firebase-JWT → Supabase Auth migration

This is the structural fix that would eliminate the whole "someone forgot to check the caller" bug class permanently, instead of patching each instance individually (see the architecture review, `docs/PRODUCT_ARCHITECTURE_REVIEW_2026-07-15.md`, §"the one structural issue"). It's a real project, not a quick fix, and touches how every RPC/RLS policy in the app authorizes requests. I haven't started this — it deserves its own planning conversation given the risk of breaking auth app-wide if rushed. Let me know when you want to scope it out properly.

---

*I'll keep working through everything else that doesn't need your input in the meantime.*
