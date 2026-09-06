# Full Student-Journey QA Pass — 2026-09-06

**Read this if you're picking up where this session left off, or just want to know what was
actually tested versus assumed.** Written for someone with no prior context. Everything below was
either directly observed (screenshots, network logs, terminal output) or is explicitly marked as
inferred. Nothing here was deployed — see "What did NOT happen" at the bottom.

## Why this session happened

The project owner was worried the live site ("EWE" / EaseWithExam) had accumulated runtime issues
that would only surface when actually *used* — not from reading code, not from an admin's view, but
from clicking through it the way a real student would, end to end. Separately: the site wasn't
showing up in Google search despite a submitted sitemap, and a working test login was needed
(mobile number `9633484641`, code `123456`) in case real Google sign-in couldn't be exercised.

This doc covers that single pass: what was tested, what broke, what was fixed, and what's still
open. For the project's general architecture, see `docs/PROJECT_STATUS.md` (as of 2026-08-11 — a
few of its numbers are now stale; see "Corrections to PROJECT_STATUS.md" below). For the standing
list of things blocked on the owner, see `docs/ACTION_ITEMS_FOR_YOU.md`.

---

## 1. How to actually drive the real student login (read this first)

This took real trial and error this session, so it's worth writing down properly rather than
re-discovering it next time.

**Three login paths exist. Only one is actually drivable by an automated browser:**

| Path | Works for a real student? | Works for automated testing? |
|---|---|---|
| Google OAuth (`GoogleSignIn.jsx`) | Yes, this is the primary real path | **No** — cannot be scripted; a real human must click through the Google popup |
| Phone OTP (`PhoneOTP.jsx`) | Yes, this is the other real path | **Yes, with a caveat** — see below |
| Dev bypass `?qa_uid=<id>` (`AuthContext.jsx`) | No — DEV-only, stripped from production builds | **No — currently dead**, see §2 |

**The phone-OTP path is the one to use, and it needs two pieces already in place:**

1. A **Firebase Console "test phone number"** — `+919633484641` mapped to fixed OTP `123456`.
   This was *already configured* from a prior session (found live via
   `node scripts/qa-set-test-phone.mjs`, which is idempotent — safe to re-run any time, it reads
   the existing config before writing so it only adds/updates the number given as an argument
   without touching any other registered test number). This is Firebase's own official mechanism —
   no real SMS is ever sent for a registered test number, and it costs nothing.
2. **`auth.settings.appVerificationDisabledForTesting = true`**, set DEV-only in
   `src/firebase/config.js` (added this session). Without this, Firebase's real reCAPTCHA still
   runs even for a test phone number, and it reliably escalates to a visible image challenge
   ("select all images with crosswalks") for **any** Playwright/Puppeteer-controlled Chromium,
   headless or not — confirmed by literally trying both. This is Google correctly detecting
   browser automation, not a bug. The flag is gated on `import.meta.env.DEV`, which Vite resolves
   to a static `false` in a production build, so this line is dead-code-eliminated and never
   ships — same guarantee the pre-existing `QA_BYPASS_UID` dev flag already relies on.

**With both in place, a real end-to-end script looks like:**

```js
await page.goto('http://localhost:5173/');
await page.locator('button:has-text("Accept")').first().click();       // cookie banner
await page.locator('button:has-text("Get Started")').first().click();  // opens the sign-in modal
await page.locator('input[type="tel"]').first().fill('9633484641');
await page.locator('button:has-text("Send OTP")').first().click();
await page.waitForTimeout(4000);
const otpInputs = page.locator('input[maxlength="1"]');                // 6 individual digit boxes
for (let i = 0; i < 6; i++) await otpInputs.nth(i).fill('123456'[i]);
await page.locator('button:has-text("Verify OTP")').first().click();
```

