# Action Items

Standing list of things that are open, blocked on the project owner, or knowingly
shipped in a degraded state. The narrative of what changed and why lives in
`docs/CHANGELOG.md` — this file is the "what's still wrong" ledger.

---

## ⏸ BLOCKED ON API DOCS — integrate with the EXISTING billing software (2026-08-13)

**Direction changed. Do not build invoicing here.** There is a separate, existing
custom billing product with its own codebase and database. EaseWithExam
integrates with it; it does not compete with it.

### Status

- **Piece 1 (Admin → Students → Billing) STAYS.** It is a payment log read from
  `payment_orders`, useful whichever system issues the tax documents. Unaffected.
- **Pieces 2-5 (invoices table, GST logic, PDF, email) are PAUSED, not
  cancelled** — see below for what survives the change and what does not.
- **Blocked on: API documentation and connection details for the billing
  software.** Owner is obtaining these.

### ✅ INVESTIGATED 2026-08-13 — `C:\Users\THASLIM\Billing software\acenzos-billing`

Read-only. Nothing in that codebase was modified.

**It is a client-only Vite + React 19 app writing straight to Firestore.**
There is **no API, no webhooks, no Cloud Functions, no server of any kind** — no
`express`/`fastify`/`next`/`firebase-functions` in its dependencies and no
`functions/`, `api/` or `server/` directory anywhere. So *"call their REST
endpoint"* is not an option that exists.

| question | answer |
|---|---|
| **1. API to call?** | **No.** Client-only. Data path is the Firebase JS SDK → Firestore. Auth is Firebase Auth (email/password, `AuthContext`). No create-invoice or create-customer endpoint exists to call. |
| **2. Schema?** | Firestore, `users/{ownerUid}/invoices/{id}` and `users/{ownerUid}/customers/{id}` — **per-owner subcollections**, keyed on the logged-in business owner, not per customer. Fields below. |
| **3. Does it do GST itself?** | **Yes, properly.** It computes CGST+SGST vs IGST from `clientState` vs `COMPANY_STATE`, handles export/LUT zero-rating, keeps per-line `hsnSac` and `taxRate`, and builds an HSN summary. **EaseWithExam must NOT compute tax** — it supplies facts, the billing app derives tax. |

**Its `firestore.rules` are the integration constraint:**

```
match /users/{userId}/{document=**} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```

Only the owning authenticated user can touch their own subtree. There is no
service path and no shared collection. **Writing from EaseWithExam therefore
means the Firebase Admin SDK with a service account** (which bypasses rules),
plus that owner's UID — not an API key.

`firebase-admin` is already a dependency here, so the mechanism exists.

#### Invoice document fields (from `InvoiceForm.jsx`)

`invoiceNumber` · `invoiceDate` · `dueDate` · `status` ·
`clientName` `clientEmail` `clientPhone` `clientAddress` `clientGSTIN`
`clientState` `placeOfSupply` · `poNumber` `irnNumber` ·
`currency` `exchangeRate` · `isExport` `lutNumber` `iecCode` ·
`items[]` = `{ description, qty, unit, rate, taxRate, hsnSac }` · `discount` ·
and the derived `subtotal` `totalTax` `discountAmt` `total` `totalINR`
`isInterstate` `cgst` `sgst` `igst`.

Customer doc: `name` `email` `phone` `address` `gstin` `contactPerson`.

#### ⚠ Four things found that change the integration design

1. **Invoice numbering is client-side and race-prone.** `nextInvoiceNo()` reads
   the *already-loaded* invoice list, strips the `ACZ/INV/{FY}/` prefix, and
   takes `max + 1` (seeded at 1001). Two writers — say the UI and a sync from
   here — can mint the **same number**, and Rule 46 wants consecutive unique
   numbers. **Any integration must not allocate numbers independently.** Safest
   is to write invoices without a number and let a human issue them in the UI,
   or to move numbering server-side first.
2. **The company GSTIN is a placeholder.** `src/config/company.js` has
   `gstin: 'YOUR GSTIN'`, `pan: 'YOUR PAN'` and placeholder bank details. **That
   system cannot issue a compliant invoice today either**, and it answers the
   earlier open question: no real GSTIN is configured anywhere. This must be
   filled in regardless of any integration work.
3. **Customers have no `state` field, but invoices read `c.state`.**
   `Customers.jsx` creates `{name,email,phone,address,gstin,contactPerson}` —
   no `state`. `InvoiceForm` does `clientState: c.state || ''` when picking a
   customer, so it always comes back empty and the CGST/SGST-vs-IGST decision
   silently falls back to intrastate. A latent bug in their app, and it lands
   exactly on the field EaseWithExam would need to supply. Flagged, not fixed.
