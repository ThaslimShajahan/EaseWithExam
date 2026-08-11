-- Site-wide payments kill switch.
--
-- Razorpay cannot complete a payment yet: the bank account is not active, and
-- `create-razorpay-order` — the first server call in the checkout flow — is in
-- source but NOT deployed, so it returns HTTP 404. Students clicking a paid
-- plan get "Could not start checkout. Please try again.", which reads as a
-- transient glitch and invites retries. This gates the UI instead.
--
-- Seeded DISABLED. The flag is `payments_enabled` (opt-in) rather than
-- `payments_disabled` on purpose: getFeatureFlag() resolves a missing row or an
-- unreachable table to FALSE, so with this polarity every failure mode leaves
-- payments OFF. The inverse name would re-open checkout on a transient DB blip.
--
-- TO RE-ENABLE ON 14 AUGUST:
--   Admin -> Platform -> Feature Flags -> turn ON "payments_enabled".
--   Or:  update public.feature_flags set enabled = true where key = 'payments_enabled';
--   No deploy and no code change needed either way.

insert into public.feature_flags (key, enabled, description)
values (
  'payments_enabled',
  false,
  'Master switch for Razorpay checkout. OFF hides every purchase CTA and shows "payments open 14 August" instead. Turn ON once the bank account is live AND create-razorpay-order is deployed.'
)
on conflict (key) do nothing;
