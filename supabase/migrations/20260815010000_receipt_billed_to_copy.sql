-- Real bug found 2026-08-15 confirming the real ₹1 test payment's receipt:
-- it carried no name or email identifying who the payment belonged to.
-- user.email/display_name were already available at send time (send-email
-- reads them for every template) — the receipt template just never asked
-- for them. billedTo is composed server-side as "Name (email)", or just the
-- email if the student never set a display name. Scoped to the exact
-- current bullet array so an admin's own edit is left alone, same rule as
-- the two prior receipt-copy migrations (20260814150000, 20260814180000).
UPDATE email_templates
SET bullet_points = ARRAY[
      'Billed to: {{billedTo}}',
      'Plan: {{planName}}',
      'Amount: {{baseAmount}}',
      'GST ({{gstRatePercent}}%): {{gstAmount}}',
      'Total: {{totalAmount}}',
      'Payment ID: {{paymentId}}',
      'Date: {{date}}'
    ],
    updated_at = now()
WHERE template_key = 'subscription_receipt'
  AND bullet_points = ARRAY[
      'Plan: {{planName}}',
      'Amount: {{baseAmount}}',
      'GST ({{gstRatePercent}}%): {{gstAmount}}',
      'Total: {{totalAmount}}',
      'Payment ID: {{paymentId}}',
      'Date: {{date}}'
    ];
