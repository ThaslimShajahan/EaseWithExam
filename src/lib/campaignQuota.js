/**
 * Campaign mode — temporarily lift every student's quota, on a schedule the
 * owner controls from Admin > Platform > Settings.
 *
 * WHY platform_settings AND NOT A FEATURE FLAG
 * feature_flags is (key, enabled, description) — a boolean and nowhere to put an
 * end date. A campaign that cannot express "until Friday" has to be switched off
 * by hand, which is the one step most likely to be forgotten, and forgetting it
 * here means unlimited AI spend continuing indefinitely. platform_settings
 * already carries free-form key/value pairs, an admin RPC, and a UI.
 *
 * WHY AN END DATE AND NOT A DURATION
 * A duration needs a start date to mean anything, and editing it mid-campaign
 * silently moves the finish line. One absolute timestamp is unambiguous, and the
 * campaign expires on its own — no cron, no cleanup, no reliance on anyone
 * remembering.
 *
 * SETTINGS
 *   campaign_unlimited_enabled  'true' | 'false'
 *   campaign_unlimited_ends_at  ISO-8601 timestamp; campaign is over once passed
 *
 * Both must agree for the campaign to be live: enabled alone does nothing once
 * the date has passed, and a future date does nothing while disabled. Two
 * independent conditions, because either one alone is easy to leave set by
 * accident.
 */

/** The value a campaign-active quota resolves to. -1 is the sentinel checkQuota
 *  already understands as unlimited (see quota.js checkQuota, `limit === -1`);
 *  nothing else in the pipeline needs to know a campaign exists. */
export const CAMPAIGN_LIMIT = -1;

/**
 * Pure predicate — no I/O, so the date logic is testable without a DB or a clock.
 *
 * @param {object} args
 * @param {string|boolean} args.enabled  the raw setting ('true'/'false' as stored)
 * @param {string} args.endsAt           ISO timestamp
 * @param {Date}   [args.now]            injectable for tests
 */
export function isCampaignActive({ enabled, endsAt, now = new Date() } = {}) {
  const on = enabled === true || enabled === 'true';
  if (!on) return false;

  // No end date while enabled is treated as INACTIVE, deliberately. The
  // alternative — "enabled with no expiry means forever" — is an unbounded spend
  // commitment created by a missing field, which is exactly the kind of default
  // that should fail closed.
  if (!endsAt) return false;

  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return false;   // unparseable date is not a licence to run free

  return now < end;
}

/** Whole days remaining, floored, for display. 0 once the campaign has ended. */
export function campaignDaysLeft({ endsAt, now = new Date() } = {}) {
  if (!endsAt) return 0;
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return 0;
  const ms = end.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000);
}
