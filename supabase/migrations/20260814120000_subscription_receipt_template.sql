-- Item 7 (Razorpay receipt): a new DB-backed email template for the actual
-- payment receipt, distinct from subscription_active (the "welcome to
-- Premium" feature-unlock email, sent by the same razorpay-verify trigger
-- point but with a different job). Same additive pattern as the original
-- four rows in 20260807030000_email_templates.sql — INSERT ... ON CONFLICT
-- DO NOTHING, so re-running this migration is a no-op once seeded, and an
-- admin who has since edited the row is never overwritten by it.
INSERT INTO email_templates (
  template_key, label, description, subject, heading, body_text,
  bullet_points, button_label, button_path, footer_note
) VALUES (
  'subscription_receipt', 'Payment Receipt Email',
  'Sent right after a Razorpay payment is verified — the transaction receipt itself (subscription_active is the separate "plan activated" welcome email, sent alongside it).',
  'Your EaseWithExam receipt — {{planName}} ✅',
  'Payment received',
  'Thanks for your payment. Here''s your receipt for {{planName}}:',
  ARRAY[
    'Plan: {{planName}}',
    'Amount paid: {{amount}}',
    'Payment ID: {{paymentId}}',
    'Date: {{date}}'
  ],
  'Go to Dashboard', '/dashboard',
  'Keep this email as your payment record. Questions about this charge? Reply to this email.'
)
ON CONFLICT (template_key) DO NOTHING;

-- admin_reset_email_template's VALUES list is hand-enumerated (see
-- 20260807030000) — extend it with the new key so "Reset to default" works
-- for this template too. Same signature as the existing function, so this
-- CREATE OR REPLACE genuinely replaces it in place rather than creating a
-- second overload (the exact bug fixed for admin_set_quota_override earlier
-- tonight — verified here by matching parameter list exactly: p_caller text,
-- p_template_key text, unchanged).
CREATE OR REPLACE FUNCTION public.admin_reset_email_template(p_caller text, p_template_key text)
RETURNS email_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row email_templates;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admins WHERE uid = p_caller AND is_active = true) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE email_templates SET
    label = d.label, description = d.description, subject = d.subject, heading = d.heading,
    body_text = d.body_text, bullet_points = d.bullet_points, button_label = d.button_label,
    button_path = d.button_path, footer_note = d.footer_note,
    updated_at = now(), updated_by = p_caller
  FROM (VALUES
    ('welcome', 'Welcome Email', 'Sent once, right after a student completes onboarding.',
     'Welcome to EaseWithExam, {{name}}! 🎉', 'Hey {{name}}, you''re all set 👋',
     'Your account is ready and set up for {{exam}}. Here''s what''s unlocked on your free plan right now:',
     ARRAY['20 AI practice questions every day','2 full question papers per day','2 full mock tests per week','EWE — your AI study tutor (15 messages/day)','Daily challenge + basic analytics'],
     'Start Practicing', '/practice/generate', 'Good luck with {{exam}} — we''re rooting for you.'),
    ('paper_ready', 'Paper Ready Email', 'Sent when a background-generated paper finishes.',
     'Your paper is ready 📝', 'Your paper is ready!',
     '{{examType}} · {{subject}} — {{count}} questions, generated and waiting for you in Exam Center.',
     '{}', 'Start the Paper', '/exams?tab=papers', ''),
    ('subscription_active', 'Subscription Activated Email', 'Sent right after a Razorpay payment is verified and a paid plan activates.',
     '{{planName}} is active — welcome aboard! 🎉', '{{planName}} activated',
     'Thanks for upgrading. Your full toolkit is open, with limits set high enough that you should not meet them: 350 AI practice questions a day, 250 EWE messages a day, unlimited mock tests, the Misconception Engine, and adaptive flashcards.',
     '{}', 'Go to Dashboard', '/dashboard', ''),
    ('subscription_receipt', 'Payment Receipt Email',
     'Sent right after a Razorpay payment is verified — the transaction receipt itself (subscription_active is the separate "plan activated" welcome email, sent alongside it).',
     'Your EaseWithExam receipt — {{planName}} ✅', 'Payment received',
     'Thanks for your payment. Here''s your receipt for {{planName}}:',
     ARRAY['Plan: {{planName}}','Amount paid: {{amount}}','Payment ID: {{paymentId}}','Date: {{date}}'],
     'Go to Dashboard', '/dashboard', 'Keep this email as your payment record. Questions about this charge? Reply to this email.'),
    ('verify_email', 'Connect-Email Verification Code', 'Sent when a phone-signup student adds an email for notifications (Notifications settings → Connect email).',
     'Your EaseWithExam verification code', 'Confirm your email',
     'Enter this code in EaseWithExam to start receiving email notifications at this address.',
     '{}', '', '', 'This code expires in 30 minutes. Didn''t request this? You can ignore this email.')
  ) AS d(template_key, label, description, subject, heading, body_text, bullet_points, button_label, button_path, footer_note)
  WHERE email_templates.template_key = d.template_key AND d.template_key = p_template_key
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Unknown template_key: %', p_template_key;
  END IF;

  RETURN v_row;
END;
$function$;

-- Self-verifying: confirm exactly one admin_reset_email_template signature
-- exists after this replace (same overload-safety discipline as every other
-- CREATE OR REPLACE tonight).
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
  FROM pg_proc
  WHERE proname = 'admin_reset_email_template' AND pronamespace = 'public'::regnamespace;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 admin_reset_email_template signature, found %', v_count;
  END IF;
END $$;
