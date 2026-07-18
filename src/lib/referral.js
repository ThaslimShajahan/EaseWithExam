import { supabase } from './supabase';
import { createNotification } from './notifications';

/* ── Generate a deterministic referral code from firebase UID ── */

export function generateReferralCode(firebaseUid) {
  const base = firebaseUid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase();
  const suffix = Math.abs(firebaseUid.charCodeAt(0) * 31 + firebaseUid.charCodeAt(1)) % 1000;
  return `EWE-${base}${String(suffix).padStart(3, '0')}`;
}

/* ── Get or create referral record for a user ─────────────── */

export async function getMyReferral(firebaseUid) {
  const code = generateReferralCode(firebaseUid);

  const { data: existing } = await supabase
    .from('referrals')
    .select('*')
    .eq('referrer_id', firebaseUid)
    .maybeSingle();

  if (existing) return existing;

  const { data, error } = await supabase
    .from('referrals')
    .insert({ referrer_id: firebaseUid, referral_code: code })
    .select()
    .single();

  if (error && error.code === '23505') {
    const { data: retry } = await supabase
      .from('referrals')
      .select('*')
      .eq('referrer_id', firebaseUid)
      .maybeSingle();
    return retry;
  }

  if (error) throw error;
  return data;
}

/* ── Apply a referral code when a new user signs up ──────── */

export async function applyReferralCode(code, newUserFirebaseUid, newUserEmail) {
  const { data: referral } = await supabase
    .from('referrals')
    .select('*')
    .eq('referral_code', code.trim().toUpperCase())
    .maybeSingle();

  if (!referral) return { success: false, message: 'Invalid referral code.' };
  if (referral.referee_id) return { success: false, message: 'Referral already used.' };
  if (referral.referrer_id === newUserFirebaseUid) return { success: false, message: 'Cannot refer yourself.' };

  await supabase
    .from('referrals')
    .update({ referee_id: newUserFirebaseUid, referee_email: newUserEmail })
    .eq('id', referral.id);

  return { success: true, referrerId: referral.referrer_id };
}

/* ── Mark referral as converted + grant bonus to referrer ── */

export async function convertReferral(referrerId) {
  const { data: referral } = await supabase
    .from('referrals')
    .select('*')
    .eq('referrer_id', referrerId)
    .eq('converted', false)
    .maybeSingle();

  if (!referral) return;

  await supabase
    .from('referrals')
    .update({ converted: true, converted_at: new Date().toISOString() })
    .eq('id', referral.id);

  const bonusDays = 30;
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('expires_at, plan')
    .eq('user_id', referrerId)
    .maybeSingle();

  const base = sub?.expires_at ? new Date(sub.expires_at) : new Date();
  if (base < new Date()) base.setTime(Date.now());

  base.setDate(base.getDate() + bonusDays);

  await supabase
    .from('subscriptions')
    .upsert({
      user_id:    referrerId,
      plan:       sub?.plan === 'free' ? 'premium_monthly' : (sub?.plan ?? 'premium_monthly'),
      status:     'active',
      expires_at: base.toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

  createNotification(
    referrerId,
    'referral_converted',
    'Your referral earned you 30 bonus days! 🎁',
    'A friend you referred just activated their plan. Premium extended by 30 days.',
    '/profile',
  ).catch(() => {});
}

/* ── Referral stats for a user ────────────────────────────── */

export async function getReferralStats(firebaseUid) {
  const { data } = await supabase
    .from('referrals')
    .select('*')
    .eq('referrer_id', firebaseUid);

  const total     = data?.length ?? 0;
  const converted = data?.filter((r) => r.converted).length ?? 0;
  const bonusDays = converted * 30;

  return { referralCode: generateReferralCode(firebaseUid), total, converted, bonusDays };
}
