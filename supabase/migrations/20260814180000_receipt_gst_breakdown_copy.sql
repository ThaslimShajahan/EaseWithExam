-- GST is now exclusive/on-top of the listed price (owner-confirmed with
-- their CA, 2026-08-14). The receipt's bullet_points changes from a single
-- "Amount paid: {{amount}}" line to the Amount/GST/Total breakdown
-- renderReceiptEmail + razorpay-verify now actually supply. Scoped to the
-- exact old bullet array so an admin's own edit is left alone, same rule as
-- the 20260814150000 copy update.
UPDATE email_templates
SET bullet_points = ARRAY[
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
      'Amount paid: {{amount}}',
      'Payment ID: {{paymentId}}',
      'Date: {{date}}'
    ];
