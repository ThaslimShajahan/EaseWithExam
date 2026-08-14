-- admin_upsert_email_template could not insert, so an empty email_templates
-- table had no recovery path through the admin UI at all.
--
-- WHAT WAS WRONG
-- Despite the name, the function only ran an UPDATE and then raised
-- 'Unknown template_key' when it matched nothing. admin_reset_email_template
-- has the same shape. So with the table empty — which is exactly where the
-- 2026-08-13 wipe left it, after 20260807030000 had seeded all four rows — both
-- the Save and the Reset buttons in Admin > Platform > Email were silent no-ops.
-- The screen showed nothing and offered no way to fix that.
--
-- Emails were never broken: send-email and connect-email both fall back to
-- FALLBACK_TEMPLATES in _shared/emailLayout.ts, which covers all four DB-backed
-- keys. So this was a lost ADMIN capability, not a delivery failure.
--
-- THE FIX
-- Make the function do what its name says: INSERT ... ON CONFLICT (template_key)
-- DO UPDATE. Signature, return type, auth checks and grants are unchanged, so
-- every existing caller behaves identically for the rows that already exist.
--
-- The 'Unknown template_key' guard is deliberately NOT kept. It existed to catch
-- a typo'd key, but it is also what made recovery impossible, and it guards the
-- wrong thing: which keys are meaningful is decided by DB_BACKED_TEMPLATES in
-- the edge function, not by which rows happen to exist. A row for an unused key
-- is inert; a table that cannot be repopulated is not.

create or replace function public.admin_upsert_email_template(
  p_caller text, p_template_key text, p_label text, p_description text,
  p_subject text, p_heading text, p_body_text text, p_bullet_points text[],
  p_button_label text, p_button_path text, p_footer_note text
) returns email_templates
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row email_templates;
begin
  perform assert_verified_admin(p_caller);  -- P0.5
  if not exists (select 1 from admins where uid = p_caller and is_active = true) then
    raise exception 'Unauthorized';
  end if;

  if p_template_key is null or btrim(p_template_key) = '' then
    raise exception 'template_key is required' using errcode = '22023';
  end if;

  insert into email_templates (
    template_key, label, description, subject, heading, body_text,
    bullet_points, button_label, button_path, footer_note, updated_at, updated_by)
  values (
    p_template_key, p_label, p_description, p_subject, p_heading, p_body_text,
    coalesce(p_bullet_points, '{}'), p_button_label, p_button_path, p_footer_note,
    now(), p_caller)
  on conflict (template_key) do update set
    label         = excluded.label,
    description   = excluded.description,
    subject       = excluded.subject,
    heading       = excluded.heading,
    body_text     = excluded.body_text,
    bullet_points = excluded.bullet_points,
    button_label  = excluded.button_label,
    button_path   = excluded.button_path,
    footer_note   = excluded.footer_note,
    updated_at    = now(),
    updated_by    = p_caller
  returning * into v_row;

  return v_row;
end;
$function$;

-- anon is included deliberately: Firebase JWTs carry no `role` claim so every
-- PostgREST request runs as anon; the real gate is assert_verified_admin in the
-- body. See 20260813080000 for the empirical proof behind that rule.
grant execute on function public.admin_upsert_email_template(
  text, text, text, text, text, text, text, text[], text, text, text
) to anon, authenticated;
