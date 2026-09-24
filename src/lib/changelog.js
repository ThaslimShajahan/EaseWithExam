/**
 * Changelog helper — writes an immutable audit entry to the `changelog` table
 * for every admin / coaching mutation.
 *
 * ALL admin/coaching write paths must call logChange() after a successful mutation.
 * The call is fire-and-forget (non-blocking) — a failure never surfaces to the user,
 * but IS logged to the console so it can be investigated.
 *
 * Usage:
 *   import { logChange, ENTITY, ACTION } from './changelog';
 *
 *   // After deleting a test:
 *   logChange(ENTITY.PUBLISHED_TEST, testId, ACTION.DELETE_REQUEST,
 *     { before: testSnapshot }, 'Admin deleted stale mock test');
 *
 *   // After approving a PYQ question:
 *   logChange(ENTITY.PYQ_QUESTION, questionId, ACTION.APPROVE,
 *     { before: { status: 'in_review' }, after: { status: 'published' } });
 */

import { supabase } from './supabase';

/** Entity type constants — must match the CHECK constraint in migration 0002 */
export const ENTITY = {
  CONTENT_ITEM:    'content_item',
  PYQ_QUESTION:    'pyq_question',
  PUBLISHED_TEST:  'published_test',
  STUDY_NOTE:      'study_note',
  SYLLABUS_NODE:   'syllabus_node',
  PLAN_CONFIG:     'plan_config',
  FEATURE_FLAG:    'feature_flag',
  COACHING_CENTRE: 'coaching_centre',
  USER_QUOTA:      'user_quota',
  ADMIN_USER:      'admin_user',
  MISCONCEPTION:   'misconception',
  SYSTEM:          'system',
};

/** Action constants — must match the CHECK constraint in migration 0002 */
export const ACTION = {
  CREATE:         'create',
  UPDATE:         'update',
  PUBLISH:        'publish',
  ARCHIVE:        'archive',
  DELETE_REQUEST: 'delete_request',
  DELETE:         'delete',
  APPROVE:        'approve',
  REJECT:         'reject',
  RESTORE:        'restore',
  BACKFILL:       'backfill',
  SEED:           'seed',
  BULK_DELETE:    'bulk_delete',
  EMBED_FAILED:   'embed_failed',
  WIPE:           'wipe',
  EXPORT:         'export',
};

/** Actor role constants — must match the CHECK constraint in migration 0002 */
export const ROLE = {
  ADMIN:        'admin',
  SUPERADMIN:   'superadmin',
  CENTRE_ADMIN: 'centre_admin',
  INSTRUCTOR:   'instructor',
  SYSTEM:       'system',
};

/**
 * Write an audit entry to the changelog table.
 * Non-blocking — returns void; errors are console-warned, never thrown.
 *
 * @param {string} entityType  - one of ENTITY.*
 * @param {string} entityId    - UUID or stable key of the changed row
 * @param {string} action      - one of ACTION.*
 * @param {object} [diff]      - { before: {...}, after: {...} } or summary
 * @param {string} [note]      - optional human-readable reason
 * @param {object} [actor]     - { uid: string, role: string } — pulled from AdminGuard session if omitted
 */
export function logChange(entityType, entityId, action, diff = null, note = null, actor = null) { // eslint-disable-line no-unused-vars
  // Since security pass 2 (2026-09-25) the changelog accepts writes ONLY via
  // log_change(), which stamps actor_uid/actor_role from the VERIFIED Firebase
  // token. The `actor` argument is kept for call-site compatibility and ignored
  // — a browser-supplied actor is exactly what made audit entries forgeable.
  // Fire-and-forget — never block the UI
  supabase
    .rpc('log_change', {
      p_entity_type: entityType,
      p_entity_id:   String(entityId),
      p_action:      action,
      p_diff:        diff ?? null,
      p_note:        note ?? null,
    })
    .then(({ error }) => {
      if (error) {
        console.warn('[changelog] failed to write entry:', error.message, {
          entityType, entityId, action,
        });
      }
    });
}

/**
 * Async version — awaits the insert. Use when you need to confirm the entry
 * was written (e.g., backfill scripts, test runner).
 *
 * @returns {Promise<{id: string}|null>}
 */
export async function logChangeAsync(entityType, entityId, action, diff = null, note = null, actor = null) { // eslint-disable-line no-unused-vars
  const { data, error } = await supabase.rpc('log_change', {
    p_entity_type: entityType,
    p_entity_id:   String(entityId),
    p_action:      action,
    p_diff:        diff ?? null,
    p_note:        note ?? null,
  });
  if (error) {
    console.warn('[changelog] failed to write entry:', error.message);
    return null;
  }
  return data ? { id: data } : null;
}

/**
 * Bulk-log multiple changes in one insert (for backfill scripts).
 *
 * @param {Array<{entityType, entityId, action, diff?, note?, actor?}>} entries
 */
export async function logChangesBulk(entries) {
  if (!entries?.length) return;
  // Admin-only on the server (log_changes_bulk); actors come from the token.
  const { error } = await supabase.rpc('log_changes_bulk', {
    p_entries: entries.map((e) => ({
      entity_type: e.entityType,
      entity_id:   String(e.entityId),
      action:      e.action,
      diff:        e.diff ?? null,
      note:        e.note ?? null,
    })),
  });
  if (error) {
    console.warn('[changelog] bulk insert failed:', error.message);
  }
}

/**
 * Read recent changelog entries for a specific entity (admin UI use).
 *
 * @param {string} entityType
 * @param {string} entityId
 * @param {number} [limit=20]
 * @returns {Promise<Array>}
 */
export async function getEntityHistory(entityType, entityId, limit = 20) {
  const { data, error } = await supabase
    .from('changelog')
    .select('id, action, actor_uid, actor_role, diff, note, created_at')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.warn('[changelog] getEntityHistory failed:', error.message);
    return [];
  }
  return data ?? [];
}

// _resolveActor() removed 2026-09-25: the actor is now stamped server-side from
// the verified Firebase token by log_change(), never read from sessionStorage.
