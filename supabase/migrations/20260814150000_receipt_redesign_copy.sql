-- Receipt redesign (approved 2026-08-14, see chat) changed what heading and
-- body_text MEAN for this one template (renderReceiptEmail in emailLayout.ts):
-- heading is now the status-pill text next to a ✓, body_text is now the line
-- below the transaction table, not the line above it. Update the live row to
-- match the new default copy — an admin who never touched this row should see
-- the new design's intended copy, not the old checklist-style wording sitting
-- inside the new layout.
UPDATE email_templates
SET body_text = 'Your {{planName}} plan is active — the full toolkit is unlocked.',
    updated_at = now()
WHERE template_key = 'subscription_receipt'
  AND body_text = 'Thanks for your payment. Here''s your receipt for {{planName}}:';
-- Scoped to the exact old default text on purpose — if an admin has already
-- edited this row to something else, their edit is left alone. heading
-- ('Payment received') didn't change in meaning enough to need a matching
-- guard: it already reads correctly as pill text with no edit needed.
