-- ═══════════════════════════════════════════════════════════════════
-- Migration 0050 — Loosen free-tier limits (0048 went too far)
--
-- Migration 0048 tightened free-tier limits to match the marketing copy
-- (10/day AI questions, 1/week mock test, 5/day EWE messages). After
-- actually experiencing it, the limits felt like walls rather than a taste
-- of the product — 5 EWE messages barely covers one doubt-clearing
-- exchange, 10 AI questions is under one practice round, and 1 mock test/
-- week was the sharpest cut. Raising to numbers that still sit well below
-- Premium's unlimited tier but feel like real usable value:
--   ai_questions:  10 → 20/day
--   veda_messages:  5 → 15/day
--   mock_tests:     1 → 2/week (still weekly, see WEEKLY_FIELDS in lib/quota.js)
-- paper_evaluations and podcasts are untouched (3/day) — not part of this
-- complaint.
-- ═══════════════════════════════════════════════════════════════════

UPDATE quota_config
SET ai_questions  = 20,
    veda_messages = 15,
    mock_tests    = 2
WHERE plan_id = 'free';
