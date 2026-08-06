# WhatsApp Invite/Notification Delivery — Prep Notes

Status as of 2026-08-06. Documentation only — nothing implemented or live-tested in this pass.

## Current state

- **Provider: Twilio** (WhatsApp API), not the raw Meta WhatsApp Business API. `supabase/functions/whatsapp-alert/index.ts` sends via `https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json`.
- **Deployed and secrets configured** — confirmed live via `supabase functions list` / `supabase secrets list`:
  - `whatsapp-alert` function: deployed, ACTIVE.
  - Secrets set: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` (all present, last updated 2026-07-15).
- **Two modes** the function supports:
  1. Single send — `{ to, message }`.
  2. Broadcast — `{ broadcast: true, message, caller_uid }` — fetches every user with `notification_prefs.whatsapp_enabled = true`, sends in batches of 5 with a 200ms gap (Twilio rate-limit friendly). Requires `caller_uid` to resolve to an active row in `admins` — enforced server-side, not optional.
- **Student opt-in UI exists**: `NotificationSettings.jsx` lets a student enter their WhatsApp number, writing `whatsapp_number` + `whatsapp_enabled` to `notification_prefs`.
- **Admin trigger UI exists**: `AdminPushNotifications.jsx` has a WhatsApp channel toggle alongside in-app/push.
- **Consumers beyond admin broadcast**: `CoachingTestBuilder.jsx`/`CoachingStudentsPage.jsx` and `ChatInterface.jsx` reference WhatsApp in some form (found via grep) — worth a quick read-through before go-live to confirm what they actually send and when.

## What "invite delivery" specifically means here

The coaching-admin invite flow (`coachingAdminInviteUrl`, `createCoachingAdminInvite` in `AdminCoaching.jsx`) currently shares invite links via a `wa.me` deep link (`window.open('https://wa.me/?text=...')`) — that's the *user's own WhatsApp client* composing a message, not the Twilio API. That path needs no secrets and is already "live" in the sense that it just opens WhatsApp with a pre-filled message. The Twilio-backed `whatsapp-alert` function is a separate, second delivery mechanism (automated sends, not user-composed).

## What needs testing/verification before trusting this in production

1. **Twilio sandbox vs. production number** — `TWILIO_WHATSAPP_FROM` needs confirming: is it still the Twilio sandbox number (`whatsapp:+14155238886`, the default fallback baked into the function) or a real approved WhatsApp Business sender? Sandbox numbers only deliver to phone numbers that have explicitly joined the sandbox (by sending a join code) — real students won't have done that, so sandbox mode would silently fail for anyone but the developer's own test number.
2. **Message template approval** — WhatsApp Business (via Twilio) requires pre-approved templates for any message sent outside a 24-hour customer-service window. The weekly-report template hardcoded in the function (`📊 EaseWithExam Weekly Report...`) has not been confirmed as an approved template — if it isn't, sends outside the 24h window will be rejected by WhatsApp/Twilio regardless of Twilio credentials being valid.
3. **Number format validation** — the function does no validation on `whatsapp_number`/`to` beyond a truthy check; a malformed number would just fail per-recipient in the batch (caught, doesn't break the broadcast) but is worth a quick sanity check on the opt-in form.
4. **Broadcast admin-auth path** — confirm the `admins` table check inside the function still works post the RLS lockdown from this session's Part A (should be unaffected — the function uses the service-role key via `createClient`, which bypasses RLS entirely, but worth a smoke test).
5. **Rate limits / cost** — Twilio bills per message; no volume cap currently exists in the broadcast path (see Part B4 rate-limiting findings).

## Open questions for Thaslim

- Is the Twilio account currently in **sandbox mode** or has a real WhatsApp Business sender been approved? (Determines whether any of this reaches real students today.)
- Are the weekly-report and any other message templates **pre-approved** with WhatsApp, or does every send rely on the 24-hour session window (i.e., only works right after a student messages first)?
- Who owns the Twilio account/billing, and what's the expected message volume (affects cost planning)?
- Should the coaching-invite `wa.me` deep-link flow and the Twilio-automated broadcast flow be unified, or are they intentionally two separate mechanisms for two different use cases (manual one-off share vs. automated bulk notify)?
