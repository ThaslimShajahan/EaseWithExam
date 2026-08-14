/**
 * GST math, added 2026-08-14 — owner confirmed with their CA that GST
 * applies exclusive/on top of the listed price. This is the DISPLAY-side
 * mirror of create-razorpay-order's authoritative server-side computation;
 * both must use the identical rule (round GST separately, add for the
 * total — never multiply the total directly) or the order summary could
 * show a different total than what actually gets charged.
 */
import { describe, it, expect } from 'vitest';
import { computeGst, formatRupees } from '../subscription';

describe('computeGst', () => {
  it('the three real plan prices — all land on exact paise, no rounding ambiguity', () => {
    // premium_monthly: ₹399
    expect(computeGst(39900, '18')).toEqual({
      hasTax: true, ratePercent: 18, basePaise: 39900, gstPaise: 7182, totalPaise: 47082,
    });
    // premium_yearly: ₹3999
    expect(computeGst(399900, '18')).toEqual({
      hasTax: true, ratePercent: 18, basePaise: 399900, gstPaise: 71982, totalPaise: 471882,
    });
    // neet_complete: ₹4999
    expect(computeGst(499900, '18')).toEqual({
      hasTax: true, ratePercent: 18, basePaise: 499900, gstPaise: 89982, totalPaise: 589882,
    });
  });

  it('base + gst always sums to exactly the reported total (no float-drift gap)', () => {
    // A price that is NOT a whole rupee, where basePaise * 1.18 computed
    // directly could disagree with base + round(base * 0.18) by a paise.
    for (const basePaise of [1, 33, 12345, 99999, 100001, 250075]) {
      const { basePaise: b, gstPaise: g, totalPaise: t } = computeGst(basePaise, '18');
      expect(t, `basePaise=${basePaise}`).toBe(b + g);
    }
  });

  it('rounds to the nearest paise', () => {
    // 100 * 0.18 = 18 exactly — a clean case first...
    expect(computeGst(100, '18').gstPaise).toBe(18);
    // ...then one that must actually round: 33 * 0.18 = 5.94 -> 6.
    expect(computeGst(33, '18').gstPaise).toBe(6);
  });

  it('no rate, zero rate, or non-numeric rate -> no tax, not a crash', () => {
    for (const rate of ['', null, undefined, '0', 0, 'not-a-number', '-5']) {
      const r = computeGst(39900, rate);
      expect(r.hasTax, String(rate)).toBe(false);
      expect(r.gstPaise, String(rate)).toBe(0);
      expect(r.totalPaise, String(rate)).toBe(39900);
    }
  });
});

describe('formatRupees', () => {
  it('whole rupees, no trailing decimals', () => {
    expect(formatRupees(39900)).toBe('₹399');
  });

  it('preserves paise as decimals', () => {
    expect(formatRupees(47082)).toBe('₹470.82');
  });

  it('groups thousands the Indian way', () => {
    expect(formatRupees(471882)).toBe('₹4,718.82');
  });

  it('never crashes on junk input', () => {
    expect(formatRupees(null)).toBe('₹0');
    expect(formatRupees(undefined)).toBe('₹0');
    expect(formatRupees('not a number')).toBe('₹0');
  });
});
