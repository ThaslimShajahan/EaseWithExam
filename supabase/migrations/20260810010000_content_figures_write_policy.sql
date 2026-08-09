-- content_figures had RLS enabled with a SELECT policy and nothing else, so
-- every INSERT was denied — including the one the Content Intake screen makes
-- right after uploading a cropped figure. Caught by the Pilot B run, which
-- extracted two figures and then failed to record either of them.
--
-- Writes are restricted to a verified admin rather than opened to everyone:
-- knowledge_base itself is wide open (`knowledge_base_open`, ALL/true), but
-- that is a pre-existing weakness to be narrowed later, not a pattern worth
-- copying into a brand-new table.

BEGIN;

-- verified_uid() reads the Firebase JWT `sub` claim, so this is the caller's
-- proven identity, not a client-supplied uid.
CREATE OR REPLACE FUNCTION public.is_verified_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM admins a
    WHERE a.uid = verified_uid()
      AND a.is_active = true
      AND a.role IN ('superadmin', 'admin')
  );
$$;

DROP POLICY IF EXISTS content_figures_admin_write ON public.content_figures;
CREATE POLICY content_figures_admin_write ON public.content_figures
  FOR INSERT WITH CHECK (is_verified_admin());

DROP POLICY IF EXISTS content_figures_admin_update ON public.content_figures;
CREATE POLICY content_figures_admin_update ON public.content_figures
  FOR UPDATE USING (is_verified_admin()) WITH CHECK (is_verified_admin());

DROP POLICY IF EXISTS content_figures_admin_delete ON public.content_figures;
CREATE POLICY content_figures_admin_delete ON public.content_figures
  FOR DELETE USING (is_verified_admin());

COMMIT;
