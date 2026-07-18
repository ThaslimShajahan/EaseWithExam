import { supabase } from './supabase';

export async function createCoachingAdminInvite({ callerUid, centreId, email, name, role }) {
  const { data, error } = await supabase.rpc('create_coaching_admin_invite', {
    p_caller: callerUid,
    p_centre_id: centreId,
    p_email: email,
    p_name: name || null,
    p_role: role,
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function getCoachingAdminInvitePreview(code) {
  const { data, error } = await supabase.rpc('get_coaching_admin_invite_preview', { p_code: code });
  if (error) throw error;
  return data;
}

export async function redeemCoachingAdminInvite(code, uid, email) {
  const { data, error } = await supabase.rpc('redeem_coaching_admin_invite', {
    p_code: code, p_uid: uid, p_email: email,
  });
  if (error) throw error;
  return data;
}

export async function listCoachingAdminInvites(callerUid, centreId) {
  const { data, error } = await supabase.rpc('list_coaching_admin_invites', {
    p_caller: callerUid, p_centre_id: centreId,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export async function revokeCoachingAdminInvite(callerUid, inviteId) {
  const { error } = await supabase.rpc('revoke_coaching_admin_invite', {
    p_caller: callerUid, p_invite_id: inviteId,
  });
  if (error) throw error;
}

export const COACHING_INVITE_BASE_URL = `${window.location.origin}/coaching-invite`;

export function coachingAdminInviteUrl(code) {
  return `${COACHING_INVITE_BASE_URL}/${code}`;
}
