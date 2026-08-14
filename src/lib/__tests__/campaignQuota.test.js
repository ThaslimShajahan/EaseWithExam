/**
 * Campaign mode — both halves.
 *
 * ACTIVE   — enabled AND an end date still in the future.
 * INACTIVE — everything else, and "everything else" is the important half: this
 *            grants unlimited AI to every user on the platform, including free
 *            accounts with no payment relationship, so every ambiguous input has
 *            to fail CLOSED. A campaign that runs by accident is unbounded spend.
 */
import { describe, it, expect } from 'vitest';
import { isCampaignActive, campaignDaysLeft, CAMPAIGN_LIMIT } from '../campaignQuota';

const NOW    = new Date('2026-08-14T12:00:00Z');
const FUTURE = '2026-08-17T12:00:00Z';   // +3 days
const PAST   = '2026-08-13T12:00:00Z';   // -1 day

describe('CAMPAIGN_LIMIT', () => {
  it('is the -1 sentinel checkQuota already understands as unlimited', () => {
    expect(CAMPAIGN_LIMIT).toBe(-1);
  });
});

describe('ACTIVE', () => {
  it('enabled with a future end date', () => {
    expect(isCampaignActive({ enabled: 'true', endsAt: FUTURE, now: NOW })).toBe(true);
  });

  it('accepts a real boolean as well as the stored string', () => {
    // platform_settings stores text, but a caller passing a boolean should not
    // silently disable a live campaign.
    expect(isCampaignActive({ enabled: true, endsAt: FUTURE, now: NOW })).toBe(true);
  });
});

describe('INACTIVE — every ambiguous case fails closed', () => {
  it('disabled, even with a future date', () => {
    expect(isCampaignActive({ enabled: 'false', endsAt: FUTURE, now: NOW })).toBe(false);
  });

  it('enabled but the date has passed — expires on its own, no cron needed', () => {
    expect(isCampaignActive({ enabled: 'true', endsAt: PAST, now: NOW })).toBe(false);
  });

  it('enabled with NO end date is INACTIVE, not "forever"', () => {
    // The dangerous default. Treating a missing expiry as unlimited-forever
    // would turn a half-filled form into an open-ended spend commitment.
    expect(isCampaignActive({ enabled: 'true', endsAt: null, now: NOW })).toBe(false);
    expect(isCampaignActive({ enabled: 'true', endsAt: '',   now: NOW })).toBe(false);
  });

  it('an unparseable date is not a licence to run free', () => {
    expect(isCampaignActive({ enabled: 'true', endsAt: 'next friday', now: NOW })).toBe(false);
  });

  it('exactly at the end instant is over', () => {
    expect(isCampaignActive({ enabled: 'true', endsAt: NOW.toISOString(), now: NOW })).toBe(false);
  });

  it('junk input never throws and never activates', () => {
    expect(() => isCampaignActive()).not.toThrow();
    expect(isCampaignActive()).toBe(false);
    expect(isCampaignActive({})).toBe(false);
    expect(isCampaignActive({ enabled: 'TRUE', endsAt: FUTURE, now: NOW })).toBe(false); // case-sensitive by design
  });
});

describe('campaignDaysLeft', () => {
  it('floors whole days remaining', () => {
    expect(campaignDaysLeft({ endsAt: FUTURE, now: NOW })).toBe(3);
  });

  it('is 0 once passed, never negative', () => {
    expect(campaignDaysLeft({ endsAt: PAST, now: NOW })).toBe(0);
  });

  it('is 0 for missing or unparseable dates', () => {
    expect(campaignDaysLeft({ endsAt: null, now: NOW })).toBe(0);
    expect(campaignDaysLeft({ endsAt: 'soon', now: NOW })).toBe(0);
    expect(campaignDaysLeft()).toBe(0);
  });
});
