-- ═══════════════════════════════════════════════════════════════════
-- Migration 0048 — Tighten free-tier limits to match marketing copy
--
-- The Pricing page/paywall copy (src/lib/subscription.js PLANS.free) has
-- always advertised "10 AI questions/day, 1 mock test/week, 5 EWE messages/
-- day" — but the enforced quota_config values were 15/3(daily)/20, quietly
-- giving free users more than promised. Business call: tighten enforcement
-- to match the copy rather than loosen the copy to match enforcement — a
-- free tier that generous cannibalizes the paid tier and doesn't reflect
-- real API cost control.
--
-- mock_tests also changes from a daily to a weekly cadence here — see
-- WEEKLY_FIELDS in src/lib/quota.js, which sums usage across the current
-- ISO week instead of a single day for this one field. paper_evaluations
-- and podcasts are untouched — marketing copy doesn't mention either for
-- the free tier, so there's nothing to reconcile there.
-- ═══════════════════════════════════════════════════════════════════

UPDATE quota_config
SET ai_questions  = 10,
    veda_messages = 5,
    mock_tests    = 1
WHERE plan_id = 'free';
