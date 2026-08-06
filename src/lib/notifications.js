import { supabase } from './supabase';

/* ── Push infrastructure ────────────────────────────────── */

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(b64url) {
  const padding = '='.repeat((4 - (b64url.length % 4)) % 4);
  const base64  = (b64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

export async function requestPushPermission(firebaseUid) {
  if (!('Notification' in window))    return { granted: false, reason: 'not_supported' };
  if (!('serviceWorker' in navigator)) return { granted: false, reason: 'no_sw' };
  if (!('PushManager' in window))     return { granted: false, reason: 'no_push_api' };
  if (!VAPID_PUBLIC_KEY)              return { granted: false, reason: 'no_vapid_key' };

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return { granted: false, reason: 'denied' };

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    const { endpoint, keys } = subscription.toJSON();
    await savePushSubscription(firebaseUid, endpoint, keys.p256dh, keys.auth);
    return { granted: true, endpoint };
  } catch (err) {
    console.error('[Push] subscribe error:', err);
    return { granted: false, reason: 'error', error: err.message };
  }
}

export async function savePushSubscription(firebaseUid, endpoint, p256dh, auth) {
  await supabase.from('notification_prefs').upsert({
    user_id:       firebaseUid,
    push_endpoint: endpoint,
    push_p256dh:   p256dh,
    push_auth:     auth,
    push_enabled:  true,
    updated_at:    new Date().toISOString(),
  }, { onConflict: 'user_id' });
}

export async function getNotificationPrefs(firebaseUid) {
  const { data } = await supabase
    .from('notification_prefs')
    .select('*')
    .eq('user_id', firebaseUid)
    .maybeSingle();
  return data;
}

export async function updateNotificationPrefs(firebaseUid, prefs) {
  await supabase.from('notification_prefs').upsert({
    user_id:    firebaseUid,
    ...prefs,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
}

export async function disablePush(firebaseUid) {
  await supabase.from('notification_prefs').upsert({
    user_id:       firebaseUid,
    push_endpoint: null,
    push_p256dh:   null,
    push_auth:     null,
    push_enabled:  false,
    updated_at:    new Date().toISOString(),
  }, { onConflict: 'user_id' });
}

export function showLocalNotification(title, body, url = '/dashboard') {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const n = new Notification(title, {
    body,
    icon:  '/pwa-192x192.png',
    badge: '/pwa-64x64.png',
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

export async function createNotification(firebaseUid, type, title, body, link = null) {
  if (!firebaseUid) return;
  try {
    await supabase.from('user_notifications').insert({
      user_id:    firebaseUid,
      type,
      title,
      body,
      link,
      read:       false,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    // Table may not exist yet — fail silently so events never break
    console.warn('[Notif] createNotification failed:', err?.message);
  }
}

/* ── Broadcast to all users (admin use only) ────────────── */
export async function broadcastNotification(callerUid, type, title, body, link = null) {
  try {
    // Fetch all firebase_uids from the users table (limit 2000 — enough for most deployments)
    const { data: uids } = await supabase.rpc('admin_list_all_firebase_uids', { p_caller: callerUid });
    if (!uids?.length) return;

    const now  = new Date().toISOString();
    const rows = uids.map((firebase_uid) => ({
      user_id:    firebase_uid,
      type,
      title,
      body,
      link,
      read:       false,
      created_at: now,
    }));

    // Insert in batches of 200 to stay within PostgREST limits
    for (let i = 0; i < rows.length; i += 200) {
      await supabase.from('user_notifications').insert(rows.slice(i, i + 200));
    }
  } catch (err) {
    console.warn('[Notif] broadcastNotification failed:', err?.message);
  }
}

/* ── Fetch notifications ────────────────────────────────── */

export async function getNotifications(firebaseUid, limit = 30) {
  try {
    const { data } = await supabase
      .from('user_notifications')
      .select('*')
      .eq('user_id', firebaseUid)
      .order('created_at', { ascending: false })
      .limit(limit);
    return data ?? [];
  } catch {
    return [];
  }
}

/* ── Mark as read ───────────────────────────────────────── */

export async function markNotificationRead(notificationId) {
  await supabase
    .from('user_notifications')
    .update({ read: true })
    .eq('id', notificationId);
}

export async function markAllNotificationsRead(firebaseUid) {
  await supabase
    .from('user_notifications')
    .update({ read: true })
    .eq('user_id', firebaseUid)
    .eq('read', false);
}

/* ── Delete notification ────────────────────────────────── */

export async function deleteNotification(notificationId) {
  await supabase
    .from('user_notifications')
    .delete()
    .eq('id', notificationId);
}