This logs in as a **real, existing account** — `thaslimshajahans@gmail.com` / "Thaslim Shajahan" —
because that phone number is already linked to it (matches one of the two `superadmin` rows
recorded in `docs/REBUILD_HANDOFF.md`). It is a normal free-tier student profile as far as the app
is concerned (quota-bound: 0/20 AI questions, 0/2 mock tests, etc. at the time of testing) — the
`admins` table role doesn't grant it any in-app premium bypass. **Anything done while signed in as
this account touches the real production Supabase database** — this session generated one real
10-question practice paper against it (quota now shows 10/20 for that account). Be deliberate about
what you do while signed in this way; nothing was deleted or wiped this session, but the capability
to affect real data is real.

**One thing that does NOT work**: saving Playwright's `context.storageState()` and reusing it in a
later script. Firebase Auth persists its session in **IndexedDB**, which `storageState()` does not
capture (cookies + localStorage only) — a fresh browser context must redo the OTP flow every time.
There's no way around this without either keeping one long-lived browser context across a whole
test run, or investing in capturing IndexedDB separately (not done this session).

---

## 2. The `?qa_uid=` dev bypass is dead — do not trust its own comment

`AuthContext.jsx` has a documented DEV-only escape hatch: visit `/?qa_uid=some-id` in `npm run dev`
and it fakes `currentUser` in React state without any real Firebase sign-in. Its comment claims this
"auto-creates a `users` row on first use." **It does not, anymore, and following it cost real time
this session before the actual cause was found.**

**Root cause**: `src/lib/supabase.js`'s `currentFirebaseIdToken()` reads the *real* Firebase
`auth.currentUser` (a module-level singleton from `firebase/config.js`), not React's `currentUser`
state. The bypass only ever sets the React state — it never calls a real Firebase sign-in method —
so the real `auth.currentUser` stays `null` regardless. Every Supabase RPC that matters
(`upsert_own_user` included) now requires a **proven Firebase JWT** whose `sub` matches the uid
being acted on (this is the hardening described in `supabase.js`'s own top-of-file comment,
`auth.jwt() ->> 'sub'` — see also the memory note `project_supabase_auth_model` if you have access
to it). With no real token, these RPCs correctly 401 on the very first call.

**This is the security hardening working as intended, not a regression to route around.** Do not
"fix" this bypass by making it produce a token that satisfies these checks without a real
Firebase sign-in — that would reopen exactly the impersonation hole the hardening closed (any
caller supplying a known UID could act as that user). The comment in `AuthContext.jsx` has been
corrected in place to point at §1 above instead.

---

## 3. Real bugs found, and what was fixed

All three fixes are committed locally on `main` (not pushed, not deployed — see bottom of doc).
Each commit message has full detail; this is the summary.

### 3.1 Broken avatar shows as a broken-image icon, not the initials fallback

**Symptom, reproduced live**: the signed-in test account's Google-linked profile photo
(`lh3.googleusercontent.com/...`) consistently failed to load in the test browser
(`net::ERR_BLOCKED_BY_ORB`). A plain `<img src={avatar}>` with no `onError` handler was used in
four places — `TopHeader.jsx`, `Sidebar.jsx`, `ProfilePage.jsx`, and the shared `Avatar` component
in `LeaderboardPage.jsx` — each of which *already* has a nice initials-avatar fallback for the
"no photo at all" case, just never wired to trigger on a load *failure*.

**Why this matters for real students, not just this test environment**: a Google photo URL can
plainly expire, get revoked, or get blocked by an ad-blocker/privacy extension in any real browser.
Every one of those cases would previously show a permanently broken image in the header/sidebar/
profile/leaderboard — small, but visible on every single page for the whole session.

**Fix**: each of the four now tracks load failure in local state and swaps to the initials avatar
when the image `onError`s. Commit `9e7ac9d`.

### 3.2 Generation time badly undersold — looked hung, wasn't

**Symptom, reproduced live**: generating a 10-question CBSE Class 12 Physics practice paper showed
"Generating 10 questions…" with a promised "~15-25 sec" caption. At 35 seconds it was still
spinning. **First instinct was that this was a hung/broken generator.** It was not — a second run
with a 70-second wait showed it completing cleanly: a real, correctly-formed MCQ
("What is the SI unit of electric charge?" → Coulomb), quota correctly incremented (0/20 → 10/20),
and every backend call (`ai-proxy` × several, `check_and_increment_quota`) had returned HTTP 200 the
whole time. The pipeline was working; the UI's own promised time was just wrong.

