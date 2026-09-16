-- Adds a place to store a native Android FCM push token, separate from the
-- existing push_endpoint/push_p256dh/push_auth columns — those three are
-- structurally Web Push (VAPID + ECDH), a single opaque FCM token doesn't
-- fit that shape and must never be written into push_endpoint (send-push,
-- supabase/functions/send-push/index.ts, treats push_endpoint as a Web Push
-- URL to POST an RFC 8291-encrypted body to — an FCM token there would just
-- fail silently as a bad URL).
--
-- NOTE: this column is currently WRITE-ONLY from the Android app's
-- perspective (src/lib/notifications.js's registerNativePush, guarded by
-- Capacitor.isNativePlatform()) — nothing reads it yet. send-push has no
-- FCM/HTTP-v1 delivery path; sending to a token stored here needs a
-- follow-up task (Firebase Admin SDK service-account auth, a genuinely
-- different delivery mechanism from the Web Push code above it). Native
-- push registration working does not yet mean native push delivery works.

alter table public.notification_prefs
  add column if not exists push_fcm_token text;

comment on column public.notification_prefs.push_fcm_token is
  'FCM registration token for the native Android app (@capacitor/push-notifications). Write-only until send-push (or a sibling function) gains FCM HTTP v1 delivery — see this migration''s header.';
