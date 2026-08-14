/**
 * The legal entity behind EaseWithExam, shown on the order summary
 * (OrderSummaryModal) and the payment confirmation page — student-facing
 * financial screens where the business's own identity belongs.
 *
 * Source of truth is the actual billing app's config
 * (acenzos-billing/src/config/company.js) — copied here rather than shared
 * as a module because the two projects are separate codebases with no
 * shared build/package setup. Keep these two in sync by hand if either
 * changes; there is no mechanism that does it automatically.
 *
 * NOT a claim of GST-invoice compliance — showing a GSTIN here makes this a
 * receipt with business details on it, not a Rule 46 tax invoice (no
 * sequential invoice number, HSN/SAC, or tax breakup). See the GST section
 * of docs/ACTION_ITEMS_FOR_YOU.md for what that would still need.
 */
export const BUSINESS_DETAILS = {
  name:    'Acenzos Technologies Private Limited',
  gstin:   '32ABFCA7782C1ZT',
  address: '24/1701, SNO.974, Heiley Offices, KC Arcade, Kakkanad, CSEZ P.O., Kochi – 682037, Kerala',
};