4. **Its Supabase client is dead code.** `src/config/supabase.js` creates a
   client (hardcoded URL + anon key, a *different* project from EaseWithExam's)
   that is imported nowhere. Not a shared database — do not assume one.

#### Proposed integration — async sync, not inline

Matches the earlier recommendation, and the findings above strengthen it:

- **A scheduled/queued job** reads redeemed `payment_orders` rows that have not
  yet been exported, and writes a Firestore invoice doc via `firebase-admin`
  under the owner's UID.
- **Never inline in `razorpay-verify`.** A Firestore write from a third-party
  project on the critical path of activation means a student who paid loses
  access when that project is unreachable. Activation and invoicing must not
  share a failure domain.
- **EaseWithExam supplies facts only**: customer name/email/address/state, the
  line item (plan name, `qty 1`, rate = amount, `taxRate`, `hsnSac`), and the
  payment reference. **It computes no tax and allocates no invoice number.**
- **Idempotency**: store the created Firestore doc id back on `payment_orders`
  (needs a column), so a retry cannot double-issue an invoice.

**Still blocked on**, and only the owner can supply: the billing app's Firebase
project **service-account credentials**, the **owner UID** whose subtree to
write under, the **real GSTIN/PAN**, and the **SAC code + tax rate** to use for
an online-education subscription.

### The three questions as originally recorded

They are questions about the OTHER system, and nothing in this codebase or its
database can answer them. Recorded here as a precise request so that the moment
the docs arrive the design is a short step, not a fresh investigation:

**1. Integration direction — does it expose an API, or does it pull?**
Need: base URL, auth scheme (API key / OAuth / mTLS / IP allowlist), the
endpoint that creates a customer and the one that creates an invoice or payment
record, request/response schemas, rate limits, and whether a sandbox exists.
If instead it **pulls from our database**, that is a very different job: it needs
a read path into Supabase (a dedicated role and a view, never broad table
access), and the direction of trust reverses.

**2. Trigger — inline in `razorpay-verify`, or a separate sync?**
This is the decision with the most operational consequence, and it should be
made deliberately rather than by whichever is easier:

- **Inline** (call the billing API from `razorpay-verify` after redemption) is
  simplest and gives an invoice immediately — but it puts a third-party call on
  the critical path of activating a subscription. If billing is slow or down, a
  student who has genuinely paid does not get access. **A payment must never
  fail because invoicing failed.**
- **Separate sync** (a queue or scheduled job reading `payment_orders`) keeps
  activation independent, survives billing downtime, and retries naturally. Cost
  is a delay before the invoice exists, and one more moving part.

**Recommendation regardless of the answer: activation and invoicing must not
share a failure domain.** If inline is chosen, the billing call must be
fire-and-forget with a durable retry, never awaited before activation.

**3. What it needs per transaction.** Need their required-field list. What this
side can supply today, and what it cannot, is below — the gap is the useful part.

### What we already have to feed it

| field | source | ready? |
|---|---|---|
| order id, payment id | `payment_orders.order_id` / `payment_id` | ✅ |
| amount (paise) | `payment_orders.amount_paise` | ✅ |
| plan | `payment_orders.plan_id` | ✅ |
| paid-at timestamp | `payment_orders.redeemed_at` | ✅ |
| student identity | `payment_orders.firebase_uid` → `users` | ✅ |
| name, email | `users.display_name`, `users.email` | ✅ |

`payment_orders` is the right source: one row per order, kept permanently.
**Do not integrate off `subscriptions`** — it upserts on `user_id`, so a renewal
overwrites the previous payment and any sync built on it loses history.

### ⚠ What we do NOT capture, and almost certainly must

Actionable **now**, before the integration lands, because it needs UI and a
migration on this side whatever the billing system turns out to want:

- **Billing state / state code** — for B2C online services the place of supply is
  the recipient's location, and it decides CGST+SGST vs IGST. Captured nowhere.
- **Legal name and address** — `display_name` is a profile name, not a billing
  name.
- **Customer GSTIN** (optional, for B2B students claiming input credit).

Whether these are collected at checkout or backfilled is a UX decision, but no
billing system can issue a compliant invoice without the first one.

### What survives the change, and what does not

- **Discarded:** local GST computation, invoice numbering, PDF generation, the
  invoice email path. All of it belongs to the billing product now. The earlier
  finding that PDF generation is NOT already solved in this codebase stops
  mattering, which removes the largest single line from that estimate.
- **Still true and still needed:** the missing billing fields above, and the
  pricing-copy problem below.

### ✅ FIXED 2026-08-13 — the "+ GST" pricing copy is gone

The copy claimed a charge that never happened: Razorpay is sent exactly
`price_paise` — ₹399, nothing added — while the site said **"₹399 + GST"** and
"Prices exclude GST". Removed on the owner's instruction, ahead of and separate
from the billing integration:

- `src/lib/subscription.js` — `priceSuffix: '+ GST'` deleted from all three paid
  plans. The three render sites are guarded by `plan.priceSuffix &&`, so they
  now render nothing; no component changes were needed.
- `LandingPage.jsx` — "Prices in INR, exclusive of GST." → "Prices in INR."
- `PricingPage.jsx` — "Prices exclude GST" clause dropped.

**Prices are now shown flat, exactly as charged**, which is true whichever way
the tax question resolves. No GST wording remains anywhere student-facing.

**This does not settle the tax treatment.** If the company is GST-registered and
the education exemption does not apply, ₹399 is GST-*inclusive* and real revenue
is about ₹338 — a pricing decision that is still open, and now sits with whoever
configures the real GSTIN in the billing app (currently the placeholder
`YOUR GSTIN`).

---

## ~~BLOCKED ON A CA~~ (SUPERSEDED by the redirection above) — local GST invoicing

Admin → Students → **Billing** is live: every payment attempt, newest first,
with collected total and abandoned-checkout count. `admin_list_payments`
(`20260813010000`) + `src/admin/AdminBilling.jsx`. **It is a payment log, and the
screen says so** — no invoice number, GSTIN, tax breakup or place of supply.

### Three answers needed before pieces 2-5 are worth building

**I am not a tax adviser and this needs a CA, not a second opinion from me.**
Wrong-format invoices issued at scale are worse than none, and the answers change
*what gets built*, not just when.

1. **Are you GST-registered?** The threshold is ₹20 lakh turnover for services
   (₹10 lakh in special-category states). **Below it you must not charge GST or
   issue tax invoices at all** — the correct artefact is a *bill of supply*.
   Building an invoice generator first would build the wrong thing.
2. **Does the education exemption apply?** It covers recognised institutions
   delivering curriculum leading to a recognised qualification. A private
   exam-prep app very likely **does not qualify**, which puts it at **18%**. If
   so, the current ₹399 is GST-*inclusive* and real revenue is about ₹338 — a
   pricing decision, not only an invoicing one.
3. **Place of supply.** For B2C online services it is the recipient's location,
   which decides CGST+SGST vs IGST per transaction. **No student's state is
   captured anywhere today.**

### What already exists, and the trap in it

- **`payment_orders` is the ledger** — `order_id` PK, one row per order, kept
  forever. Written by `create-razorpay-order`.
- **`subscriptions` is NOT a ledger.** It upserts `on conflict (user_id)`, so a
  renewal **overwrites** the previous `razorpay_payment_id` and `amount_paid`.
  Anything billing-related built on it silently loses all but the latest payment.
- **Zero payments exist so far** — `create-razorpay-order` is undeployed and
  `payments_enabled` is off. Nothing to backfill, and the schema can still be
  changed freely. This is much cheaper now than after real money moves.

### Razorpay does not give you this

- Its **payment confirmation email is a receipt, not a GST tax invoice** — no
  GSTIN, HSN/SAC, tax breakup or sequential number. It does not satisfy Rule 46.
- The **"Tax Invoices" in the Razorpay dashboard are Razorpay's invoices to
  you**, for their fees. Wrong direction.
- The **Invoices API is invoice-then-collect**, designed to request payment. This
  app uses Checkout, where payment comes first, so using it means creating a paid
  invoice retroactively against the product's grain.

Verdict: **build it, don't pull it** — but re-check their current docs first,
since this assessment has a knowledge cutoff and Razorpay ships features.

### Rule 46 requires (for when it goes ahead)

Supplier name/address/GSTIN · **consecutive serial number, unique per financial
year, ≤16 chars** · date · recipient name/address (+GSTIN and state code if
registered) · HSN/SAC · description, taxable value, discount · tax rate and
amount split CGST+SGST or IGST · place of supply + state code · reverse-charge
flag · signature.

### Plan, pieces 2-5 — roughly 3-4 days

| # | piece | notes | est. |
|---|---|---|---|
| 2 | schema | `invoices` table; **gapless per-FY numbering via a locked counter, NOT a Postgres sequence** — sequences gap on rollback and Rule 46 wants consecutive; billing profile on users incl. **state code** | 0.5-1d |
| 3 | generation + GST logic | **snapshot supplier details onto each invoice**, never join live: a GSTIN change must not rewrite last year's invoices. CGST/SGST vs IGST by state | 0.5-1d |
| 4 | PDF | see below | 1-2d |
| 5 | email + resend | `send-email` exists and uses Resend, which supports attachments — but the function does not implement them yet. Add attachments, an admin resend action, and an audit row per send | 0.5d |

**PDF is NOT already solved in this codebase** — a note, because it was assumed
to be. `PaperModePage.jsx` uses `@media print` + `window.print()`; there is no
`jsPDF`, `pdf-lib` or `@react-pdf`. `pdfjs-dist` and `pdf-proxy` *read* PDFs.
Three routes: HTML + browser print (zero deps, weakest UX, ~0.5d); a client-side
library (real download, new dep, ~1-1.5d); or server-rendered via headless
Chromium — **Playwright is already a devDependency and `og-image.mjs` renders
HTML to an image**, so there is direct precedent, but it cannot run in a Supabase
Edge Function and would need somewhere else to live.

---

## ⏰ 14 AUGUST — re-enable payments (2026-08-11)

Payments are gated behind the `payments_enabled` feature flag, seeded **OFF**.

### To turn payments back on

> **Admin → Platform → Feature Flags → `payments_enabled` → ON**

That is the whole procedure. No deploy, no code change, takes effect on the
student's next page load (flags are cached per session).

**Before you flip it, confirm both of these**, or checkout will fail exactly as
it does today:

1. **The bank account is live in Razorpay.**
2. **`create-razorpay-order` is deployed.** It is currently in source but *not*
   deployed and returns HTTP 404 — verified against production on 2026-08-11.
   Check with `npx supabase functions list`, deploy with
   `npx supabase functions deploy create-razorpay-order`.

Item 2 is the one most likely to be missed. The flag being ON with that
function still missing puts the site back to the broken state this work removed.

### If the toggle is not in the admin panel

The panel lists rows that exist in `feature_flags`. If the migration has not
been applied, there is no row and therefore no toggle. Either apply it:

```bash
npx supabase db push        # 20260811120000_payments_enabled_flag.sql
```

…or insert directly:

```sql
insert into public.feature_flags (key, enabled, description)
values ('payments_enabled', false, 'Master switch for Razorpay checkout.')
on conflict (key) do nothing;
```

**Blocking does not depend on the row existing** — a missing flag reads as
`false`, so payments stay off either way. The row only matters for being able to
turn them back *on* from the UI.

### What a student sees while it is off

- **Pricing page** — an amber "Payments open on 14 August" notice; paid plans
  read "Opens 14 August" and are not clickable. The free plan is untouched.
- **Paywall modal** (shown on hitting a quota wall) — the same notice plus a
  "Keep using the free plan" button, with the plan list still visible.
- **Nothing is charged, and no Razorpay script loads.**

---

## OPEN — three SEO items need you, not me (2026-08-11)

### 1. Apply the nginx 404 block — needs a maintenance window

Until this is applied, **the site answers HTTP 200 to every path that does not
exist**. The React 404 page ships with the next normal deploy and fixes the UX,
but the status code can only come from the server.

`deploy/nginx-easewithexam.conf` is generated and ready. Full procedure,
including the `nginx -t` gate and the four verification curls, is in
`docs/DEPLOY.md` under "One-time — the nginx change that makes 404s real".

**Risk if done carelessly:** a wrong `try_files` 404s the entire site. Back up
the vhost first and never reload without `nginx -t` passing. Note the conf is
generated from `src/App.jsx` — if a route is ever added, run
`npm run nginx:routes` and reapply rather than hand-editing the server.

### 2. Confirm the sitemap is submitted in Search Console

You said the property is already verified. Worth confirming the sitemap is
actually submitted, since nothing in the repo can check it:

> Search Console → your property → **Sitemaps** → enter `sitemap.xml` → Submit

While there, read **Pages** (previously "Coverage"). It will tell you how many
of the five public URLs Google currently has indexed. That number is the honest
baseline for whether any of this worked, and I could not obtain it — GSC data is
not reachable from the repo. If it reads 1, that is consistent with the canonical
bug that was just fixed, and it should climb once the fix is deployed.

Re-submit the sitemap after deploying, since `lastmod` changed.

### 3. Decide on analytics

No vendor is wired — `src/lib/analytics.js` is a working no-op with both paths
documented. Search Console gives you queries and impressions; it does **not**
tell you whether anyone who lands stays. Pick one when you want that:

- **GA4** — free, links to Search Console, but sets cookies and so has to be
  gated behind the existing consent banner.
- **Plausible** — ~1KB, no cookies, no consent gate needed, ~$9/mo.

Set `VITE_GA4_ID` or `VITE_PLAUSIBLE_DOMAIN` and fill in `initAnalytics()`.

### Not done, deliberately — the two things that actually cap rankings

Recorded so they are not mistaken for oversights. Both are Tier 2, both are real
projects, and neither should be rushed before launch:

- **The site serves a blank page to crawlers.** Pure client-side React; a
  Googlebot fetch returns `<div id="root"></div>`. Needs prerendering.
- **There is almost nothing to index.** Five public URLs. Every study note,
  syllabus chapter and PYQ is behind auth. This caps rankings harder than
  rendering does — metadata cannot make pages that do not exist rank.

---

## RESOLVED 2026-08-11 — 10 stale Class 8 Mathematics syllabus rows deactivated

**Owner's decision: deactivate, don't delete.** Reversible was the right call
this close to launch — no reason to destroy data when a flag does the job.

`node scripts/deactivate-stale-c8-maths-syllabus.mjs` set `is_active = false` on
the ten rows below. **Class 8 Mathematics is now 26 rows, 16 active**, and the
active set is exactly the set of chapter names the corpus uses — verified both
directions, zero active rows without corpus and zero corpus chapters without an
active row. The 16 are the book's 14 real chapters plus the 2 section-level
names from the duplicate Chapter 1 ingestion (below), kept active so their
chunks are not orphaned.

To undo: `node scripts/deactivate-stale-c8-maths-syllabus.mjs --reactivate`.
**Note the deactivated rows do not appear in Admin → Syllabus**, which filters
`is_active = true` — reversal is via the script, not the UI.

`c8_cubes_and_cube_roots` was deliberately left active: it looks like an
eleventh old-book row, but 3 chunks really do carry that name.

### The ten rows, for the record

CBSE Class 8 Mathematics had 26 `syllabus_nodes` rows for what is really a
14-chapter book. 15 are the new *Ganita Prakash* chapters that the 427 loaded
chunks actually use. The other 11 predate this work and are the **old** NCERT
Class 8 Maths chapter list. Ten of them had **zero corpus behind them**:

> Rational Numbers · Linear Equations in One Variable · Understanding
> Quadrilaterals · Practical Geometry · Data Handling · Squares and Square
> Roots · Algebraic Expressions and Identities · Mensuration · Introduction to
> Graphs · Playing with Numbers

**Why this is not cosmetic.** `syllabus_nodes` is the closed vocabulary that
Content Intake snaps every extracted chapter name onto. A Class 8 Maths PYQ
whose AI-guessed chapter was "Mensuration" would snap cleanly onto a row that no
`knowledge_base` chunk uses — so the question is filed under a chapter with no
retrievable content, and nothing reports the mismatch. Several stale names are
near-synonyms of real ones ("Squares and Square Roots" vs "Understanding
Perfect Squares", "Understanding Quadrilaterals" vs "Quadrilaterals", "Playing
with Numbers" vs "Number Play"), which made a wrong snap more likely, not less.

Deactivation genuinely closes that path rather than being cosmetic:
`getChapters()` filters `.eq('is_active', true)` (`src/lib/syllabus.js:43`), and
it feeds Content Intake's snap list (`AdminContentIntake.jsx:357`), question
generation (`questionGen.js:1042`), the student chapter list
(`useSyllabusChapters.js`) and the Content Map (`AdminContentMap.jsx:210`).

### STILL OPEN — two corpus problems in the same area

- **Class 8 Maths Chapter 1 is ingested twice** — once cleanly (25 chunks) and
  once under a bare `file:` source (14 chunks, split into 3 chapter names). The
  two extra names, "Understanding Perfect Squares" and "Cubes and Cube Roots",
  are active syllabus rows because excluding them would orphan their chunks.
  Fixing this properly means de-duplicating the corpus, not editing the syllabus
  — after which those two rows should be deactivated too, taking Class 8 Maths
  to its true 14.
- **Class 11 Chemistry has only 9 chapters** for 576 chunks — short of a full
  Class 11 syllabus. Worth checking which textbook files were loaded.

---

## NEET PYQ bulk load — file audit, decisions, and judgment calls (2026-08-10)

Every one of the 20 PDFs in `easy with exam/PYQ/` was **opened and identified**,
not trusted by filename. md5 for exact duplicates, first/middle-page text for
subject and year, chars-per-page for text-layer usability. The manifest in
`scripts/bulk-load-pyq.mjs` is explicit for this reason — globbing the folder
would have double-loaded.

### The three unnamed / duplicated groups you flagged

| file | what it actually is | decision |
|---|---|---|
| `2393a308-…`, `…(1)`, `…(2)` | **all three byte-identical** (md5 `ac4a0bb1…`). NEET **2024**, Test Booklet Code G, 200 Qs, **all subjects**, clean text layer (2,715 ch/pg) | load **one**, skip the other two |
| `c9b2c6eb-…` | NEET **2025 [Code-45]**, 180 Qs + solutions, all subjects, 2,781 ch/pg | load |
| `original (2)/(3)/(4)` | NEET **2026** (held 3 May 2026) — Physics / Chemistry / Biology respectively | load all three |

### JUDGMENT CALL — combined papers supersede four scanned per-subject files

`2024+Bio` (78 ch/pg), `2024+Chemistry` (311 ch/pg), `Physics …Code-45`
(84 ch/pg) and `Chemistry …Code-45` (42 ch/pg) are **scans of the same exams**
the two combined papers already carry with a clean text layer. Loading both sets
would duplicate every question in them.

Decided: **skip the four scans, use the combined papers.** This also avoids ~28
vision calls, and the combined papers additionally supply the **2024 Physics** and
**2025 Biology** sections, which have no named file at all. Risk accepted: NEET
paper codes reorder questions but do not change them, so no distinct question is
lost by preferring one code over another.

### RESOLVED 2026-08-10 — NEET 2024 keeps its questions, without answer keys

**Owner decision: Option 1 — leave 2024 as-is.** Its 198 questions and chapter
attribution stay; `correct_answer` stays NULL for all of them. Nothing depends on
2024's keys: Blueprint V2 needs chapter distribution, not answers, and it already
passes on all three subjects. The other five years supply 923 real keys.

**Options 2 and 3 below are a post-launch nice-to-have, if time allows.** Neither
is blocking, and neither should be attempted during launch week — Option 2
deletes 198 good rows before it re-creates them.

`2393a308-…` turned out to be a **question-only test booklet**: 2 "Ans" markers
in 66,276 characters, no answer-key section, no solutions. Its 198 questions and
their chapter attribution are good (197/198 snapped, subject split 50/48/100
matching NEET's real structure) — but it cannot supply answers.

The extractor nonetheless returned 45 `correct_answer` values. **They were not
read from a key; they were inferred**, and it shows: the distribution contained
option *text* rather than letters — `"Succinyl-CoA → Succinic acid"`,
`"( ) 2 1 x kcalm yr − −"`, `"A - IV , B - I , C - II, D - III"` — with zero
explanations, and Chemistry produced none at all.

**All 198 were set to `correct_answer = NULL`.** This project has already
measured 10% hard-wrong keys from model inference, and a wrong key marks a
correct student wrong *and* corrupts their `weak_topics` diagnostics. An honest
null is strictly better.

**The open question, for you:** the two skipped 2024 files
(`2024+Bio Paper With Answer and Solution`, `2024+Chemistry Paper With Answer and
Solution`) are scans whose titles claim answers **and solutions**. Loading them
would supply real keys for ~148 of the 198 — but they cover only Chemistry and
Biology, and they carry the same questions already loaded, so loading them
naively **duplicates** those questions and skews Blueprint V2's chapter
weighting.

**POST-LAUNCH, OPTIONAL — how 2024's keys could be recovered later:**

1. ~~**Leave it.**~~ **← chosen.** Zero risk, zero work.
2. **Replace the 2024 load.** Delete the booklet rows; load 2024 Chemistry and
   Biology from the named scans (real keys), and 2024 Physics from the booklet's
   Physics pages alone — `pageRange` supports this (`[2, 7]`). ~30 vision calls,
   ~15 min. Physics still ends up with no key, since the booklet is its only
   source.
3. **Verify before committing to 2.** Load one named 2024 scan under a throwaway
   `source` and check whether its key actually survives OCR. ~13 vision calls.

If this is ever picked up, do **3 before 2** — the titles claim answers, but they
are scans and the keys have not been confirmed legible. Option 2 without that
check risks deleting 198 good rows and getting nothing back.

### No 2018 papers are present

You mentioned 2022 and 2018. The folder holds **2021, 2022, 2023, 2024, 2025 and
2026** — there is no 2018 file. Nothing was dropped; it simply is not there.

### JUDGMENT CALL — PYQ batching resized twice, from measurement (affects CBSE too)

`PYQ_BATCH_CHARS` **12,000 → 5,000**, `PYQ_MAX_TOKENS` **5,000 → 6,000**.

**First cut (12,000 → 9,000)** came from NEET density: 515 bytes/question output,
366 source chars/question at the densest. It also materially improved recall,
which was not the intent — **2021 Physics went from 37 questions to 50**, the
paper's true count, so the old batch size had been silently losing ~26% of
questions on this shape.

**Second cut (9,000 → 5,000, cap 5,000 → 6,000)** came from a real failure, not a
projection: 9,000 threw the truncation guard on 2021 Biology batch 2/4. That
batch carried ~25 questions and blew past 5,000 output tokens, so **Biology runs
200+ tokens/question** — the earlier ~130 figure came from Physics and Chemistry,
whose stems are short and options symbolic. Biology stems and explanations are
prose, and prose is where the estimate broke.

Sized against the worst case actually observed (220 tokens/question): 5,000 chars
→ ~16 questions → ~3,560 tokens against a 6,000 cap, 41% clear. `max_tokens` went
*up* despite the TPM cost because this guard throws the whole **file**, not one
batch — that asymmetry is worth ~1 call/min. Net ~7,250 tokens reserved per call,
about 4 calls/min against the org's 30,000 TPM.

**Verification method worth reusing:** expected question counts were established
independently by counting question-number markers in each PDF's text layer
(NEET numbers Physics 1-50, Chemistry 51-100, Biology 101-200), giving a real
denominator for coverage instead of trusting the extractor's own count.

### Bug found and fixed mid-run — the branding filter ate real content

`MOTION` and `PW` were in the institute-brand strip list. **"Motion" is a core
physics word.** The first 2021 Physics load came back with *zero* questions
containing it, in a paper whose chapters include "Laws of Motion", "Motion in a
Plane" and "Motion in a Straight Line". Those 37 rows were deleted and the file
re-loaded. The list now carries only unambiguous brand tokens; `PW` and `Motion`
match only alongside app-store chrome (`PW Website`, `Motion Education`).
`BANSAL` was dropped too — it is a surname.

**Institute names are never recorded.** `exam_type` is `NEET`, plus subject and
year; `source` is a synthetic key (`pyq:neet-<year>-<subject>`), never the
filename.

---

## DONE 2026-08-11 — `20260810070000` applied and the client deployed, one window

Migration applied, client deployed, all checks green. **NEET now reads the Class
11 corpus.** Live bundle `assets/index-CrZjys3H.js` (was `index-BiWNyNtH.js`).

Post-deploy verification, against production:

| check | result |
|---|---|
| semantic retrieval works | 5 chunks for a NEET Physics query |
| NEET reaches Class 11 | `exam_types: CBSE Class 11` |
| CBSE Class 10 uncontaminated | `exam_types: CBSE Class 10` only |
| Ask-EWE lookup | 5 chunks |
| student generation, verification NOT firing | `stats.disabled=true`, 0 model calls |
| Exam Center CBSE sections | `{MCQ:17, A-R:2, Short Answer:11}` — matches baseline |

**`answer_verification_off = true`** — semantic verification is deliberately OFF
for launch. Students get option shuffling + the free cross-check (13.3% → 10.3%
served-wrong) but not the verifier's further drop to 7.4%. Toggle in
Admin → Feature Flags to enable; **no redeploy needed**, but flags are cached per
session, so it applies to sessions started after the change. **Note the inverted
sense: `true` means verification is DISABLED.**

Rollback, while it still exists: server backup
`~/deploy-backups/webroot-2026-08-10-192409.tar.gz` (3.4 MB, 287 files), plus
`supabase/rollback/20260810070000_rollback.sql`. Bundle first, then SQL. The KVM
snapshot taken beforehand expires 24h after 2026-08-11.

Procedure now written down in `docs/DEPLOY.md`, including the two failure modes
that bit during this deploy: `tar` exiting 2 on a successful extract, and 199
files landing non-world-readable.

---

## ~~⚠ DO NOT APPLY ALONE~~ (RESOLVED — see above) — `20260810070000_match_kb_exam_type_array.sql`

**Apply this migration and deploy the client in the SAME window. Never one
without the other, in either order.** It is written and tested but deliberately
**not applied**.

### Why applying it alone breaks production

The migration changes `match_knowledge_base`'s `filter_exam_type` from `text` to
`text[]`. A parameter type change cannot be `CREATE OR REPLACE` (42P13), so the
old signature is **dropped**. The live client still sends a bare string for that
argument. Apply the migration without shipping the client and every semantic
retrieval call starts failing on a type mismatch — question generation and the
Ask-EWE knowledge lookup both go through it.

The reverse is equally broken: ship the client without the migration and it sends
an array to a function still declared `text`.

### Safe order

1. Apply the migration (`supabase db push`)
2. Deploy the client build **immediately after**, in the same session

There is a brief window between the two where retrieval is degraded. It is small,
and it is unavoidable given a signature change — but it means this should be done
deliberately, not folded into an unrelated deploy.

### What it is for

NEET/JEE reading the Class 11+12 corpus (Option B, below). Client side is already
written: `src/lib/examMapping.js` plus three call sites (`questionGen.js:662`,
`questionGen.js:727`, `supabase.js:243`). Build passes, 161 tests pass.

**Nothing about the NEET PYQ upload depends on this.** Upload needs
`syllabus_nodes`, which is seeded. This only widens what generation can retrieve.

---

## RESOLVED 2026-08-10 — `study_notes.unit` repeated the chapter title on 81 rows

Applied via `supabase db push` (`20260810060000_clear_self_referential_note_units.sql`)
and verified after the fact: 181 rows unchanged, 179 → 98 with a unit, **81
cleared, the 3 protected rows intact by ID**, 95 genuine-unit rows across 65
distinct unit names untouched. Kept here rather than moved to the changelog only
because the `NOT EXISTS` guard below is a live constraint on anyone editing this
later.

The cosmetic problem: `unit` exists to GROUP notes into a table of contents, so a
unit whose only member is a chapter of the same name rendered as a Study Hub /
Admin accordion section of exactly one item, repeating its own title twice.

Measured against production before writing it: **84 rows had `unit = chapter`,
81 cleared, 3 deliberately preserved.** Those 3 are real NCERT units that
happen to be named after their own opening chapter and have sibling chapters
under them — `Number Play` (CBSE 10 Maths, 3 siblings), `Locomotion and Movement`
(CBSE 11 Biology, 1), `Proportional Reasoning` (CBSE 8 Maths, 1). A plain
`UPDATE ... WHERE unit = chapter` would have evicted those three from units that
genuinely exist, orphaning the intro chapter into "Other Notes" while its
siblings stayed grouped — worse than the cosmetic problem being fixed. Hence the
`NOT EXISTS` guard. **Don't simplify it back down.**

Source of the dirt is `runNotesExtraction`'s prompt ("Unit name if this content
is part of a numbered/named unit, else null") — a bulk-loaded NCERT PDF *is* one
chapter, so the model answers with the chapter title instead of null, and
`scripts/backfill-study-notes.mjs` copies it through, so a future corpus load
would reintroduce it. **Now fixed at source too** — `dropSelfReferentialUnits()`
in that script carries the same sibling guard. Verified against the real 4,363-row
corpus: it clears the same **81** and preserves the rest.

---

## OPEN — Generated question answers are unverified (measured 2026-08-10)

**Severity: high.** Generated questions reach students with no correctness check
of any kind. A wrong answer key doesn't just misinform — the student is marked
wrong for being right, loses the XP, and the result feeds `weak_topics` accuracy,
so a bad key corrupts their diagnostics too.

### What the pipeline does today

A repo-wide search for `verifyAnswer`, `validateQuestion`, `answer_verified`,
`solution_check` and any `verify*`/`validate*` function in `questionGen.js`
returns **nothing**. The only gate is structural (`toEngineFormat`): does the
question have text, and does an MCQ have ≥2 options. **Nothing inspects the
answer key at all.**

Two paths, very different exposure:

| path | flow | review |
|---|---|---|
| **Student** (`PracticeGeneratorPage.jsx:895`) | `generateQuestionPaper()` → `toEngineFormat()` → live quiz | **none** |
| **Admin** (`AdminPaperGen.jsx:1138`) | generate → render → admin clicks Publish | visual only, not required or recorded |

`CONTENT_REVIEW_QUEUE` does **not** cover this — it gates `extractPYQFromKB` and
Content Intake, and is never consulted in `generateQuestionPaper`.

### Measured rate — 30 questions, real pipeline, hand-checked

Generated through the actual `generateQuestionPaper` (Class 10 Mathematics ×15,
Class 11 Physics ×15), every answer verified by hand.

- **10% hard-wrong keys** (3/30) — a correct student is marked wrong
- **10% flawed questions** (3/30) — key defensible but more than one option is correct
- **80% clean** (24/30)

The three wrong keys, which are three *different* failure modes:

| # | question | key | actual |
|---|---|---|---|
| 2 | one zero of `2x² + 7x + k` is 3, find k | −12 | **k = −39**, not among the options at all |
| 3 | hypotenuse² = 400, which two sides? | 20, 15 | 400+225=625 — **no option satisfies a²+b²=400** |
| 14 | mean of 5 is 20, remove one, mean 18 | 30 | its own explanation says "100 − 72 = **28**" |

**Answer-position skew** — a distinct defect from correctness:

```
Class 10 Maths   A=9  B=6  C=0  D=0    ← not one C or D in 15 questions
Class 11 Physics A=6  B=5  C=2  D=2
Combined         A=15 B=11 C=2  D=2  →  50% / 37% / 7% / 7%
```

Always guessing "A" scores ~50%.

### Post-fix re-measurement (same benchmark, 30 fresh questions)

Fixes shipped: key-vs-explanation cross-check (soft flag), option shuffling,
hard-drop on an unparseable key. Re-ran the identical benchmark.

| | before | after |
|---|---|---|
| answer position A/B/C/D | 50% / 37% / 7% / 7% | **33% / 30% / 20% / 17%** |
| hard-wrong keys | 3/30 (10%) | 4/30 (13%) — 1 caught and withheld → **3/28 (11%) served** |
| flagged for review | — | 2/30, of which **1 true positive, 1 false positive** |
| dropped for bad key | — | 0 (all keys parseable this run) |

**Option shuffling works and is the clear win.** The A/B monopoly is gone; a
student guessing "A" no longer scores ~50%. Assertion-Reason ladders and a
"Both A and C" option were correctly left unshuffled by the ordered-options
guard.

**The cross-check does NOT measurably reduce the wrong-key rate**, and the
earlier claim that it would catch the Q2/Q3/Q14 failure modes was wrong — it
only catches the Q14 class, where the key disagrees with its own explanation.
Post-fix evidence:

- **Caught (true positive):** *"flywheel at 1200 rpm, angular speed?"* — key
  `20π`, explanation correctly derives `2π × 1200/60 = 40π`. Withheld from the
  student path.
- **False positive:** *"right triangle, one angle is 45°, the other is?"* — key
  `45°` is correct, but the explanation only mentions 180 and 90, so they share
  no number. A good question was withheld.
- **Missed (the dominant mode):** *"10th term of AP 2, 5, 8"* — key `31`,
  explanation states `2 + 9 × 3 = 31`, which is arithmetically false (=29).
  Explanation and key agree with each other and are both wrong, so no
  logic-only check can see it. Same for a cylinder volume keyed `231` when
  `πr²h = 198`.
- **Missed via partial overlap:** scale-factor question keyed "increase by 1/3"
  with an explanation saying "4/3" — the shared digit `3` satisfied the check.

Net: the cross-check has ~50% precision and catches roughly a quarter of wrong
keys, at the cost of withholding some sound questions. It is worth keeping
because it is free, but **it does not close this gap.** Closing it needs
semantic verification (second-model pass or symbolic evaluation).

### Still open after the 2026-08-10 fixes

- **Numericals are unmeasured.** That benchmark run produced 28 MCQ + 2
  Assertion-Reason and **zero Numericals**, so the category with no structural
  filter whatsoever was never exercised. A separate ad-hoc test did produce a
  wrong numerical answer (20 J stated, 50 J correct). The 10% figure is for MCQs;
  numericals are plausibly worse and remain unquantified.
- **Semantically wrong keys that agree with their own explanation** (Q2, Q3
  above) are not caught by logic-only validation — the explanation is internally
  consistent and simply wrong. Catching these needs either a second-model
  verification pass or symbolic evaluation, both of which have their own cost and
  error rate.
- **Admin publish still records no reviewed state.** `handlePublish` re-runs
  `toEngineFormat` and ships; there is no "an admin actually checked this" flag.

### SHIPPED 2026-08-11 — semantic verification is live on both student paths

`src/lib/answerVerification.js`. A second gpt-4o pass re-solves each generated
question from scratch; disagreements set `needs_review`, which the student paths
drop. Wired into `PracticeGeneratorPage` **and** `backgroundGeneration.js` — the
latter was a pre-existing gap, a student path that published straight to the
student and had never filtered `needs_review` at all.

Opt-OUT flag `answer_verification_off`: a missing flag row reads as false, so the
safety check stays on by default and can be disabled without a deploy.

**Measured, both types, hand-adjudicated:**

| | MCQ (30) | Numerical (34) |
|---|---|---|
| wrong keys generated | 4 (13.3%) | 5 (14.7%) |
| served-wrong, no checks | 13.3% | 14.7% |
| served-wrong, cross-check only | 10.3% | **14.7%** |
| served-wrong, **both (ships now)** | **7.4%** | **6.9%** |
| recall / precision | 50% / 67% | 60% / 60% |

**The cross-check is structurally blind to numericals** — it compares the keyed
OPTION against its explanation, and numericals have no options, so it flagged
**0 of 34**. Before this, numericals had no validation of any kind.

**The projected ~75% combined recall did not hold — measured 50-60%.** Both MCQ
misses were cases where the verifier agreed with a wrong key, including one where
the correct option was present and the explanation stated the right value
(`p(1)=0` keyed as `1`). The remaining wrong keys are real and still reach
students at ~7%.

### PARKED (post-launch, NOT before 14 Aug) — the residual ~7% served-wrong rate

**Owner decision 2026-08-11: do not attempt before launch.** This needs a
different approach, not more tuning of the current one, and it is genuinely
bigger scope than a pre-launch fix.

Verification roughly halves the wrong-key rate (13.3% → 7.4% MCQ, 14.7% → 6.9%
Numerical) but does not close it. Every observed miss shares one shape: the
verifier re-derives, reaches its *own* wrong answer, and that answer happens to
agree with the wrong key. Adding a third model pass would share the same failure
mode and is not expected to help.

**Why symbolic evaluation is the candidate.** All 4 MCQ wrong keys were Class 10
**Mathematics**; all 15 Class 11 Physics conceptual items were correct. The
numerical misses were arithmetic too (an equilibrium concentration off by ~2x, a
de Broglie mass the explanation itself contradicted). The errors live in the
algebra/arithmetic subset, which is exactly the part a CAS can check
deterministically rather than probabilistically — a genuinely different failure
mode from "ask a model".

Rough shape if picked up: detect questions whose answer is a closed-form
numeric/algebraic expression, re-evaluate the explanation's own working
symbolically, and flag when it disagrees with the key. Non-trivial: parsing
LaTeX working reliably is its own project, and it only covers the subset.

**Do not start this before 14 Aug.**

### PARKED (post-launch) — Numerical questions are sometimes ill-posed for their own type

Distinct from a wrong key. Observed in the 34-question numerical run:

- *"Find the particular solution of dy/dx = 3x² if y(1) = 5"* — the answer is a
  FUNCTION (`y = x³ + 4`); the key stores `4`, the integration constant.
- *"Probability of at least one boy in 3 children"* — the true answer is `7/8`;
  the key stores `7`, with the explanation calling it "the integer
  representation". A student entering `0.875` is marked wrong.

Both are questions whose answer is not a single number being generated as a type
whose answer must be a single number. Worth a prompt constraint on the Numerical
type guide.

**Owner decision 2026-08-11: parked for post-launch.** It changes generation
behaviour, and the verifier already withholds the worst of these (the 7/8-keyed-
as-7 item was caught).

### PARTLY FIXED 2026-08-11 / rest PARKED — CBSE ignoring the caller's `qTypes`

**Shipped (`0e5a9c2`), verified live:**

1. `generateQuestionPaper` no longer overrides `qTypes` for CBSE-style exams.
   The five-section set is now the DEFAULT when no selection is supplied, not a
   substitute for one that was.
2. `ExamCenterPage` resolved types with `EXAM_QTYPES[examType]`, but that map is
   keyed by board (`'CBSE'`) and class (`'Class 10'`) while real values are the
   combined `'CBSE Class 10'` — so it **missed and fell back to `['MCQ']`**.
   Invisible while the generator ignored `qTypes`; with change 1 it would have
   collapsed every Exam Center CBSE paper to MCQ-only. Now resolved via
   `defaultQTypesFor()` in `examPattern.js`, unit-tested.

**Still open — filter `buildSectionMarksInstructions` by selected type.**

A narrow selection is honoured at some paper sizes and not others:

| count | MCQ-only selection, CBSE Class 10 |
|---|---|
| 5, 10, 45 | clean |
| 20 | `{MCQ:18, Assertion-Reason:2}` |
| 30 | `{MCQ:18, Assertion-Reason:2, Short Answer:10}` |

Not a tunable threshold — it is two prompt instructions fighting.
`buildSectionMarksInstructions` (questionGen.js ~632) emits, for CBSE:

> `SECTION → MARKS mapping (MANDATORY — every question MUST include section and marks, matching this EXACT structure — N questions total)`

listing Sections A–E. So the prompt says "MCQ only" *and* "produce this exact
five-section paper", and which one wins varies by size and by run.

**Owner decision 2026-08-11: parked for post-launch.** It edits the structure
that makes a CBSE paper a valid CBSE paper — a different risk class from the two
changes above — and the residual behaviour is a UX annoyance, not a correctness
or safety bug.

If picked up: filter the block's `entries` to sections whose type is in
`effectiveTypes` (infer from the section name — `/mcq/`, `/assertion/`,
`/short/`, `/long/`, `/case/`), and fall back to the unfiltered block when
nothing matches, so a bad inference degrades to today's behaviour.

**One known delta from this partial fix, measured as immaterial.** Exam Center
now passes four types (MCQ, Assertion-Reason, Short Answer, Long Answer) where
the old hardcoded list also contained `Case-Based`. The CBSE pattern still has
`Section E (Case-Based)` and the mandatory section block still demands it, so the
structure is unchanged — only the type-guide description is absent. Neither the
before nor the after run produced a Case-Based question at count=30, so no
difference was observed. Adding `'Case-Based'` to the CBSE/`Class N` entries in
`EXAM_QTYPES` would restore exact parity and is a one-word-per-entry change —
deliberately not done here because it would alter what was live-verified.

### PARKED (post-launch) — Admin Paper Gen does not run verification

Both student paths verify. Admin > Paper Gen stores raw questions in state and
only calls `toEngineFormat` at publish/preview time, so wiring verification there
means mapping flags back onto the raw list by index — a restructure of an admin
screen, not a one-liner. An admin therefore publishes without the verifier's
opinion, even though that is exactly the human-review moment where it would help
most.

**Owner decision 2026-08-11: parked for post-launch.** Lower urgency than the
student paths, which are covered — an admin is at least looking at the questions.

### Original scoping note (kept for the numbers it recorded)

#### PARKED: semantic verification — measured, costed, ready to wire in

Prototyped against the same 30 questions and scored on the 4 hand-verified wrong
keys. One `gpt-4o` call per question: re-solve from scratch, then compare.

| | gpt-4o | gpt-4o-mini |
|---|---|---|
| tokens/question | 146 in, 40 out | 146 in, 45 out |
| median latency | **1.34 s** (p90 1.67 s) | 1.37 s |
| caught of 4 known-wrong | 2 | 2 |
| false positives | **1** | 3 |

- **Cost ≈ $0.0008/question (~8¢ per 100)** at ~$2.50/1M in + $10/1M out —
  confirm against current OpenAI pricing before relying on it.
- **Runs at generation time, comfortably.** Generating 15 questions already takes
  52–119 s; verification is ~1.3 s/question and parallelises, so 15 questions at
  concurrency 5 is ~4 s — under 5% added wall-clock, and 186 tokens × 15 is
  nothing against the 30,000 TPM ceiling. Failures can be flagged `needs_review`
  and filtered by the machinery already shipped in session 17.
- **Use gpt-4o, not mini** — identical recall, three times the false positives.
- **Recall is only ~50% alone**, and the verifier is itself wrong at roughly the
  generator's rate (it insisted `a = 30 m/s ÷ 10 s` was 5 m/s²). But it is
  **complementary** to the free cross-check, which caught the flywheel item the
  model missed: **combined recall ≈ 75%**, at the cost of ~2 sound questions
  withheld per 30.
- **Effort: ~40 lines and about an hour**, reusing `needs_review` and the student
  path filter.

**Parked deliberately** (2026-08-10) because there are no real students yet —
the platform is still dev/testing. **Revisit before any real student launch:** an
11% wrong-key rate on a path that awards XP *and* writes `weak_topics` accuracy
teaches the platform to recommend the wrong revision topics, and that error
compounds silently.

### Decision still needed from the owner

Whether the student practice path should be gated behind reviewed content, or
continue serving unreviewed generated questions with the validation now in place.

---

## PARKED (post-launch) — geometric figure cropping: audited, premise corrected, plan ready

Audited 2026-08-10, **deliberately not started** — parked behind launch. Read this
before picking it up, because the audit **disproved the plan that was written
down** in `src/lib/pdfVision.js:71-73` and `CHANGELOG` ("derive figure rectangles
by tracking the CTM through `paintImageXObject`"). That approach finds nothing on
this corpus. The replacement is below.

Why it matters: today `CROP_FROM_MODEL_BBOX = false`, so every figure's image is
the **whole page**, shared by every figure on it. That was the right call (5 of 5
model bboxes were materially wrong) but it is coarse, and tight per-figure crops
are what a curated figure library actually needs.

### Finding 1 — `paintImageXObject` finds ZERO figures. The documented plan fails.

Every NCERT page paints exactly two rasters, and **neither is a figure**:

| raster | rect (normalised) | what it is |
|---|---|---|
| `img_pN_1` | `{x:-0.012 y:-0.05 w:1.024 h:1.1}` | full-bleed page background |
| `img_pN_2` | `{x:0.096 y:0.246 w:0.782 h:0.594}` | the diagonal "© NCERT not to be republished" watermark |

Both repeat to 4 decimal places on **every** page — which is also the cheap
discriminator for furniture. The real figures are **vector line art**, invisible
to every `paintImage*` op. Verified by rendering pages in a real browser and
drawing the derived rects over them, not by counting ops.

### Finding 2 — the right source is `constructPath`, and pdfjs 6 hands it over free

`constructPath` args in pdfjs 6 are `[opsFlags, coords, minMax]`, where `minMax`
is a `Float32Array [minX, minY, maxX, maxY]` in **user space** — a per-path
bounding box at no cost. `CTM x minMax` gives the exact page rect. The CTM walk
itself (`save`/`restore`/`transform`, seeded from `viewport.transform`) is
straightforward and was verified correct.

### Finding 3 — a scratch prototype produced genuinely tight crops

Real NCERT Class 11 Physics ch. 4 (`keph104.pdf`):

| page | result |
|---|---|
| 5 | 1 candidate — **tight, correct crop of Fig 4.3** (cricketer), no false positives |
| 7 | 2 candidates — **tight, correct crop of Fig 4.5** (train), **+1 false positive** (stacked display equations) |

Against the model bboxes' **0 for 5**. The false positive is a characterisable
class, not random noise.

### Finding 4 — naive clustering fails, and the fix is the whole trick

The first prototype merged the **entire page into one cluster**: an equation's
fraction bar, a tinted callout border and a table rule each sit within the merge
gap of the next thing, so the union walks the whole column. What made it work was
pre-filtering the *bridging* paths **before** merging:

- a path whose own box is mostly covered by glyphs is **inside a line of text**
  (fraction bars, underlines) — not a figure
- hairline rules (long, ~0 tall) and vertical rules
- anything ≥85% of the page (furniture)

Merge gap must stay small (~1.2% of page width): NCERT is two-column and a
generous gap jumps the gutter and unions both columns into one "figure".

### Finding 5 — scanned PDFs degrade correctly

`_pilot/scanned-paper.pdf`: one raster covering the page, zero paths. Geometry
yields exactly one whole-page rect — i.e. today's behaviour. **No regression
risk on scans.**

### Proposed plan (~1 day)

**Step 0 — widen the sample first (~1h).** Two pages of one Physics chapter is
not enough to set thresholds. Sample across Maths / Science / Biology and score
by *looking* at the crops. This is the step that caught the last failure.

**Step 1 — new `src/lib/pdfGeometry.js` (~3–4h).** Pure and unit-testable, no
canvas needed (operator list + text layer only). Raster and vector sources,
cross-page repeat detection for furniture, the text-aware pre-filter, then
clustering.

**Step 2 — pair geometry WITH the model, don't replace it (~2h).** The measured
evidence says the model is reliably right about *how many* figures there are and
*what* they show (captions were consistently accurate) and unreliable about
*where*; geometry is exactly the reverse. So match the model's figure list onto
the geometric candidates and crop from the matched rect, falling back to the page
image when there is no confident match. Behind a new `CROP_FROM_GEOMETRY` flag,
default off. `CROP_FROM_MODEL_BBOX` stays off permanently.

**Step 3 — pilot, look at every crop, then decide the default (~1h).**

### Known risks

Display-equation false positives; the two-column gutter; Hindi and non-STEM PDFs
were not audited at all. Scans are safe (Finding 5).

---

## BLOCKED — the PYQ bulk loader is NEET-only; the 9 ready Kerala files cannot go through it

Stopped here deliberately on 2026-08-12 rather than rushing the change.

`scripts/bulk-load-pyq.mjs` is not exam-type agnostic. Four things are
hardcoded to NEET:

| line | hardcoded |
|---|---|
| `PYQ` const | `easy with exam/PYQ` — the Kerala files are in OneDrive `Question Paper/Model 10th PYQ/...` |
| `processFile` | `extractPagesWithVision(buf, { examType: 'NEET' })` |
| `savePYQRows` | `examType: 'NEET'` |
| `source` | `` `pyq:neet-${year}-${subject}` `` |

Run as-is, the 9 Kerala files would be saved as **NEET** questions with a
`pyq:neet-*` source. That is worse than not loading them.

**The fix is mechanical, not ambiguous** — move `examType` and the corpus dir
into the job manifest / env, derive `source` from `examType`, keep every default
identical so the NEET path is untouched. ~30 lines. It was NOT done tonight
because it is real surgery on the only loader that works, and doing it on a
thin context budget and then running an unattended token-spending production
load is exactly the pattern that produced tonight's other incidents.

**Prerequisites already in place** — nothing else blocks the 9 files:
- `Kerala State Class 10` syllabus_nodes seeded (18 nodes, Part 1)
- `PARTIAL_SYLLABUS_EXAM_TYPES` keeps the closed list off for Kerala
- The 9 files have clean text layers (no vision cost) and are English medium

**Do not use `--reset`** when picking this up: all 14 NEET jobs are checkpointed
and re-running them would duplicate the entire NEET corpus.

---

## ⏭ HANDOFF — load ALL non-STEM subjects (372 files). Stage A done, B next.

Priority as of 2026-08-12. **Stage A (taxonomy) is complete and tested; not
committed, neither migration applied, nothing loaded.** Resume at
Stage B. Full narrative in `docs/CHANGELOG.md` (session 29).

### ✅ Stage A — decided and built (2026-08-12)

Owner approved all three recommendations:

1. **`book` as a nullable column on `syllabus_nodes`, NOT folded into `subject`.**
   Uniqueness is carried by a book-scoped `chapter_key` (`chapterKeyFor()` in
   `src/lib/syllabus.js`), because `book` is nullable and Postgres treats NULLs
   as distinct — putting it in the UNIQUE key would stop that key protecting the
   148 single-book STEM rows. Column for grouping, key for identity.
2. **10 new `content_type` values, not 14** — `concept`, `worked_problem` and
   `comprehension_exercise` dropped as near-synonyms of `definition`,
   `solved_example` and `exercise`. Literature narrative is `literary_prose`,
   never `prose`, so the prose-share diagnostic stays readable.
3. **Hindi A = one book (Kshitij).** ✅ **md5-confirmed in Stage B: 13/13 pairs
   identical.** `KRITHIKA 2/` is a byte-identical copy of `KSHITIJ 2/`, and
   `jhkr` (Kritika's NCERT code) appears nowhere in the 520. Kritika is absent.

4. **Literature granularity applies inside a numbered chapter too.** First Flight
   ch 3 "Two Stories about Flying" contains two distinct stories — *His First
   Flight* and *Black Aeroplane*. Owner decision 2026-08-12: **split into two
   chapter rows**, same treatment as Hornbill's embedded poems (one PDF, two
   lessons), with "Two Stories about Flying" carried as the `unit` for display
   grouping. Consistent with per-text granularity rather than an exception to it.

5. **When a subject is known to be multi-book but only ONE book is present, still
   set `book`.** Class 11 Geography ships only *Fundamentals of Physical
   Geography* (*India: Physical Environment* is absent). Leaving `book` NULL
   would cost a chapter_key rewrite when the second book arrives — and
   chapter_key is what flashcards and the syllabus tracker point at.

Shipped: `20260812040000_syllabus_nodes_book.sql`,
`20260812050000_content_type_non_stem.sql`, `SUBJECT_FAMILIES` /
`familyForSubject()` / `promptGuideFor()` in `src/lib/contentExtraction.js`,
`chapterKeyFor()` + `book` reads in `src/lib/syllabus.js`, 40 tests
(`contentTaxonomy.test.js`). 329 pass, build clean.

**⚠ NOT APPLIED, NOT DEPLOYED.** Apply `20260812040000` *before* deploying the
client — `syllabus.js` selects `book` and PostgREST rejects a select for a
missing column. The reverse order is safe (the old client never asks for it), so
unlike `20260810070000` these do **not** have to ship in one window.

### ✅ Stage B — all 26 books verified (2026-08-12)

Every line below was read from the book's OWN contents page via
`scripts/read-book-contents.mjs`, then **reconciled against the file count**.
No chapter name is web-sourced or inferred from a filename.

| book | `book` label | chapters | files |
|---|---|---|---|
| Hornbill | `Hornbill` | Reading 6 prose + 5 poems · Writing 6 | `kehb101-106,111-116` |
| Woven Words | `Woven Words` | Stories 8 · Poetry 12 · Essays 7 | `keww101-108,111-122,131-137` |
| Introducing Sociology | `Introducing Sociology` | 5 | `kesy101-105` |
| Understanding Society | `Understanding Society` | 5 | `kesy201-205` |
| Psychology | *none* | 8 | `kepy101-108` |
| Fundamentals of Physical Geography | `Fundamentals of Physical Geography` | 14 in 6 units | `kegy201-214` |
| Indian Economic Development | `Indian Economic Development` | 8 in 4 units | `keec101-108` |
| Statistics for Economics | `Statistics for Economics` | 8 | `kest101-108` |
| Political Theory | `Political Theory` | 8 | `keps101-108` |
| Indian Constitution at Work | `Constitution at Work` | 10 | `keps201-210` |
| Themes in World History | *none* | 7 themes in 4 sections | `kehs101-107` |
| Business Studies | *none* | 11 in 2 parts | `kebs101-111` |
| Computer Science | *none* | 11 | `kecs101-111` |
| Informatics Practices | *none* | 8 | `keip101-108` |
| Accountancy | *none* | **9, continuous across Part I/II** | `ACC 1-7` + `keac201-202` |
| First Flight | `First Flight` | 9 (ch 3 splits to 2) + interleaved poems | 9 named PDFs |
| Footprints Without Feet | `Footprints Without Feet` | 9 | `jefp101-109` |
| Words and Expressions II | `Words and Expressions II` | 9 units, 1:1 with First Flight | `jewe201-209` |
| Contemporary India II | `Contemporary India II` | 7 | `jess101-107` |
| Understanding Economic Development | `Understanding Economic Development` | 5 | `jess201-205` |
| India and the Contemporary World II | `India and the Contemporary World II` | 5 | `jess301-305` |
| Democratic Politics II | `Democratic Politics II` | 5 in 4 units | `jess401-405` |

| Poorvi | `Poorvi` | 5 units × 3 texts = **15** | 5 UNIT PDFs |
| Exploring Society: India and Beyond | `Exploring Society: India and Beyond` | 7 in themes A·B·D·E | 7 THEME PDFs |
| Kaveri | `Kaveri` | 8 units, multi-text | 8 numbered PDFs |
| Understanding Society: India and Beyond | `Understanding Society: India and Beyond` | 9 by discipline | 9 numbered PDFs |

**All 26 books read.** The four Class 8/9 books are the NEP-2020 editions
(Poorvi May 2025, Exploring Society July 2025, Understanding Society June 2026),
so none of them matches any pre-2023 chapter list.

#### Class 8 Social — theme/chapter structure confirmed from the index, not assumed

The index reads: Theme A → ch 1 · Theme B → ch 2, 3, 4 · Theme D → ch 5, 6 ·
Theme E → ch 7. Three things follow, and only the first was guessable:

- The `THEME x CHAPTER n` filenames **do** match the index. Verified, not
  assumed — and worth checking, because `KRITHIKA 2/` and `full unit.pdf` are
  both cases where this corpus's names were wrong.
- **Theme C does not exist in this book.** The index jumps B → D. That is not a
  missing file; this is Part 1 and Theme C is in the absent Part 2.
- **Chapter numbering is continuous 1–7 ACROSS themes**, so themes are a `unit`,
  not a `book`. A theme-per-book reading would have restarted numbering and
  invented a collision that the book does not have.

#### Class 9 English has no contents page anywhere — unit names came from NCERT prose

`Kaveri.pdf` is the front matter and prints no contents page; `full unit.pdf` is
an **audio-transcript appendix**, not the book. The 8 unit names were recovered
from that appendix's own headings ("Unit 2 The Pot Maker", …), which is NCERT
text rather than a filename — and it corrects the hand-typed casing
(`CARRIER OF WORDS.pdf` → *Carrier of Words*; `8 Follow that dream.pdf` →
*Follow That Dream*).

Its units are multi-text like Poorvi's. An in-file heading scan finds **22
candidate texts across the 8 units** (each unit is one prose piece plus one or
two shorter pieces, usually poems).

**But that scan is not verification, and Class 9 English should NOT be seeded at
per-text level from it.** Two things went wrong while establishing this, both
worth recording because they are the failure modes of the method itself:

- A **20pt font threshold silently under-counted**, missing a third text in six
  of the eight units. Lowering it to 15pt found them. There is no principled
  threshold — it is tuned against the output, which is the shape of a method
  that will quietly miss things on the next book.
- Classifying a heading as *text* vs *activity section* by the content following
  it **is not reliable**. "Weigh Your Words" was first read as an activity
  heading because the page it sits on opens with a Dumb Charades exercise; the
  content immediately after the heading is verse, so it is a poem. Read from the
  page start it looks like one thing, from the heading like another.

**Recommendation: seed Class 9 English at UNIT level — the 8 names verified from
NCERT's own appendix — and add `CBSE Class 9::English` to `PARTIAL_SYLLABUS`.**
That is exactly what the gate now exists for: the nodes still drive post-hoc
snapping and the chapter pickers, but they do not force the model to file a text
into a chapter list known to be incomplete. The literature lesson rule will
return one lesson per text during the load; reconcile in Stage F and add the
per-text rows from what the loader actually found, rather than from a heading
scan whose threshold was tuned by hand.

It is the only book of the 26 that cannot be fully verified from the corpus.

#### The retired Class 8 English rows were half right

The four rows deactivated last session were *The Wit that Won Hearts*, *A
Concrete Example*, *Wisdom Paves the Way* and *Wit and Wisdom*. Poorvi's index
now shows the first three are genuine texts and the fourth is their **unit**. So
only the unit-as-chapter row was wrong. Seed the full 15 fresh rather than
reactivating three of them — but do not treat all four as junk.

#### ⚠ Class 8 and Class 9 Social are PART 1 only, and the partial-syllabus gate cannot express that

Both ship Part 1; Part 2 is absent. That is the same situation as Kerala, where
`PARTIAL_SYLLABUS_EXAM_TYPES` disables the closed-list rule so the model is not
forced to file Part 2 questions into Part 1 chapters.

**But that set is keyed by `exam_type` alone.** Adding `CBSE Class 8` would also
disable the closed list for Class 8 **Mathematics and Science**, whose syllabi
are complete and correct. The partial-ness here is per *subject*, and the gate
has no subject dimension. Widening it to `(exam_type, subject)` is a small change
to `contentExtraction.js` and its call site — **do it before seeding Class 8/9
Social**, or accept that those two subjects load with the closed list on and
mis-file every Part 2 question later.

#### ⚠ Class 10 History: three chapters exist in the syllabus but NOT in the book

`India and the Contemporary World II` prints five chapters and then says three
more are **QR-code only**, carried over from the previous edition:

> The Nationalist Movement in Indo-China · Work, Life and Leisure ·
> Novels, Society and History

They are not in the book and not in the corpus. **Do not seed them.** This is the
same edition-mismatch that produced the 10 stale Class 8 Maths rows — and every
third-party chapter list on the web still shows all eight.

#### RESOLVED — Words and Expressions II attaches to First Flight (Option 2)

The workbook's 9 units are named **identically** to First Flight's 9 chapters
(Unit 1 *A Letter to God*, … Unit 9 *The Proposal*) because it is exercises on
those texts, not a separate set of texts. **Owner decision 2026-08-12: it gets no
chapter rows of its own** — its content lands on First Flight's chapters as
`content_type: exercise`. The rejected option (its own book rows) was one line of
config and would have shown the student every Class 10 English title twice.

Built properly rather than worked around: `src/lib/corpusMapping.js` resolves any
corpus path to `(exam_type, subject, book)` and carries `attachesTo` +
`contentTypeOverride` for the workbook case, with `workbookUnitFor()` mapping
`jewe20N.pdf` to reader unit N.

**Mapping is ordinal, not by title, and unit 3 is why.** Title matching works for
8 of the 9 and fails silently on unit 3, whose printed title *Two Stories about
Flying* matches **neither** of the two chapter rows it split into. That unit
returns BOTH candidates (`His First Flight`, `Black Aeroplane`) for
`matchSyllabusChapter` to choose between — taking `chapters[0]` would file every
Black Aeroplane exercise under His First Flight.

#### Numbering styles vary, so keys must come from titles

Class 10 History uses Roman numerals (I–V), Class 11 History uses "Theme N",
Words and Expressions uses "Unit N", the rest use "Chapter N". `chapterKeyFor()`
already derives from the title and ignores the numeral, which is what makes this
a non-issue — recorded so nobody reintroduces numeral-based keys.

### ⏸ DEFERRED — all Hindi books (~90 files): the text layer is not Unicode

**Owner decision 2026-08-12: defer Hindi, load everything else.** Revisit with
vision-based extraction when there is room for the token spend.

Every Hindi PDF carries a **legacy Devanagari encoding** (Kruti-Dev family), not
Unicode. pdfjs extracts the glyph bytes faithfully and they are meaningless:

```
jhsy101.pdf  ->  "gfjgj dkdk"      is  हरिहर काका  (Harihar Kaka, Sanchayan ch 1)
jhsp101.pdf  ->  "i| [kaM"          is  पद्य खंड     (Padya Khand, "Poetry Section")
jhks101.pdf  ->  "dkO; [kaM"        is  काव्य खंड    (Kavya Khand, "Poetry Section")
```

This is **not** a scan and not a corrupt file — the glyphs are present, the
character map is not. Nothing downstream can fix it: chapter names, chunk text
and verbatim extracts would all be mojibake, and `matchSyllabusChapter` would
snap real questions onto garbage names.

**Affects:** Class 8 Hindi (11 files), Class 9 Hindi (13), Class 10 Hindi A
(13 after the duplicate is dropped), Class 10 Hindi B (20), Class 11 Aroh (17).

**Three routes, and why 3 is the one to pick up:**

1. ~~Defer~~ **← chosen for now.** Zero risk, unblocks the other ~270 files.
2. **Kruti-Dev → Unicode mapping table.** No token cost, but the mapping varies
   by font and by book, and a wrong mapping produces plausible-looking wrong
   Hindi — the worst failure mode of the three.
3. **`forceVision`.** Reads the RENDERED page, so the encoding never matters.
   Works today with no new code. ~90 files of real token spend, which is the
   only reason it is not being done now.

**Do NOT attempt route 2 casually.** Silent mojibake that looks like Hindi is
harder to detect than the obvious garbage above.

### Where the original design stood (kept for context)

### Where things stand

- `docs/corpus-inventory.csv` — all 520 PDFs, per file: class folder, subject
  folder, sub-path, filename, size. 148 loaded (STEM), **372 unloaded (all
  non-STEM)**.
- `docs/content-index.csv` — what is currently in knowledge_base +
  syllabus_nodes, 441 rows.
- STEM is complete and correct. No STEM gap exists.

### Three complications that must be handled, not worked around

**1. Multi-BOOK subjects vs multi-PART books.** `subjectForFolder()` already
collapses `chemistry part 1` + `part 2` into one `Chemistry` — correct, one book
in two volumes, continuous chapter numbering. But these are DIFFERENT BOOKS for
one subject, each numbering chapters from 1:

```
Hindi A / Hindi B                    (Class 10)
English Hornbill / Woven Words       (Class 11)
Economics: Development / Statistics  (Class 11)
Political Science: Constitution at Work / Political Theory
Sociology / Sociology Understanding Society
Accountancy / Accountancy II
```

Collapsing these to one subject collides chapter 1 with chapter 1.
`syllabus_nodes` is UNIQUE on (exam_type, subject, chapter_key), so two
"Chapter 1" rows silently become one. **A `book` dimension is needed** — either
a column, or fold it into chapter_key (`c11_hornbill_01_*`). Prefer a column:
chapter_key is already load-bearing for matchSyllabusChapter.

**2. "English" is 3-5 reader types per class.** Class 10 has First Flight
(literature), Footprints Without Feet (supplementary), Words and Expressions
(workbook) — 30 files. Class 11 has Hornbill + Woven Words. A workbook is not a
literature reader and must not share a content_type.

**3. Chapter names need the contents-page method.** Filenames are NCERT codes
(`jhks101.pdf`), not titles. Use the PROVEN method from tonight's Kerala work:
pdfjs + positional reading-order sort (see the toc2 approach —
`items.sort((a,b) => (b.y - a.y) || (a.x - b.x))`), which correctly handled
two-column and jumbled contents pages where a naive text join produced garbage.
~35 books to open. DO NOT web-search chapter lists — third-party sites disagree
across the 2023 NCERT rationalisation, which is the same edition-mismatch that
produced the 10 stale Class 8 Maths rows.

### Proposed taxonomy extension (PROPOSE TO OWNER BEFORE BUILDING)

STEM's `content_type` (theorem / formula / exercise / worked_example) does not
describe prose. Three new families, scoped BY SUBJECT rather than replacing the
existing values:

| family | subjects | content_type values | chapter unit |
|---|---|---|---|
| literature | English, Hindi readers | `prose`, `poem`, `drama`, `author_note`, `comprehension_exercise` | one text (story/poem) |
| social | History, Geography, PolSci, Sociology, Psychology, Class 8-10 Social | `concept`, `event`, `case_study`, `source_extract`, `map_work` | chapter |
| commerce | Accountancy, Business Studies, Economics, IP, CompSci | `concept`, `procedure`, `worked_problem`, `format_template` | chapter |

~~Two decisions the owner must make:~~ **BOTH DECIDED, and built in Stage A:**
1. **Literature "chapter" = the individual text**, not the book unit. The lesson
   rule inverts for the literature family only: the unit name goes in `unit` and
   each text inside it is its own lesson.
2. **`techniques` left null (in practice `[]`) for non-STEM.** No schema change —
   `normaliseClassification()` already produces `[]` for a missing value.

The families as built differ from the sketch above: `concept`,
`worked_problem` and `comprehension_exercise` were dropped in favour of the
existing `definition`, `solved_example` and `exercise`, and literature narrative
is `literary_prose` rather than `prose`. See `SUBJECT_FAMILIES` for the real
list — it is the source of truth, and `CONTENT_TYPES` is derived from it.

**Verbatim source_text is REQUIRED for literature.** runNotesExtraction already
has the `[[PAGE N]]` marker path that slices the ORIGINAL pages array rather
than trusting the model to reproduce a passage (it paraphrases even when told
not to). That path exists precisely for extract-based comprehension questions
and MUST be used for every literature load.

### Staged plan

| stage | work | est. |
|---|---|---|
| ~~A~~ | ~~Taxonomy decision with owner + migration~~ **DONE 2026-08-12** | ~~0.5d~~ |
| B | Contents-page extraction for ~35 books -> verified chapter lists **← NEXT** | 0.5d |
| C | Seed syllabus_nodes per subject+book, insert-only, `--undo` | 0.5d |
| D | Extend `subjectForFolder()` — replace the `computer|political|social` exclusions with correct tagging; map the 8 multi-book pairs | 0.5d |
| E | Load in BATCHES by class, dry-run then sample-check each | 0.5d |
| F | Both-halves verification + counts reconciliation | 0.5d |

~3 days. Do NOT compress by skipping B — guessed chapter names are what produced
the 472 Kerala orphans with five names for one chapter.

### Already proven and reusable

- `PARTIAL_SYLLABUS_EXAM_TYPES` (src/lib/contentExtraction.js) — gates the
  closed-list rule per exam_type when a syllabus is incomplete.
- `bulk-load-corpus.mjs` takes `CORPUS_DIR`; `bulk-load-pyq.mjs` takes
  `PYQ_DIR` + per-job `examType` and mints a real admin token.
- `scripts/seed-kerala-class10-syllabus.mjs` is the template for stage C.
- Checkpoints: `.corpus-load-checkpoint.json` holds all 148 STEM files.
  **NEVER `--reset`** — it would reload and duplicate the entire STEM corpus.

---

## OPEN — the Kerala `Question Paper` corpus: audited 2026-08-12, none of it loadable yet

125 PDFs at `OneDrive/Documents/ewe_data/Question Paper`, verified by opening
them (page-1 text via pdfjs), not by trusting filenames. All 645 files in
`ewe_data` are fully downloaded — no OneDrive placeholders (`du` reports 1.7 GB
actually on disk).

### Three collections, and they are NOT the same thing

| collection | what it actually is | files |
|---|---|---|
| Model 10th PYQ | SCERT Kerala **Summative Assessment III 2025-26 MODEL papers**, Std X | 42 |
| SSLC Exam 2026 | Kerala **SSLC annual board exam**, March 2026, Class 10 | 28 |
| Plus Two Exam 2026 | **Second Year Higher Secondary Exam**, March 2026, Class 12 | 55 |

Model 10th are practice papers (`© State Assessment Cell, SCERT Kerala`), not
past board papers. They need a different `exam_type` from the SSLC annuals or
`chapter_pattern_stats` will blend practice with real exams.

### Machine-measured across all 125

```
errors: 0
SCANNED, no text layer (needs forceVision):  30
MALAYALAM script >=20% of page 1:            26
separate ANSWER KEY files:                   45
```

Almost every SSLC/Plus Two **question paper is scanned** while its **answer key
is clean text**. The papers you most want cost the most to ingest.

### THE FOLDER IS AUTHORITATIVE, NOT THE FILENAME

`Model 10th PYQ/Chemistry(EM)/General_Set_A_Eng.pdf` opens as
`SUMMATIVE ASSESSMENT III … CHEMISTRY Std : X`. The filename says "General";
the folder says Chemistry; the folder is right. All 27 files that looked
ambiguous by name resolved once the folder was read alongside them. Any
metadata detector must weight folder path above filename.

### ⚠ CORRECTION TO THE DAY 0.5 MEDIUM DESIGN

`MALAYALAM Kerala Padavali/MALAYALAM AT SET - A.pdf` is 100% Malayalam script —
and it is the Malayalam **language subject**, not a Malayalam-medium science
paper. **Script detection alone cannot tell those apart**, and would have
mis-tagged 26 files.

The detector must combine script WITH subject:

```
Malayalam script + subject in {Malayalam, Hindi, Arabic, Urdu}  -> language SUBJECT, medium not implied
Malayalam script + subject in {Maths, Physics, Chemistry, ...}  -> Malayalam MEDIUM
```

(AT = Kerala Padavali, BT = Adisthana Padavali — the two Malayalam papers.)

### Blockers, per file

| blocker | files |
|---|---|
| Separate answer key — must pair as `preamble`, never ingest as questions | 45 |
| Malayalam medium — hold until the medium column exists | ~20 |
| Scanned — needs `forceVision`, real token cost | 30 |
| Exam type with no `syllabus_nodes` (SSLC, Plus Two) | all 125 |
| Non-STEM (Urdu, Arabic, Journalism, Geology, Sociology…) — no syllabus, likely out of scope | ~30 |
| Already loaded (3 Maths(EM) files, as `drive:*`) | 3 |

**Nearest-ready slice:** Model 10th PYQ English-medium STEM only — Physics(EM),
Chemistry(EM), Biology(EM), Mathematics(EM) minus the 3 already in — **9 files**,
clean text, no vision cost, no medium blocker. Still needs the Kerala syllabus.

---

## OPEN — seeding a Kerala syllabus needs a source of truth we do not have

`seed-syllabus-from-corpus.mjs` reads chapter names from `knowledge_base`, and
there are **zero** Kerala chunks there. Run against Kerala it finds nothing and
inserts nothing. It is not a quick win.

**Why it matters** — the 472 existing `Kerala State Class 10` orphans show what
happens without it. One chapter, four names:

```
Arithmetic Sequences    59   <- the real SCERT name
Arithmetic Progressions 37   <- CBSE vocabulary applied to a Kerala paper
Sequences and Series    13
Sequences                1
```

Another, five ways: `Circles` 67 · `Geometry` 58 · `Geometry - Circles` 26 ·
`Geometry - Angles in Circles` 5 · `Circle Geometry` 2. Thirteen of 32 names
carry an invented `Geometry - ` prefix, and the tail (`Geometry - Inradius`,
`Mensuration - Cones`) are sub-topics, not chapters.

Blueprint V2 keys `chapterCounts` on the exact string, so one chapter splits
across five buckets and the allocation is meaningless.

**Two viable routes, neither quick:**

1. Obtain SCERT Kerala Class 10 textbooks, load as corpus, seed with the
   existing pattern. No new design — but `ewe_data` has papers, not books.
2. Enter the official chapter list by hand (~10-11 per subject). Legitimate
   curation, ~15 minutes of content work.

**DO NOT derive it from the orphan names above.** That canonicalises
`Geometry - Inradius` and is the same inversion argued against for
`pyq_questions` generally — `matchSyllabusChapter` exists to correct guesses,
not to be seeded from them.

Prefer fixing at write time. Re-snapping afterwards means a backfill over rows
already fragmented five ways.

---

## OPEN — answer-key pairing: the widest blocker in the Kerala corpus

45 of 125 files are standalone answer keys. Loaded as-is you get 53 papers with
no answers PLUS 45 files of keys ingested as though they were questions.

`runPYQExtraction` already accepts a `preamble` for exactly this — the NEET
2025 load used it for a paper whose key sat on one page. What is missing is
**pairing**: nothing associates a key file with its paper.

### Three key layouts observed, all in this one corpus

1. **Separate file** — `…Chemistry Question Paper (EM).pdf` +
   `…Chemistry Answer Key (EM).pdf`. Most common.
2. **Embedded** — `English_Set_A_General Schol Qn _ Ans.pdf`, questions and
   answers in one document.
3. **Multiple competing keys** — SSLC Maths has FOUR, by different authors
   (Prathap Sir, Seema Sugathan, Raveendranath Sir, Sarath Sir). One must be
   chosen; they will not agree everywhere.

### Proposed design

**Pair on (folder, subject, medium, set), not on filename similarity.** The
folder already scopes subject and medium; within it, classify each file:

```
key      /answer[ _]?key|^KEY |detailed (answer|solution)/i
paper    /question paper|ModelQn|Qn/i
both     filename carries BOTH markers (layout 2) -> no pairing needed
```

Then match `Set-A` to `Set-A`, `(EM)` to `(EM)`. Where several keys match one
paper (layout 3), **do not guess** — surface the choice to the admin, defaulting
to the one whose extracted answer count matches the paper's question count.

**Verification is the interesting part.** A key paired to the wrong paper is
worse than no key: it silently mis-marks every question, and
`toEngineFormat`'s `parseAnswerLetter` will happily accept a full set of wrong
letters. So the pairing must ASSERT before saving:

- answer count == question count (the strongest single signal)
- section/marks structure agrees where both are present
- a mismatch blocks the pair and reports, rather than saving a plausible-looking
  paper with a wrong key

That check is also what makes layout 3 tractable: the key with the matching
answer count is almost certainly the right one.

**Effort:** ~1 day including the assertion harness. Blocks all 125 Kerala files
regardless of medium, so it comes before the medium work for THIS corpus even
though medium is cheaper.

---

## ⚠ OPEN — three MORE anon-writable content tables (extends the pyq lockdown)

Found 2026-08-12 while checking whether the bulk-load scripts still work. The
`pyq_open` pattern closed in 20260812030000 is repeated on three sibling tables:

| table | policy | rows at risk |
|---|---|---|
| `knowledge_base` | `knowledge_base_open` **ALL {public}** | 4,377 chunks + HNSW embeddings |
| `syllabus_nodes` | `sn_admin_write` **ALL {anon,authenticated}** | the whole curated chapter vocabulary |
| `content_figures` | INSERT/UPDATE/DELETE each **{public}** | 89 figure rows |
| `study_notes` | SELECT only, writes via `admin_upsert_study_note` | ✅ already correct |

### ⚠ NAMING TRAP — do not trust a policy name

**`sn_admin_write` is granted to `{anon, authenticated}`.** The name says
"admin_write"; the policy lets anyone holding the public anon key write to
`syllabus_nodes`. Nothing about reading the name suggests the hole, and an
audit that greps for "admin" in policy names would score it as safe.

This is the third distinct way this vulnerability has hidden in plain sight:

1. **RLS enabled, policy `true`** — `pyq_open`, `knowledge_base_open`. Passes
   any check that only looks at `relrowsecurity`.
2. **A reassuring name** — `sn_admin_write`. Passes any check that reads names
   rather than `roles` and `qual`.
3. **A grant that goes nowhere** — the P0 lockdown on 2026-08-11 granted
   `EXECUTE` to `authenticated`, a role no request in this project ever has.
   Looked like a lockdown, was a lockout.

**The only reliable check is reading `cmd`, `roles` and `qual` together**, per
policy, from `pg_policies` — never the name, never `relrowsecurity` alone:

```sql
select tablename, policyname, cmd, roles::text, qual
from pg_policies where schemaname = 'public' order by tablename;
```

`study_notes` shows the target shape — public read, writes behind a
`SECURITY DEFINER` RPC with `assert_verified_admin`.

**Same class of vulnerability found three separate times now** (P0.75 student
tables, `pyq_questions`, these three). The write-lockdown work should not be
considered finished until these are closed. **Sequence AFTER Step 3/4
completes**, not before — the pyq lockdown is one migration from done and must
not be destabilised.

Shape of the fix, per table: enumerate every writer first (that discipline is
what made the pyq lockdown land without an outage), add guarded RPCs, drop the
permissive policies, keep SELECT open. `knowledge_base` has the most writers —
`adminSaveKnowledgeChunks`, the bulk corpus loader, and `adminClearAllData`.

Note the ordering hazard learned on 20260812020000/030000: create the RPCs and
deploy the client FIRST, drop the policies SECOND, or admin writes break in the
window between.

---

## ⚠ OPEN — anyone with the anon key can rewrite or delete the whole question bank

Found 2026-08-12 while checking whether an archive script could write via the
public key. It can — and so can anyone else.

```
pyq_questions   RLS enabled, 3 policies
  pyq_open           cmd=ALL     roles={public}          qual=true  with_check=true
  pyq_insert_update  cmd=ALL     roles={authenticated}   qual=true  with_check=true
  pyq_select         cmd=SELECT  roles={anon,authenticated}
```

`pyq_open` grants **ALL** commands to **public** with `qual = true`. RLS is
enabled, which makes the table look protected in any audit that only checks
`relrowsecurity` — but a policy of `true` for `public` is no protection at all.
`DELETE FROM pyq_questions` with nothing but the anon key (which ships in the
client bundle and is public by design) would destroy the entire corpus:
**~1,800 rows, six years of NEET papers plus the Class X maths sets**, and the
`chapter_pattern_stats` blueprint that is derived from them.

This is the same class as the four tables closed in
`20260811160000_lock_open_student_tables.sql`, and it is worse than those: those
were per-user rows, this is the shared content asset the product is built on.

**Severity is destructive, not confidential** — the content is meant to be
readable. `pyq_select` for `{anon,authenticated}` is correct and should stay.
Only the write path needs closing.

**Shape of the fix** (mirrors 20260811160000):

1. Drop `pyq_open` and `pyq_insert_update`. Keep `pyq_select`.
2. Route the writers through `SECURITY DEFINER` RPCs carrying
   `assert_verified_admin`. Known writers: `savePYQRows`
   (`AdminContentIntake.jsx:79`), `deletePYQ`, `clearPYQQuestions`, the
   `status` updates in Admin → Content Review, and
   `scripts/archive-duplicate-pyq-batch.mjs`.
3. Both halves as usual: anon INSERT/UPDATE/DELETE must go 2xx → 401, and a
   real admin upload must still save. Reuse the shape of
   `scripts/audit-student-table-rls.mjs`.

Do this before the 14th if there is room. Nothing depends on the current
policy except convenience, and the blast radius is the whole corpus.

---

## OPEN — 472 questions sit under an exam type the syllabus has never heard of

Reported 2026-08-12: content visible in Content Library does not appear in
Syllabus. Investigated the same night; the cause is not what the symptom
suggests.

### The measurement

31 chapters carry PYQ content with no matching active `syllabus_nodes` row:

| exam_type | subject | orphan chapters | questions | first seen |
|---|---|---|---|---|
| Kerala State Class 10 | Mathematics | **29** | **472** | 2026-08-11 |
| NEET | Chemistry | 1 (`Atoms`) | 2 | 2026-08-10 |
| NEET | Biology | 1 (`Enzymes`) | 1 | 2026-08-10 |

### Answering the three questions as asked

**1. Is it content uploaded after the seeding ran?** Timing-wise yes — all 29
Kerala chapters arrived with tonight's three Class X maths papers. But timing is
not the cause, and re-running the seeder in a different order would not have
helped.

**2. Chapters missed by a seeding batch?** Closer, but the unit is wrong. This
is not "some chapters were skipped" — it is **an entire exam type that no batch
has ever covered**. `Kerala State Class 10` has:

- **0** rows in `syllabus_nodes`
- **0** chunks in `knowledge_base`
- 472 questions in `pyq_questions`

The seeder is driven by an explicit exam+subject list (`--preset`, the Tier 1
array in `scripts/seed-syllabus-from-corpus.mjs`), and Kerala has never been in
it. Everything currently seeded is CBSE Class 8/9/10/11 and NEET.

The two NEET rows are a different, genuine instance of the reported symptom:
per-chapter near-misses that `matchSyllabusChapter()` failed to snap. `Atoms`
should be `Structure of Atom`; `Enzymes` is a topic inside `Biomolecules`. Three
questions total, so cosmetic — but they are the honest example of "a chapter
slipped through", and worth using as the test case for any snapping improvement.

**3. Auto-sync, or periodic re-seeding?** Neither works as posed, and one of
them would actively cause harm:

- **Re-running the seeder does nothing for Kerala.** It reads chapter names from
  `knowledge_base`, and there is no Kerala corpus there. It would find zero
  chapters and insert zero rows. A Kerala Class 10 textbook corpus has to be
  loaded *first*; only then can the exam type be seeded like any other.
- **Auto-seeding `syllabus_nodes` from `pyq_questions` would be backwards.**
  Those chapter strings are the model's guesses. `matchSyllabusChapter()` exists
  precisely to snap guesses onto a curated list — seeding the curated list from
  the guesses inverts that and would launder hallucinated chapter names into the
  vocabulary meant to correct them. `Atoms` and `Enzymes` above are exactly the
  values that would get enshrined.

### What would actually help

1. **A drift report, not an auto-sync.** The query used here (normalised
   left-join of distinct content chapters against active `syllabus_nodes`) is
   cheap and belongs in Admin → Content Map or as
   `scripts/audit-syllabus-coverage.mjs`. Surfacing the gap is the useful part;
   closing it automatically is not.
2. **Decide what `Kerala State Class 10` should be.** It is a real exam type
   with real content and no syllabus. Either load its corpus and seed it
   properly, or map it onto the CBSE Class 10 syllabus if the chapter lists are
   close enough. That is a content decision, not a code one.
3. **Note the inverse gap while deciding.** `CBSE Class 11` (77 nodes),
   `Class 8` (43) and `Class 9` (22) have syllabus rows with **zero** PYQ
   content — syllabus ahead of content rather than behind it. Harmless, but the
   same report should show both directions so neither looks like a bug.

### Consequence if left alone

`matchSyllabusChapter()` keeps the raw AI guess when nothing matches, so those
472 questions are stored and answerable — this is not data loss. What breaks is
grouping: Blueprint V2 keys `chapterCounts` on the exact chapter string, so
unsnapped variants of the same chapter split into separate buckets and the
allocation drifts. Chapter filters in the student UI will not list them either.

---

## PARKED (post-launch) — `pyq_questions.marks` should be numeric, not integer

Half marks are legitimate on real exam papers. The column is `integer`, so they
cannot be stored. As of 2026-08-11 `normaliseMarks` rounds them and reports the
adjustment — that stops a 0.5 destroying a 40-question insert, but it is a
stopgap: a paper with four ½-mark questions would store 2 marks more than the
paper is worth, and every total derived from the column inherits that.

**DOWNGRADED 2026-08-12 — robustness improvement, not a data-fidelity fix.**
Re-uploading the same three Class X maths papers after the fix produced **zero**
marks adjustments across 268 saved questions. `normaliseMarks` reports every
adjustment it makes, so a clean run proves no fractional marks were returned.
The `0.5` that originally broke the insert was therefore **model output
variance, not a property of the paper** — this corpus has no real half-marks.
So the integer column is not currently losing fidelity on anything; it is only
one bad model response away from another all-or-nothing insert failure, which
`normaliseMarks` already absorbs. Keep it parked.

**Why it was not done immediately:** it is a scoring-adjacent change three days
before launch, and it has one non-obvious trap (below). Nothing is being lost
that cannot be re-derived — the source PDFs are kept.

### What the change actually involves

```sql
drop view public.chapter_pattern_stats;              -- only dependent object
alter table public.pyq_questions
  alter column marks type numeric(4,2);              -- existing 1-5 cast cleanly
-- then recreate the view from 20260810050000_chapter_pattern_stats.sql
```

`chapter_pattern_stats` is the **only** object depending on the column
(confirmed 2026-08-11 via `pg_depend`).

### Two things checked so they do not have to be re-checked

1. **PostgREST returns `numeric` as an unquoted JSON number, not a string.**
   Verified directly against `/rest/v1/chapter_pattern_stats` — `avg_marks`
   comes back as `3.00`, not `"3.00"`. This matters because
   `MockTestEngine.computeResults` gates negative marking on
   `typeof q.marks === 'number'`; had numerics arrived as strings, that check
   would have flipped and every board paper would silently have gained negative
   marking. **It does not.** (Note the `supabase db query` CLI *does* quote
   numerics — do not use it to judge client behaviour.)

2. **THE TRAP — `by_marks` keys change shape.** The view builds its
   distribution with `coalesce(marks::text, 'unknown')`. Under `numeric(4,2)`
   that yields `"4.00"`, while `patternStats.scorePaperAgainstPattern` tallies
   the generated paper with `String(q.marks)` → `"4"`. The two key sets would
   be disjoint, so `distributionMatch` returns **0** and the headline
   "PYQ-pattern match" silently collapses by a third. Fix in the view with
   `trim_scale(marks)::text` (PG14+) or `(marks::float8)::text`, and assert it
   with a test that scores a known paper before and after.

### Also worth doing at the same time

`savePYQRows` inserts all rows in **one statement**, so any single bad field
still discards the whole file — `marks` is fixed, but `has_diagram` (boolean,
NOT NULL) and `year` (integer) are the same shape of risk. `has_diagram` is
lower risk because the extraction schema pins it as a literal `false`/`true`
and models are reliable there; `year` is already `parseInt`-ed from a form
field. Either widen the normalisation to every typed column, or chunk the
insert so one bad row loses one row.

---

## PARKED (post-launch) — three AI helpers still have no timeout or retry

`chatComplete` was hardened on 2026-08-11 (commit `d5ac587`) after a PYQ upload
hung for 15+ minutes on a single page. **Three sibling functions in the same
file were deliberately left alone**, scoped out to avoid changing behaviour in
paths that investigation had not covered, right before launch:

| function | used by | today |
|---|---|---|
| `generateImage` | Admin Paper Gen → "Generate with AI" diagram button | no timeout, no retry, `catch { return null }` |
| `embedText` | `_addEmbeddings` (KB save), doubt-chat search, `questionGen` retrieval | no timeout; ad-hoc retry at one call site only |
| `generateSpeech` | Podcast Generator (TTS), `PodcastPage.jsx:66` | no timeout, no retry; throws on failure |

**Why it matters.** These are the *same bug class* that produced the intake hang:
each calls `fetch` with no `signal` and no deadline, so a request that never
settles blocks its caller forever with no error.

**Ranked, because they are not equally exposed:**

1. **`generateImage` — the closest match to the original symptom.** A
   long-running call behind a button an admin sits and watches, exactly like the
   vision path was, and it swallows every error into `null`. A rate limit is
   indistinguishable from "image generation failed". Do this one first.
2. **`generateSpeech`** — no timeout, but it *throws*, so a failure at least
   surfaces to the student. Only the hang is unhandled.
3. **`embedText` — least urgent; partly handled already.** Checked 2026-08-11:
   `_addEmbeddings` (`src/lib/supabase.js:352`) already does a one-shot retry
   after 1s and counts `failedCount`, which **is** surfaced — it writes a
   changelog entry, `"N KB chunk(s) inserted without embeddings — embed API
   unavailable"`. So the silent-degradation problem does *not* apply to the KB
   save path. What remains is the missing timeout (it can still hang forever),
   and that the ad-hoc retry neither honours `Retry-After` nor distinguishes a
   429 from a 400 — it retries both once, then gives up. The other two call
   sites (doubt-chat, `questionGen:739`) have no retry at all and fall back to
   keyword search.

**What the fix looks like.** The machinery already exists and is tested: reuse
`runWithRetry` / `withDeadline` / `parseRetryAfter` from `src/lib/aiProxy.js`.
Roughly a one-line application each, plus deciding a per-call timeout (DALL·E 3
legitimately runs 30–60s, so 90s is about right; embeddings should be far
shorter, ~20s).

Two things to settle when picking this up, both of which are why it was not just
done blind:

1. **`embedText` returning `null` is load-bearing.** All three call sites treat
   a null embedding as "skip" — `_addEmbeddings` counts it, doubt-chat falls
   back to keyword search. Making it throw would change save behaviour. Bound it
   first; change the contract separately, if at all. Its existing one-shot retry
   should be replaced by `runWithRetry`, not stacked on top of it.
2. **`?route=images` and `?route=tts` do not get the `Retry-After` passthrough.**
   `withRetryAfter` in `supabase/functions/ai-proxy/index.ts` is only applied on
   the JSON branch. Extending retry to those routes means extending that too, or
   they will silently fall back to exponential backoff while appearing to honour
   the server.

Owner decision on 2026-08-11: **not before launch** — nothing is actively broken
in these three paths, and the scope-expansion risk outweighs the benefit this
close to the date.

---

## FOLLOW-UP (gated) — use chapter_pattern_stats to STEER generation, not just score it

Today the stats measure a paper after it is generated. Steering means feeding the
measured chapter / type / marks mix into generation so the paper is built to
match, rather than graded against it afterwards.

**Level 1 — extend the existing allocation. ~2–3 hours.** Blueprint V2 already
computes `blueprintAllocation` (chapter → target count) and injects it into the
prompt. The same mechanism can carry target *type* and *marks* mixes from
`chapter_pattern_stats`, so the ask becomes "6 questions on Circles, of which 3
MCQ at 1 mark and 3 Case-Based at 4 marks". Low risk: it reuses proven plumbing,
and `pattern_match` gives an immediate before/after read.

*(Level 2, per-chapter generation batches, ~1–2 days, multiplies API calls by
chapter count and runs into the 30,000 TPM ceiling. Level 3, over-generate and
select the best-matching subset, ~3–5 days. Neither is worth scoping further
until Level 1 has been tried.)*

**GATED ON: a second paper per subject** (see below). Steering makes the
generator imitate the measured pattern *harder*, which is only an improvement if
the pattern is right. It currently rests on one paper per subject — steering hard
toward a sample of one would faithfully reproduce 2025's particular emphasis,
quirks included, and present it as "the exam pattern". A confident wrong answer
is worse than the current honest-but-loose behaviour.

---

## OPEN — a second paper per subject is needed, for two separate reasons

Everything Phase 2 §3/§4b now computes rests on **one paper per subject, two
subjects, one year** — 34 Class 10 Mathematics + 53 Class 10 Science questions
from 2025. A second paper each is the cheapest thing that improves it, and it
settles two distinct questions at once.

**1. It firms up the stats.** `chapter_pattern_stats` currently reports a single
paper's chapter mix as if it were the subject's pattern. One paper is a sample of
one: CBSE rotates emphasis year to year, so a chapter carrying 6 questions in
2025 may carry 2 in 2024. Blueprint V2 and `pattern_match` both allocate and
score against that single sample. Two papers roughly halves the variance; three
to five would make year-over-year trend analysis possible at all (see the
deferred `year` axis).

**2. It settles the over-spreading question** (detailed below) — whether the
closed chapter list is being treated as a vocabulary or as a quota.

**What to upload:** one more CBSE Class 10 Mathematics and one more Class 10
Science board paper, any year other than 2025, through Admin > Content Intake
with the same settings. Nothing needs re-running afterwards; the view is live and
recomputes on read.

---

## OPEN — check chapter over-spreading when more papers are uploaded

`runPYQExtraction` now hands the model a **closed list** of syllabus chapters and
requires it to copy one exactly. That took chapter snapping from 86–87% to 100%
and eliminated invented chapters entirely (0 of 87 questions outside the
syllabus, against 11 of 83 before).

The risk it introduces: **forcing a choice from a list can make the model spread
questions across it** rather than concentrate them where the paper actually
concentrates. Both re-run papers came out covering *every* chapter in their
syllabus — 14/14 Mathematics, 13/13 Science.

That is plausible for CBSE, which samples broadly, and the distributions are
naturally skewed rather than uniform (Science 8, 8, 6, 6, 5, 4, 4, 3, 3, 2, 2,
1, 1; Mathematics keeps a clear 6/5/4/4 head), so this is a watch item, not a
known defect.

**What to check when a second paper per subject is uploaded:** whether chapters
that genuinely carry no questions in that paper still come back with 1–2. If they
do, the closed list is being treated as a quota rather than a vocabulary, and the
prompt needs an explicit "not every chapter will appear; leave a chapter out
rather than forcing a question into it".

This matters because Blueprint V2 allocates generation proportionally to these
counts — an artificially flattened distribution produces an artificially flat
paper.

---

## RESOLVED 2026-08-10 — `pyq_questions` was empty, blocking Phase 2 §3 and §4b

Two 2025 CBSE Class 10 board papers are loaded (34 Mathematics + 53 Science
questions, all `published`, all chapter-attributed). **Blueprint V2's 20-question
threshold now passes for both**, the first time it has been reachable for any
exam+subject.

**Still thin, and it constrains what can be built on top:**

| axis | state |
|---|---|
| `chapter` | 100% populated, snapped to syllabus — **usable** |
| `question_type` | 6 real values (MCQ 33, Short Answer 24, Long Answer 11, Case-Based 9, Assertion-Reason 6, Numerical 4) — **usable** |
| `marks` | 5 real values (1, 2, 3, 4, 5) — **usable** |
| `section` | A–E, real spread — **usable** |
| `year` | **single value (2025)** — no year-over-year trend is possible |
| `difficulty` | **single value ("Medium")** — hardcoded in `savePYQRows`, carries zero information |
| `techniques` | **column does not exist** on `pyq_questions` |
| `correct_answer` | **0 of 87** — neither board paper shipped an answer key |

Only 2 of 11 exam+subject combinations have any PYQ data at all. Class 11 remains
empty and, having no board exam, has no real past-year papers to source — see the
NEET/JEE decision above.

---

## RESOLVED 2026-08-11 — how NEET/JEE relates to the CBSE Class 11 corpus

**Option B was chosen, implemented and deployed.** A NEET/JEE query now reads the
Class 11+12 corpus via `examTypesFor()` (`src/lib/examMapping.js`) plus a
`text[]` filter on `match_knowledge_base`. Verified live: a NEET Physics query
returns `CBSE Class 11` chunks, and CBSE Class 10 is uncontaminated.

The analysis below is kept because it records why A, C and D were rejected — in
particular that SUBJECT filtering already separates NEET from JEE for free.

### The problem

The platform is positioned as NEET/JEE prep, and NEET's syllabus *is* Class 11 +
12 Physics, Chemistry and Biology. **1,531 Class 11 Physics/Chemistry/Biology
chunks are already loaded** — the right content, tagged for a different exam.

Everything joins on `exam_type + subject`:

- `match_knowledge_base(filter_exam_type, filter_subject, …)`
- Blueprint V2: `.eq('exam_type', examType).eq('subject', subject)`
- `syllabus_nodes`, `study_notes`, `getStudyChapters()` — all the same key

So NEET PYQs tagged `exam_type: 'NEET'` will **not** see a single one of those
1,531 chunks. Blueprint V2 would compute a NEET allocation with no NEET
knowledge base behind it, and §4a's type-filtered retrieval would return nothing
for NEET.

CBSE Class 10 is unaffected — corpus, syllabus and PYQs all share
`'CBSE Class 10'`. This only bites the Class 11 slice.

### Options

**A. Re-tag the Class 11 corpus as NEET.**
Cheapest to execute (an UPDATE over ~1,531 rows plus their `study_notes`), and
everything joins immediately. But it *loses* the CBSE Class 11 identity — a
Class 11 board/school user would then find nothing, and JEE (Physics, Chemistry,
Maths — no Biology) still wouldn't join. Rules out serving both audiences from
one corpus.

**B. Mapping layer at query time.**
Keep the corpus tagged `'CBSE Class 11'` and resolve a NEET query to the set
`['NEET', 'CBSE Class 11', 'CBSE Class 12']` before hitting the DB.
`match_knowledge_base` already takes `filter_exam_type` as a scalar, so this
needs the RPC widened to `text[]` (it already does exactly this for
`filter_content_type`), plus a small `examTypesFor(examType)` helper used by the
retrieval call sites. Preserves both identities, serves NEET and JEE from one
corpus, and is the only option that survives adding Class 12. Most code, but the
code is small and mostly already patterned.

**C. Dual-tag rows.**
Add a `exam_types text[]` alongside `exam_type` and write both. Avoids touching
query logic much, but introduces two sources of truth for the same fact and
every existing `.eq('exam_type', …)` in the app becomes subtly wrong.

**D. Load NEET PYQs and NEET-specific content separately.**
Treat NEET as its own vertical with its own corpus. Honest and simple, but
duplicates ~1,500 chunks of identical NCERT content and doubles ingestion cost
for every future chapter.

### Read — recommend B, and it is much smaller than first scoped (sized 2026-08-10)

**B, but only its minimal slice: the knowledge_base retrieval path.** Sized by
counting real call sites rather than estimating — of **26** `.eq('exam_type', …)`
filters in `src/`, only **five** touch the NEET → Class 11 join:

| site | table |
|---|---|
| `match_knowledge_base` (migration: `filter_exam_type text` → `text[]`) | `knowledge_base` |
| `questionGen.js:720` | RPC call |
| `supabase.js:235` | RPC call |
| `questionGen.js:662` | `knowledge_base` keyword fallback |
| `questionGen.js:769` | `study_notes` verbatim passages |

The RPC change is a copy of the `= ANY()` pattern `filter_content_type text[]`
already uses in the same function. Everything else is untouched: `syllabus_nodes`
(8 sites) now has its own NEET rows, and NEET PYQs carry `exam_type: 'NEET'`, so
`pyq_questions` (6), `topic_frequency`, `chapter_pattern_stats` and `important_qa`
all resolve correctly with no change. **~2–3 hours, not a day.**

Three things settle it against A:

1. **Subject filtering already separates NEET from JEE, for free.** NEET is
   Physics/Chemistry/Biology, JEE is Physics/Chemistry/Mathematics, and every
   query filters subject as well as exam_type. One Class 11 corpus serves both —
   Class 11 Mathematics (394 chunks) never reaches NEET, Biology (386) never
   reaches JEE. A cannot do this: re-tagging Phy/Chem/Bio as NEET leaves JEE with
   nothing and strands Class 11 Mathematics.
2. **The pattern already exists in the codebase.** `examTypeCandidates()`
   (`src/lib/syllabus.js:18`) already resolves one logical exam to several
   exam_type values (`CBSE Class 10` → `CBSE` + class_level). `examTypesFor()` is
   the same idea, not a new concept.
3. **A is not actually faster.** It is a destructive UPDATE over 1,531 rows plus
   their `study_notes`, after which nothing records which rows were originally
   Class 11, so it is effectively one-way.

C and D unchanged from the original read.

### RESOLVED — Class 12 and pre-rationalisation chapters seeded (Tier 3, 56 rows)

NEET is Class 11 **+ 12**, and the papers being uploaded are 2018 and 2022 —
both predating the 2023-24 NCERT rationalisation, so they also ask about chapters
the current books no longer contain. `scripts/seed-neet-static-chapters.mjs`
added 56 rows on top of the 43 corpus-derived ones: Class 12 current (37),
Class 11 legacy (9), Class 12 legacy (10). **NEET now has 99 chapters**, no
duplicate `(subject, chapter_key)`, and the original 43/43 corpus join is intact.

**These names are NOT corpus-derived** — they are NCERT chapter titles, reviewed
by the project owner before the script was run. There is **no content behind
them**: a syllabus row makes a chapter name available to `matchSyllabusChapter()`,
it does not create `knowledge_base` chunks. Retrieval for Class 12 will find
nothing until Class 12 content is actually loaded. The win is clean chapter
*attribution* on the PYQs.

Legacy rows are `is_active = true` **on purpose** — `getChapters()` filters on it
and Content Intake snaps against exactly that list, so an inactive row is
invisible to snapping and the whole exercise would be pointless. The cost is that
students see ~19 chapters with no content, so every non-current chapter carries a
high `sort_order` (bands: Class 12 current 100+, Class 11 legacy 900+, Class 12
legacy 950+) and lands at the bottom of every picker.

### Known: two corpus-vocabulary artifacts, deliberately NOT renamed

`Discovery of Sub-Atomic Particles` (Chemistry) is a section of NCERT's
"Structure of Atom", and Biology carries both `Locomotion and Movement` and
`Skeletal System`, the latter being a section of the former. These are the
corpus's own chapter names. **Renaming them in AdminSyllabus would break the
join** unless `knowledge_base.chapter` is renamed in the same transaction —
syllabus and corpus must agree for chapter snapping to reach the chunks.

### Pre-existing bug now reachable — flashcard decks collide on `chapter_key`

`get_user_flashcards(p_uid, p_chapter_key)` filters on `firebase_uid` +
`chapter_key` and **not subject**. NEET Physics and NEET Chemistry both have a
`Thermodynamics` chapter and both slugify to `c11_thermodynamics`, so a student's
flashcards for the two would merge into one deck. The subject-less key format is
generated by `AdminSyllabus` itself, so this is a design-level pre-existing issue,
not something the seeding introduced — but seeding both subjects made it
*reachable* for the first time. Blast radius today is that single shared chapter
name. Correct fix is to add a subject filter to the RPC (small migration); not
done, launch-adjacent.

---

## RESOLVED 2026-08-10 — `runPYQExtraction` reserved `max_tokens: 16000`

Over half the org's entire 30,000 TPM budget in a single reserved call — the same
hazard that cost two files during the corpus load. Fixed by measuring instead of
guessing: 30 real questions serialised into this extractor's own schema come to a
median 354 chars (~90 tokens) each, so a 38-question board paper is ~3,500 output
tokens. Now `PYQ_MAX_TOKENS = 5000` with `PYQ_BATCH_CHARS = 12000`, dropping
per-call reservation from ~20,000 to ~8,600. Added a `finish_reason === 'length'`
guard, which matters more here than for notes: a truncated response silently
drops questions off the end of a paper while the upload still reports success.

---

## OPEN — org OpenAI TPM limit is 30,000

Very tight for this workload. Raising it is an account-level change only the
owner can make, and it is the durable fix for the rate-limit pressure that made
the corpus load take multiple passes.
