# Razorpay Payment Flow — Prep Notes

Status as of 2026-08-06. Documentation only — nothing implemented or live-tested in this pass.

## ⚠ Live gap found while documenting (flagging, not fixing — Part C is docs-only, no config changes)

`razorpay-webhook` **is deployed and ACTIVE in production right now** — confirmed via `supabase functions list`. Its signature check:

```ts
function verifySignature(body: string, signature: string): boolean {
  if (!WEBHOOK_SECRET) return true; // skip in dev
  ...
}
```

`RAZORPAY_WEBHOOK_SECRET` is **not set** (confirmed via `supabase secrets list`), so `WEBHOOK_SECRET` is empty and this function returns `true` for every request, unconditionally, no signature check performed at all. The comment says "skip in dev," but this function is deployed to the same production project as everything else in this app — there's no separate dev/prod split, so this is live, not dev-only.

Practical impact: anyone who finds/guesses `https://efrhurxnlkthlkqeyiva.supabase.co/functions/v1/razorpay-webhook` can POST a fabricated `payment.captured` event body with any `firebase_uid`/`plan_id` in `notes`, and `activateSubscription()` will grant that account premium — free, no real payment, no valid signature required. This is a genuine, exploitable, currently-live gap, not a "not launched yet" item like the rest of this doc.

**Recommended immediate fix** (not done here per Part C's docs-only scope): set `RAZORPAY_WEBHOOK_SECRET` via `supabase secrets set`, using the webhook signing secret from the Razorpay Dashboard's Webhooks section (generated when a webhook endpoint is registered there). Until a webhook is actually registered in the Razorpay dashboard pointing at this URL, there's no legitimate traffic hitting this endpoint anyway — but the fallback should still be removed or changed to fail closed (reject when the secret is unset) rather than fail open, so a future misconfiguration can't silently reopen this.

## Current state

**The client-side checkout flow is fully wired and calls real endpoints — but two of the three required edge functions are not deployed, so checkout is broken end-to-end right now.**

Confirmed live via `supabase functions list`:

| Function | Purpose | Deployed? |
|---|---|---|
| `create-razorpay-order` | Server resolves the charge amount from `plan_config`/hardcoded catalogue, creates a real Razorpay Order, returns `order_id` | **NOT deployed** |
| `razorpay-verify` | Verifies the HMAC-SHA256 payment signature server-side, then calls `activate_subscription` RPC | **NOT deployed** |
| `razorpay-webhook` | Handles async Razorpay webhook events (`payment.captured`, `subscription.activated`, `subscription.cancelled`) — writes directly to `subscriptions` via service-role key, independent of the `razorpay-verify` path | Deployed, ACTIVE — **but see the live gap flagged above** |

Secrets: `supabase secrets list` shows **no `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, or `ACTIVATE_CALLER_SECRET` set at all.** Even deploying the two missing functions wouldn't make them work — `create-razorpay-order` explicitly checks for `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` on every request and returns a 500 immediately if either is missing.

### What the code actually does (already correct, matches security best practice)

`src/lib/subscription.js`'s checkout flow:
1. Client calls `create-razorpay-order` with `{ plan_id, firebase_uid }` — server resolves the real amount (admin-configured `plan_config` price takes priority over the hardcoded `PLAN_AMOUNTS_PAISE` catalogue), creates the Razorpay Order, returns `order_id` + `amount`. The client **never sends its own amount** — this closes the exact gap flagged in the 2026-07-15 audit (client self-reporting the charge amount).
2. Client opens Razorpay Checkout (`window.Razorpay`) with that server-issued `order_id`.
3. On payment success, client calls `razorpay-verify` with the Razorpay response fields — server verifies the HMAC signature against `RAZORPAY_KEY_SECRET`, and only on a valid signature calls `activate_subscription` (a SECURITY DEFINER RPC, gated by `ACTIVATE_CALLER_SECRET`) to actually unlock the plan.
4. The client **never writes to `subscriptions` directly** — this is the real fix from the original "no server-side payment verification" finding.

So the design is sound and matches how this should be done. It's just not deployable yet — no secrets, two of three functions missing from production.

### Test mode marker

`.env`'s `VITE_RAZORPAY_KEY_ID=rzp_test_...` — this is a **test-mode** key ID, consistent with nothing having gone live yet. The matching `RAZORPAY_KEY_SECRET` (test or live) has never been set as a Supabase secret.

## What needs testing/verification before going live

1. **Deploy the two missing functions** (`create-razorpay-order`, `razorpay-verify`) and set the three missing secrets — nothing else works until this happens.
2. **Full test-mode checkout run**: pick a plan → confirm the created order amount matches `plan_config`/catalogue exactly → complete a Razorpay *test* payment → confirm `razorpay-verify`'s signature check passes → confirm `activate_subscription` actually flips the student's `subscriptions` row (plan, status, expires_at) → confirm the UI reflects the new plan without a manual refresh.
3. **Signature-mismatch path**: deliberately send a tampered/wrong signature to `razorpay-verify` and confirm it's rejected with 401, not silently accepted.
4. **`razorpay-webhook` has two things to resolve before go-live**: (a) the open signature-verification gap flagged above — must be closed before this can be trusted with real traffic, and (b) it activates subscriptions via a direct `subscriptions` table upsert, a second independent path from `razorpay-verify`'s `activate_subscription` RPC — worth confirming both paths agree on behavior (e.g. XP-award-on-upgrade only happens in the webhook path, not in `razorpay-verify` — is that intentional?) so a payment doesn't end up double-processed or under-processed depending on which path fires first.
5. **Live-mode checklist** (once test mode is fully verified): swap `rzp_test_...` → `rzp_live_...` key ID in `.env`, swap the matching live `RAZORPAY_KEY_SECRET` in Supabase secrets, re-verify the whole flow again in live mode with a real small-value transaction, confirm Razorpay dashboard webhook URL points at the deployed `razorpay-webhook` endpoint, confirm KYC/business verification is complete on the Razorpay account (required before live mode processes real charges).
6. **Failure/retry UX** — confirm what a student sees if `create-razorpay-order` fails (network error, invalid plan), if they close the Razorpay Checkout modal without paying, and if `razorpay-verify` fails after a real successful charge (money taken, subscription not activated — needs a clear recovery path, not just a dead-end error).

## Open questions for Thaslim

- Is there an existing Razorpay account, and is it in **test mode only** or has **KYC/live-mode approval** been completed?
- Where should `RAZORPAY_KEY_SECRET` and `ACTIVATE_CALLER_SECRET` come from — do you have the live/test secret key handy, or does `ACTIVATE_CALLER_SECRET` need to be freshly generated (it's an internal shared secret between `razorpay-verify` and `activate_subscription`, not a Razorpay-issued value)?
- Has a webhook URL been registered in the Razorpay dashboard pointing at `razorpay-webhook`'s deployed endpoint, and does Razorpay's webhook signing secret need to be set separately from the checkout-flow `RAZORPAY_KEY_SECRET`?
- Target go-live date — affects whether this should stay test-mode-verified-only for now or push toward live-mode this cycle.