**Root cause of the wrong promise**: `answerVerification.js`'s own comment documents **52-119
seconds** for just 15 questions (generation + a per-question AI re-solve/verification pass at
concurrency 5) — nearly 3-8x the "~15-25 sec" the button caption told the student to expect. The
`>30 questions` warning ("~30-60 seconds") was *also* understated by the same measurement, despite
covering even larger papers.

**Why this is a real, not cosmetic, bug**: a student with no visibility into network calls has
every reason to conclude the app is frozen well before 52-119 seconds elapse, and to refresh or
navigate away — abandoning quota that (per this test) is consumed as soon as generation succeeds
server-side, not when the student sees the result.

**Fix**: both captions now state honest ranges ("usually 30-90 sec, longer for bigger papers" /
"can take 1-3 minutes"). Commit `d0d4d71`. **Not fixed, and worth a real feature next time**: there
is still no progress indicator beyond a static spinner for up to ~2 minutes. A staged message
("Retrieving textbook content… → Writing questions… → Double-checking answers…") would go a long
way beyond just fixing the number in the caption.

### 3.3 (Documentation fix, not a runtime bug) — see §2 above

The dead `?qa_uid=` bypass comment. Commit `63993ec`, bundled with the working replacement
(`appVerificationDisabledForTesting` + `scripts/qa-set-test-phone.mjs`).

---

## 4. Full route/feature coverage this session

Driven as the real signed-in test account (CBSE Class 12 profile), via Playwright against
`localhost:5173`, capturing every console error, page error, failed request, and HTTP 4xx/5xx along
the way:

**Visited, rendered cleanly, zero console/network errors**: `/dashboard`, `/study`, `/practice`
(→ redirects to `/exams?tab=practice`, confirmed intentional per existing route-alias comments in
`App.jsx`), `/exams`, `/progress`, `/flashcards`, `/doubt` (AI Doubt Studio / "Ask EWE" — visually
confirmed via screenshot: upload panel + live chat pane, both rendering correctly), `/profile`,
`/notifications` (real historical data rendered: past premium-trial expiry notices), `/leaderboard`,
`/pricing`, `/syllabus`, `/goals`, `/exam-center`, `/paper-mode`, `/notebook`, `/learn`, `/analytics`,
`/help`, `/support`. `/podcast` and `/summarizer` both correctly 404 (not registered routes —
confirmed intentional by checking `App.jsx`, not a broken link left over from somewhere).

**Actually exercised, not just loaded**:
- **Practice paper generation** (see §3.2) — genuinely works end to end, including for CBSE Class
  12 Physics, which retrieved 12 real knowledge-base chunks (`[kb] Physics/CBSE Class 12 → 12
  chunks` in console) — worth noting since `docs/PROJECT_STATUS.md` (2026-08-11) says Class 12 has
  **zero** textbook content; that's now out of date for at least this subject. See "Corrections"
  below.
