import { describe, it, expect, vi } from 'vitest';

vi.mock('../supabase', () => ({
  supabase: { rpc: vi.fn() },
}));

import { inviteUrl, INVITE_BASE_URL } from '../invites';

describe('inviteUrl', () => {
  it('appends code to base URL', () => {
    const code = 'abc123';
    expect(inviteUrl(code)).toBe(`${INVITE_BASE_URL}/${code}`);
  });

  it('produces a URL containing the invite code', () => {
    const code = 'XYZ-789';
    const url = inviteUrl(code);
    expect(url).toContain(code);
  });

  it('includes /join/ in the path', () => {
    expect(inviteUrl('testcode')).toContain('/join/');
  });
});
