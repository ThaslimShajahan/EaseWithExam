import { Capacitor } from '@capacitor/core';
import { supabase } from './supabase';

/* ── Push infrastructure ────────────────────────────────── */

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(b64url) {
  const padding = '='.repeat((4 - (b64url.length % 4)) % 4);
  const base64  = (b64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

const PUSH_SETUP_TIMEOUT_MS = 12000;

// navigator.serviceWorker.ready never resolves if no service worker ever
// registers (e.g. Batch 15: dev mode with vite-plugin-pwa's devOptions off),
// and pushManager.subscribe() can in principle hang on a slow/unreachable
// push service too — neither has a native timeout, so either one hanging
// left requestPushPermission's caller stuck forever (NotificationSettings'
// "Finishing setup…" state never resolving). Promise.race doesn't cancel the
// underlying browser promise if it wins late, but that's fine here — it can
// only resolve to a real registration/subscription with no listener left to
// act on it, not cause any user-visible side effect.
function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

// Native Android build only (Capacitor wrapper) — FCM via @capacitor/push-
// notifications, not the Web Push/VAPID flow below (a WebView's Notification/
// PushManager APIs are unreliable once Android's battery optimizer backgrounds
// the app, which is exactly when a daily-reminder push matters most). Saves
// to notification_prefs.push_fcm_token, a column the Web Push send-push edge
// function deliberately never reads — see that migration's header for why
// this alone does not yet mean native push DELIVERY works; only registration.
async function requestNativePushPermission(firebaseUid) {
  const { PushNotifications } = await import('@capacitor/push-notifications');

  const perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') return { granted: false, reason: 'denied' };

  return withTimeout(
    new Promise((resolve, reject) => {
      let regHandle, errHandle;
      const cleanup = () => { regHandle?.remove(); errHandle?.remove(); };
      PushNotifications.addListener('registration', async (token) => {
        cleanup();
        try {
          await upsertOwnPrefs(firebaseUid, {
            push_fcm_token: token.value,
            push_enabled:   true,
          });
          resolve({ granted: true, token: token.value });
        } catch (err) {
          reject(err);
        }
      }).then((h) => { regHandle = h; });
      PushNotifications.addListener('registrationError', (err) => {
        cleanup();
        reject(new Error(err.error || 'FCM registration failed'));
      }).then((h) => { errHandle = h; });
      PushNotifications.register();
    }),
    PUSH_SETUP_TIMEOUT_MS,
    'Native push registration did not complete in time',
  ).catch((err) => ({ granted: false, reason: 'error', error: err.message }));
}

export async function requestPushPermission(firebaseUid) {
  if (Capacitor.isNativePlatform()) return requestNativePushPermission(firebaseUid);

  if (!('Notification' in window))    return { granted: false, reason: 'not_supported' };
  if (!('serviceWorker' in navigator)) return { granted: false, reason: 'no_sw' };
  if (!('PushManager' in window))     return { granted: false, reason: 'no_push_api' };
  if (!VAPID_PUBLIC_KEY)              return { granted: false, reason: 'no_vapid_key' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { granted: false, reason: 'denied' };

  try {
    const registration = await withTimeout(
      navigator.serviceWorker.ready, PUSH_SETUP_TIMEOUT_MS,
      'Service worker did not become ready in time',
    );
    const subscription = await withTimeout(
      registration.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      }),
      PUSH_SETUP_TIMEOUT_MS, 'Push subscription did not complete in time',
    );
    const { endpoint, keys } = subscription.toJSON();
    await savePushSubscription(firebaseUid, endpoint, keys.p256dh, keys.auth);
    return { granted: true, endpoint };
  } catch (err) {
    console.error('[Push] subscribe error:', err);
    return { granted: false, reason: 'error', error: err.message };
  }
}

// notification_prefs is RPC-only since 20260924000000 (it held phone numbers
// and push keys behind an anon-readable policy). upsert_own_notification_prefs
// refuses any column outside its whitelist rather than dropping it silently.
async function upsertOwnPrefs(firebaseUid, fields) {
  const { error } = await supabase.rpc('upsert_own_notification_prefs', {
    p_uid: firebaseUid, p_fields: fields,
  });
  if (error) throw new Error(error.message);
}

export async function savePushSubscription(firebaseUid, endpoint, p256dh, auth) {
  await upsertOwnPrefs(firebaseUid, {
    push_endpoint: endpoint,
    push_p256dh:   p256dh,
    push_auth:     auth,
    push_enabled:  true,
  });
}

export async function getNotificationPrefs(firebaseUid) {
  const { data, error } = await supabase.rpc('get_own_notification_prefs', { p_uid: firebaseUid });
  if (error) throw new Error(error.message);
  // A composite-returning RPC yields an all-null object, not null, when the
  // caller has no row yet — normalise to the old .maybeSingle() contract.
  return data?.user_id ? data : null;
}

export async function updateNotificationPrefs(firebaseUid, prefs) {
  await upsertOwnPrefs(firebaseUid, prefs);
}

export async function disablePush(firebaseUid) {
  await upsertOwnPrefs(firebaseUid, {
    push_endpoint: null,
    push_p256dh:   null,
    push_auth:     null,
    push_enabled:  false,
  });
}

export function showLocalNotification(title, body, url = '/dashboard') {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const n = new Notification(title, {
    body,
    icon:  '/icon-192.png',
    badge: '/favicon-32.png',
    data:  { url },
  });
  n.onclick = () => { window.focus(); window.location.href = url; n.close(); };
}

export function scheduleDailyReminder(hour = 19, minute = 0) {
  const now    = new Date();
  const target = new Date();
  target.setHours(hour, minute, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  setTimeout(() => {
    showLocalNotification('Time to study! 📚', 'Your daily session awaits. Keep your streak alive!', '/dashboard');
  }, target - now);
}

/* ── In-app notification types ──────────────────────────── */

export const NOTIF_TYPES = {
  test_complete:       { label: 'Test Complete',       color: 'bg-emerald-100 text-emerald-700'  },
  practice_complete:   { label: 'Practice Done',       color: 'bg-blue-100 text-blue-700'        },
  daily_challenge:     { label: 'Daily Challenge',     color: 'bg-amber-100 text-amber-700'      },
  streak_milestone:    { label: 'Streak',              color: 'bg-orange-100 text-orange-700'    },
  level_up:            { label: 'Level Up',            color: 'bg-violet-100 text-violet-700'    },
  subscription_active: { label: 'Subscription',        color: 'bg-violet-100 text-violet-700'    },
  errors_logged:       { label: 'Error Notebook',      color: 'bg-red-100 text-red-600'          },
  review_complete:     { label: 'Review Done',         color: 'bg-teal-100 text-teal-700'        },
  exam_reminder:       { label: 'Exam Alert',          color: 'bg-primary-100 text-primary-700'  },
  welcome:             { label: 'Welcome',             color: 'bg-indigo-100 text-indigo-700'    },
  flashcard_complete:  { label: 'Flashcards',          color: 'bg-purple-100 text-purple-700'    },
  study_plan_created:  { label: 'Study Plan',          color: 'bg-cyan-100 text-cyan-700'        },
  syllabus_milestone:  { label: 'Syllabus',            color: 'bg-lime-100 text-lime-700'        },
  veda_session:        { label: 'EWE',                 color: 'bg-fuchsia-100 text-fuchsia-700'  },
  referral_converted:  { label: 'Referral',            color: 'bg-amber-100 text-amber-700'      },
  new_paper:           { label: 'New Test',            color: 'bg-primary-100 text-primary-700'  },
  // Admin-composed broadcast types (AdminPushNotifications.jsx)
  info:                { label: 'Info',                color: 'bg-blue-100 text-blue-700'        },
  success:             { label: 'Success',              color: 'bg-emerald-100 text-emerald-700'  },
  warning:             { label: 'Alert',                color: 'bg-amber-100 text-amber-700'      },
  achievement:         { label: 'Achievement',          color: 'bg-violet-100 text-violet-700'    },
  assignment:          { label: 'Assignment',           color: 'bg-orange-100 text-orange-700'    },
};

/* ── Create a notification ──────────────────────────────── */

// user_notifications is RPC-only since 20260924000000 and no longer on the
// Realtime publication. Every student-side writer notifies only its own
// account; NOTIF_CREATED_EVENT lets the shared feed (useNotifications)
// refresh immediately instead of waiting for its next poll.
export const NOTIF_CREATED_EVENT = 'ewe:notif-created';

export async function createNotification(firebaseUid, type, title, body, link = null) {
  if (!firebaseUid) return;
  const { error } = await supabase.rpc('create_own_user_notification', {
    p_uid: firebaseUid, p_type: type, p_title: title, p_body: body ?? '', p_link: link,
  });
  if (error) {
    // A notification is a side effect — never let one break the action behind it.
    console.warn('[Notif] createNotification failed:', error.message);
    return;
  }
  window.dispatchEvent(new Event(NOTIF_CREATED_EVENT));
}

/* ── Admin: one student / every student ─────────────────── */
export async function adminSendNotification(callerUid, userId, type, title, body, link = null) {
  const { error } = await supabase.rpc('admin_send_user_notification', {
    p_caller: callerUid, p_user_id: userId, p_type: type, p_title: title, p_body: body ?? '', p_link: link,
  });
  if (error) throw new Error(error.message);
}

export async function broadcastNotification(callerUid, type, title, body, link = null) {
  const { data, error } = await supabase.rpc('admin_broadcast_user_notification', {
    p_caller: callerUid, p_type: type, p_title: title, p_body: body ?? '', p_link: link,
  });
  if (error) {
    console.warn('[Notif] broadcastNotification failed:', error.message);
    return 0;
  }
  return data ?? 0;
}

/* ── Fetch notifications ────────────────────────────────── */

// Returns null (not []) when the fetch fails, so a poll that hits a blip
// keeps what's on screen instead of blanking the bell.
export async function getNotifications(firebaseUid, limit = 30) {
  const { data, error } = await supabase.rpc('get_own_user_notifications', {
    p_uid: firebaseUid, p_limit: limit,
  });
  if (error) {
    console.warn('[Notif] getNotifications failed:', error.message);
    return null;
  }
  return data ?? [];
}

/* ── Mark as read ───────────────────────────────────────── */

export async function markNotificationRead(firebaseUid, notificationId) {
  await supabase.rpc('mark_own_user_notification_read', { p_uid: firebaseUid, p_id: notificationId });
}

export async function markAllNotificationsRead(firebaseUid) {
  await supabase.rpc('mark_all_own_user_notifications_read', { p_uid: firebaseUid });
}

/* ── Delete notification ────────────────────────────────── */

export async function deleteNotification(firebaseUid, notificationId) {
  await supabase.rpc('delete_own_user_notification', { p_uid: firebaseUid, p_id: notificationId });
}

export async function deleteAllNotifications(firebaseUid) {
  await supabase.rpc('delete_all_own_user_notifications', { p_uid: firebaseUid });
}
