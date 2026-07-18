import { supabase } from './supabase';

export async function getInvitePreview(code) {
  const { data, error } = await supabase.rpc('get_invite_preview', { p_code: code });
  if (error) throw error;
  return data;
}

export async function redeemCentreInvite(code, uid) {
  const { data, error } = await supabase.rpc('redeem_centre_invite', {
    p_code: code,
    p_uid: uid,
  });
  if (error) throw error;
  return data;
}

export async function getCentreInvites(callerUid) {
  const { data, error } = await supabase.rpc('get_centre_invites', {
    p_caller_uid: callerUid,
  });
  if (error) throw error;
  return data;
}

export async function createCentreInvite({ callerUid, centreId, batch, maxUses, expiresAt }) {
  const { data, error } = await supabase.rpc('create_centre_invite', {
    p_caller_uid: callerUid,
    p_centre_id: centreId,
    p_batch: batch || null,
    p_max_uses: maxUses || null,
    p_expires_at: expiresAt || null,
  });
  if (error) throw error;
  return data;
}

export async function deactivateCentreInvite(inviteId, callerUid) {
  const { data, error } = await supabase.rpc('deactivate_centre_invite', {
    p_invite_id: inviteId,
    p_caller_uid: callerUid,
  });
  if (error) throw error;
  return data;
}

export async function adminGetCentreInvites(centreId) {
  const { data, error } = await supabase.rpc('admin_get_centre_invites', {
    p_centre_id: centreId,
  });
  if (error) throw error;
  return data;
}

export const INVITE_BASE_URL = `${window.location.origin}/join`;

export function inviteUrl(code) {
  return `${INVITE_BASE_URL}/${code}`;
}
