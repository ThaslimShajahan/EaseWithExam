-- Creates the `platform-assets` storage bucket.
--
-- Three upload paths have been writing to this bucket since the branding/avatar
-- feature shipped — AdminPlatformSettings (EWE avatar + platform logo) and
-- CoachingSettingsPage (centre logo) — but the bucket was never created, so
-- every one of them failed with "Bucket not found". Nothing in the app code is
-- wrong; the infrastructure was simply missing.

BEGIN;

-- Public read: the avatar and logo are rendered for every student, including
-- signed-out visitors on the landing page.
-- 2 MB matches the client-side guard in both upload handlers, so the limit is
-- enforced on the server too rather than trusted from the browser.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('platform-assets', 'platform-assets', true, 2097152,
        ARRAY['image/png','image/jpeg','image/webp','image/gif','image/svg+xml'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Reads are open (that is what `public` means for a bucket), writes are not.
-- The pre-existing buckets grant ALL to anon, which lets anyone holding the
-- public anon key upload arbitrary files. Not worth repeating on a new bucket:
-- these uploads only ever originate from the admin portal.
DROP POLICY IF EXISTS platform_assets_read   ON storage.objects;
DROP POLICY IF EXISTS platform_assets_write  ON storage.objects;
DROP POLICY IF EXISTS platform_assets_update ON storage.objects;
DROP POLICY IF EXISTS platform_assets_delete ON storage.objects;

CREATE POLICY platform_assets_read ON storage.objects
  FOR SELECT USING (bucket_id = 'platform-assets');

CREATE POLICY platform_assets_write ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'platform-assets' AND is_verified_admin());

-- upsert:true on the client issues an UPDATE when the path already exists.
CREATE POLICY platform_assets_update ON storage.objects
  FOR UPDATE USING (bucket_id = 'platform-assets' AND is_verified_admin())
           WITH CHECK (bucket_id = 'platform-assets' AND is_verified_admin());

CREATE POLICY platform_assets_delete ON storage.objects
  FOR DELETE USING (bucket_id = 'platform-assets' AND is_verified_admin());

COMMIT;
