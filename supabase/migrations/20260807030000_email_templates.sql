-- Admin-configurable email templates — subject/heading/body/bullets/button
-- for each system email, editable without a code deploy. Seeded with the
-- exact copy already hardcoded in supabase/functions/send-email and
-- connect-email so nothing changes visually until an admin actually edits
-- something. The edge functions fall back to their own hardcoded defaults
-- if a row is ever missing (deleted, or the table itself unreachable) —
-- editing this table is additive, not a hard dependency for email to work.
CREATE TABLE IF NOT EXISTS email_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key  text UNIQUE NOT NULL,
  label         text NOT NULL,
  description   text NOT NULL DEFAULT '',
  subject       text NOT NULL,
  heading       text NOT NULL,
  body_text     text NOT NULL,
  bullet_points text[] NOT NULL DEFAULT '{}',
  button_label  text NOT NULL DEFAULT '',
  button_path   text NOT NULL DEFAULT '',
  footer_note   text NOT NULL DEFAULT '',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text
);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
-- No direct policies (service-role and SECURITY DEFINER RPCs only) — same
-- lockdown as in_app_notifications / admins.

INSERT INTO email_templates (template_key, label, description, subject, heading, body_text, bullet_points, button_label, button_path, footer_note) VALUES
(
  'welcome', 'Welcome Email', 'Sent once, right after a student completes onboarding.',
  'Welcome to EaseWithExam, {{name}}! 🎉',
  'Hey {{name}}, you''re all set 👋',
  'Your account is ready and set up for {{exam}}. Here''s what''s unlocked on your free plan right now:',
  ARRAY[
    '20 AI practice questions every day',
    '2 full question papers per day',
    '2 full mock tests per week',
    'EWE — your AI study tutor (15 messages/day)',
    'Daily challenge + basic analytics'
  ],
  'Start Practicing', '/practice/generate',
  'Good luck with {{exam}} — we''re rooting for you.'
),
(
  'paper_ready', 'Paper Ready Email', 'Sent when a background-generated paper finishes.',
  'Your paper is ready 📝',
  'Your paper is ready!',
  '{{examType}} · {{subject}} — {{count}} questions, generated and waiting for you in Exam Center.',
  '{}', 'Start the Paper', '/exams?tab=papers', ''
),
(
  'subscription_active', 'Subscription Activated Email', 'Sent right after a Razorpay payment is verified and a paid plan activates.',
  '{{planName}} is active — welcome aboard! 🎉',
  '{{planName}} activated',
  'Thanks for upgrading. Every AI limit is lifted — unlimited practice questions, unlimited EWE tutoring, the Misconception Engine, and full mock-test access are unlocked on your account right now.',
  '{}', 'Go to Dashboard', '/dashboard', ''
),
(
  'verify_email', 'Connect-Email Verification Code', 'Sent when a phone-signup student adds an email for notifications (Notifications settings → Connect email).',
  'Your EaseWithExam verification code',
  'Confirm your email',
  'Enter this code in EaseWithExam to start receiving email notifications at this address.',
  '{}', '', '', 'This code expires in 30 minutes. Didn''t request this? You can ignore this email.'
)
ON CONFLICT (template_key) DO NOTHING;

CREATE OR REPLACE FUNCTION admin_list_email_templates(p_caller text)
RETURNS SETOF email_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admins WHERE uid = p_caller AND is_active = true) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY SELECT * FROM email_templates ORDER BY template_key;
END;
$$;

CREATE OR REPLACE FUNCTION admin_upsert_email_template(
  p_caller       text,
  p_template_key text,
  p_label        text,
  p_description  text,
  p_subject      text,
  p_heading      text,
  p_body_text    text,
  p_bullet_points text[],
  p_button_label text,
  p_button_path  text,
  p_footer_note  text
)
RETURNS email_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row email_templates;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admins WHERE uid = p_caller AND is_active = true) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE email_templates SET
    label = p_label, description = p_description, subject = p_subject, heading = p_heading,
    body_text = p_body_text, bullet_points = p_bullet_points, button_label = p_button_label,
    button_path = p_button_path, footer_note = p_footer_note,
    updated_at = now(), updated_by = p_caller
  WHERE template_key = p_template_key
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Unknown template_key: %', p_template_key;
  END IF;

  RETURN v_row;
END;
$$;

-- Resets a template back to its seeded default by simply re-running that
-- template's INSERT values — safer than deleting the row (deleting would
-- also work via the edge function's fallback, but this keeps the row
-- present and consistent with "reset to default" rather than "remove
-- configuration", which reads more predictably in the admin UI).
CREATE OR REPLACE FUNCTION admin_reset_email_template(p_caller text, p_template_key text)
RETURNS email_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
     'Thanks for upgrading. Every AI limit is lifted — unlimited practice questions, unlimited EWE tutoring, the Misconception Engine, and full mock-test access are unlocked on your account right now.',
     '{}', 'Go to Dashboard', '/dashboard', ''),
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
$$;

GRANT EXECUTE ON FUNCTION admin_list_email_templates(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_upsert_email_template(text, text, text, text, text, text, text, text[], text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_reset_email_template(text, text) TO anon, authenticated;