- **Mobile viewport** (390×844, iPhone-12-ish) checked on landing (logged out), dashboard, and
  practice generator — **no horizontal overflow detected on any of the three**, and visual
  screenshots of landing + dashboard look clean and properly mobile-first (see the "Getting
  Started" checklist card and hero section — both render with correct spacing, no clipped text).
- **Admin login** (`/admin/login`) — loads cleanly, zero console errors, correctly describes its own
  2FA (Google + 6-digit passcode). Not tested further — no admin Google/passcode credentials were
  available to automate past this screen.

**Test suite + build**: `npx vitest run` → 603/603 passing (both before and after every fix above).
`npm run build` → succeeds clean (only the pre-existing "chunk >300kB" advisory, unrelated to this
session).

---

## 5. Google Search Console / indexing — re-verified, nothing left to fix in code

The owner's concern: sitemap submitted, verification claimed done, site still not showing up in
Google search. Re-checked every technical piece **live against production**, not from memory of the
docs:

- `https://www.easewithexam.com/robots.txt` — correctly `Allow: /` at the root with every
  authenticated route explicitly `Disallow`'d, sitemap URL correctly declared.
- `https://www.easewithexam.com/sitemap.xml` — live (200), lists exactly the 6 real public URLs.
- `https://www.easewithexam.com/about` (bare, no slash) — **301s to `/about/`** as designed; the
  slash form serves its own distinct, correct `<title>` and `<link rel=canonical>` (not the
  homepage's) — this was a real bug in a prior session (nginx serving the wrong file for a
  prerendered directory route) and it is **still fixed**, confirmed fresh today.
- `index.html` — no `google-site-verification` meta tag present in the code at all, so whatever
  verification method was used (DNS TXT record is the other common option) lives outside this
  repo and can't be confirmed from here.
- One intermittent `Failed to load resource: 404` console error was seen on the live homepage in
  one check and did **not** reproduce on a second check — not chased further given it didn't
  reproduce; worth another look if it recurs (no resource URL was captured for it this time).

**Conclusion: there is nothing further to fix in the codebase for this.** Every prior session's
documented SEO fix (prerendering, canonical tags, the nginx directory-serving bug) is still live and
correct. The realistic explanation, already written honestly in
`docs/ACTION_ITEMS_FOR_YOU.md` ("the thing that actually caps rankings," 2026-08-11) and unchanged
today: a brand-new domain with only 6 indexable public pages is expected to show near-zero visible
search presence for days to weeks even with every technical box checked, purely because there is
very little for Google to index yet and no backlink profile. **This needs Search Console's own
"Pages" report** (not reachable from this environment) to see the actual per-URL status
("Indexed" / "Crawled - currently not indexed" / "Discovered - currently not indexed" / an actual
error) — that distinction matters a lot and only the owner can pull it up.

---

## 6. Corrections to `docs/PROJECT_STATUS.md` (2026-08-11)

That doc states "There is no Class 12 content at all" for the knowledge base. **This is no longer
fully accurate** — this session's live generation for CBSE Class 12 Physics retrieved 12 real
knowledge-base chunks. Not investigated further (out of scope for this pass — this was found
incidentally while testing generation, not via a deliberate content-inventory check), so the exact
current Class 12 coverage across all subjects is unknown; treat that doc's §3 content-inventory
numbers as dated 2026-08-11 and re-verify against the live DB before relying on them for a real
decision.

---

## 7. What did NOT happen this session (by design)

- **No deploy.** Every fix is a local commit on `main` (`9e7ac9d`, `d0d4d71`, `63993ec`) — the live
  site at `www.easewithexam.com` is completely untouched. Per standing instruction, nothing gets
  deployed without an explicit go-ahead.
- **No push to a remote.** Commits are local only.
- **No data wipe, no destructive action, no real payment.** The signed-in test account is a real
  production account and one real quota-consuming practice-paper generation was run against it
  deliberately (see §1) — nothing was deleted, and no payment/Razorpay flow was touched.
- **No deep admin-portal testing.** Only `/admin/login` itself was checked (loads clean). Actual
  admin features need real Google + passcode credentials this session didn't have.
- **No real (non-test-number) Google OAuth click-through.** Structurally can't be automated; if you
  need this verified, it needs a human clicking through it once, in a real browser.

## 8. If you're continuing this work

- All temporary test scripts and screenshots created during this pass were deleted afterward — they
  added no lasting value once their findings were written up here. The one exception,
  **`scripts/qa-set-test-phone.mjs`**, was kept (committed) because it's genuinely reusable
  infrastructure: idempotent, safe to re-run, and needed again the next time someone wants to
  automate the real phone-OTP flow.
- If you rebuild an E2E harness from scratch, start from §1's snippet — it's the distilled, working
  version of several failed attempts (real Google OAuth: undrivable; `?qa_uid=` bypass: dead;
  headless reCAPTCHA: blocked; non-headless reCAPTCHA: also blocked, Chromium automation is
  detected regardless of the headless flag).
- The generation-time UX gap flagged in §3.2 (no progress feedback during a 30-120 second wait) is
  the single highest-value follow-up surfaced this session — it's a real, felt problem for any
  student generating more than a handful of questions, and the honest-copy fix here is a bandage,
  not a real fix.
