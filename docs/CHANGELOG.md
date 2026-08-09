# Changelog

Running log of changes made to this project, newest first. One file, appended to — see `docs/ACTION_ITEMS_FOR_YOU.md` for the standing list of things blocked on the project owner, and the two 2026-07-15 review docs for the original audit/architecture findings this work traces back to.

---

## 2026-08-10 (session 13b) — production: admin login unblocked, avatar upload fixed

Two production issues, both traced to infrastructure rather than app code.

**Admin login showed "Run the latest migration in Supabase".** Not a missing migration — the opposite. `get_admin_record` stopped returning the passcode hash to the browser when the auth-hardening migration landed (it was leaking the hash), but the frontend that understood the new `has_passcode` shape had never been deployed. Proof, from the backup of the previously-deployed bundle: `AdminGuard-DO2sSrat.js` referenced `passcode_hash` 3 times and `has_passcode` zero times, against a server that now returns only the latter. The old client therefore read `undefined`, concluded no passcode was set, offered the first-time setup screen, called `admin_set_passcode`, got `false` (a passcode already existed), and had no recovery branch — so it blamed the migration. Both superadmins were healthy server-side throughout: passcode set, 0 failed attempts, not locked. Nothing was damaged, because `admin_set_passcode` refuses to overwrite an existing passcode. Resolved by the frontend deploy; affected sessions need a hard reload to drop the cached service-worker shell.

**Avatar/logo upload failed with "Bucket not found".** Also not an app bug: `AdminPlatformSettings` (EWE avatar + platform logo) and `CoachingSettingsPage` (centre logo) have always uploaded to a `platform-assets` bucket that was never created. Only `question-papers` and `documents` existed.

Created it with a tighter posture than the existing buckets, which grant `ALL` to `anon` — anyone holding the public anon key can upload to those. `platform-assets` is public-read (the avatar renders for signed-out visitors) but writes require `is_verified_admin()`, and the 2 MB cap plus an image-only MIME allowlist are enforced server-side rather than trusted from the browser. Verified under enforced RLS: admin upload allowed, signed-in non-admin blocked, anon blocked, anon read allowed. Confirmed at the Storage API too — the bucket now returns `NoSuchKey` for a missing object, matching the known-good bucket, where before it returned `NoSuchBucket`.

No frontend change was needed for the bucket fix, so no redeploy was issued.

---

## 2026-08-10 (session 13) — Phase 1: multimodal extraction + content classification

Implements §1 and §2 of the content-pipeline audit. Existing `knowledge_base` rows were disposable test data being re-uploaded from source, so this migration **truncates rather than backfills** and drops `tags[]` outright instead of keeping a compatibility shim.

### Two production bugs found while building this

**1. Browser-side PDF extraction was completely broken.** `pdfAnalyzer.js` imported `pdfjs-dist@6.0.227/build/pdf.min.js` — a URL that **404s**, because pdfjs v6 ships ESM only (`pdf.min.mjs`). Every browser PDF read failed at the loader before reaching extraction, which means the whole Content Intake screen was non-functional. The worker URL immediately below it was already `.mjs` and correct, which is exactly what made the mismatch easy to miss. Fixed, and given a local `pdfjs-dist` fallback so a CDN outage no longer takes ingestion down — the package is already a dependency.

**2. `content_figures` could never be written to.** My own migration enabled RLS with a SELECT policy and nothing else, so every INSERT was denied. Caught by the Pilot B run, which extracted two figures and then failed to record either. Writes are now gated on a new `is_verified_admin()` (reads the Firebase JWT `sub`, checks `admins`) rather than opened to everyone — `knowledge_base` being wide open is a pre-existing weakness to narrow later, not a pattern to copy into a new table.

### Multimodal extraction (§1)

New `src/lib/pdfVision.js`: `renderPageToCanvas` / `renderPageToImage` / `visionExtractPage` / `cropCanvas` / `uploadFigure`, orchestrated by `extractPagesWithVision`. Deliberately a **text-layer repair plus a figure/equation sidecar**, not a replacement for the structuring pass — a repaired page flows into the existing `runNotesExtraction` / `runPYQExtraction` unchanged, so the blast radius stays inside extraction.

**The thin-text gate alone silently failed half the job.** Pilot A on a real NCERT Physics chapter returned **0 figures and 0 equations**: the text layer is clean, so `needsVision` was false on all 22 pages, so vision never ran, so its diagrams were never seen. The gate is right for text repair and wrong as the only route to figures. Added a second independent trigger — `pageHasRasterImage()`, read off pdfjs's operator list (`paintImageXObject`), which is what the renderer will actually execute and so can't be fooled by prose that merely mentions "Fig. 4.1". Re-running then found **14 figures and 44 equations**. A figure-page's good text layer is never overwritten by the transcription; only genuinely thin pages are repaired.

Deviations from the audit, confirmed with the owner: **JPEG** page input (a 2x A4 PNG is 1.5–3MB, base64 adds a third, per page, through an edge function — q0.85 lands 150–350KB with no OCR cost; figure crops stay PNG for line art), and a **40-page vision cap** per document so a 300-page scan can't arrive as an unannounced bill. `ai-proxy` needed no change — it forwards the request body verbatim.

Bounding boxes get validated before use (`isUsableBbox`): vision models identify *that* a figure exists far more reliably than *where*, so a malformed or implausible box falls back to the full page image, which is a usable figure rather than a confidently-wrong crop.

### Classification (§2)

The existing notes-extraction prompt now also returns `content_type` / `technique[]` / `difficulty` / `confidence` per chunk — same single AI call, no extra pass. These land in **real, CHECK-constrained columns** with `normaliseClassification` mapping anything unrecognised to NULL, because a mislabelled chunk is a retrieval-quality problem while a rejected insert loses the entire upload.

`match_knowledge_base` was replaced with a filtered variant taking exam type, chapter, content type, difficulty and techniques. This is the change everything downstream depends on: the vector store went from "semantic only" to **"filter, then rank"**. Previously chapter/exam scoping existed only as `tags.cs.{...}` string containment on the keyword *fallback* path — the semantic path could not narrow beyond subject at all, so a Class 8 query could rank a Class 12 chunk top.

All 9 `tags[]` consumers updated. Most got **simpler**: `PracticeGeneratorPage` no longer flattens a mixed array and strips exam tags to guess which entries were chapter names, and `AdminContentLibrary` no longer reconstructs board/class filtering through `examTypeToTag` round-trips. `getKBTopics()` was deleted — zero callers.

### Retired

`scripts/ingest-ncert-folder.mjs` (and its 800-char slicer) and `scripts/backfill-kb-embeddings.mjs` are gone; the semantic chunker in the intake path is now the single ingestion route. Two divergent chunk shapes in one table would have caused retrieval problems that are very hard to diagnose later. Extraction logic moved out of the JSX into `src/lib/contentExtraction.js` so it's testable without an admin session.

### Verification

20 new unit tests (`pdfVision.test.js`) covering the gate boundary at 79/80/81 chars, bbox rejection cases, the vision payload shape, and graceful degradation on malformed responses — plus AbortError propagating rather than being swallowed into "this page had no text". 17 SQL checks over the new RPC: each filter narrows, filters compose, unmatched filters return empty rather than everything, the legacy 3-arg call still resolves, and both CHECK constraints reject drifted casing (`'Theorem'`, `'Medium'`).

Pilots run through the real production modules via `npm run pilot`:

- **Pilot A** (NCERT Class 11 Physics, 22pp): 0 thin pages, 22 figure-bearing pages, 14 figures cropped, 44 equations, 18 chunks classified and inserted with every real column populated. **~4.7 min and 22 vision calls** — that is the honest per-chapter cost of figure extraction.
- **Pilot B** (synthetic image-only scan, 2pp): 0 chars/page → vision fires on both → 1,850 and 3,788 characters recovered → 3 chunks classified. **This PDF would previously have been rejected outright.**

### Pilot B re-verified against a REAL scan

The synthetic fixture is retained as `npm run pilot BS` (a committed regression fixture that needs no real scan on hand); `npm run pilot B` now points at the genuine scanned paper.

The real input turned out to be the hard case: a **photograph of a computer screen** showing an NCERT page — browser tab chrome across the top, screen glare, moiré/scanline interference over the whole frame, mild perspective skew, and a diagonal "© NCERT not to be republished" watermark across the figures.

**OCR came back word-perfect.** 1 page, 0 chars of text layer → `needsVision` fired correctly → 580 characters recovered, compared line by line against the rendered page:

- Every word of every sentence matches, including the curly quotes in `'quadrilateral'` and the em-dash.
- Italics (`*quadri*`, `*latus*`) and bold (`**angles**`) preserved as markdown, matching the source typography.
- **Zero** substitution errors attributable to skew, glare, contrast or moiré — the specific failure modes the synthetic fixture could not test.
- Screen furniture (browser tabs, the `×` and `+` buttons) and the watermark were correctly excluded rather than transcribed as content. The `[FIGURE 1]` placeholder landed exactly where the figures sit.
- Only omission: the `0874CH04` print code in the top-right margin. Page metadata, not content.

Classification, persistence and RLS all verified: 3 chunks → `content_type` `prose`/`prose`/`diagram`, `class_level` parsed to `'8'`, embeddings present, `source_ref` provenance intact. `content_figures` writes confirmed to **allow a verified admin and block a non-admin** under enforced RLS (the pilot's own denial is correct — it runs unauthenticated).

### Figure cropping failed verification — now disabled

Inspecting the actual uploaded images (rather than trusting the counts) showed **5 of 5 model-supplied bounding boxes were materially wrong**: three of Pilot A's crops contained nothing but body text, a fourth clipped a real figure in half while dragging in unrelated paragraphs, and the scanned page's box caught three of five figures plus text with its left edge cut off. Every one of those boxes was well-formed and plausibly sized, so `isUsableBbox` passed them all — the boxes are not malformed, they are simply inaccurate. That is a known VLM weakness: these models identify *that* a figure exists far more reliably than *where* it is.

Counting figures would have reported this as a success. Looking at them is what caught it.

`CROP_FROM_MODEL_BBOX` is now **off by default**: the figure image is the whole page, uploaded once per page and shared by every figure on it. Coarser, but it always actually contains the figure, and a student sent to the page it came from is strictly better served than by a confidently-wrong crop of the wrong region. Captions — which were consistently accurate ("Five geometric figures labeled (i) to (v), with (i), (ii), and (iii) being quadrilaterals") — plus chapter and page are what make figures findable. The model's box is still stored on `content_figures.bbox` as advisory metadata so a future pass can be scored against it.

**Follow-up (not Phase 1):** derive figure rectangles geometrically by tracking the CTM through `paintImageXObject` in pdfjs's operator list, instead of asking a model to eyeball coordinates. That is the real fix for tight crops.

---

## 2026-08-09 (session 12) — referral rewards gated on payment, admin referrals screen, toggle UI fix

### Referral payout moved to conversion

Owner's call: the referral should only complete once the referred student actually pays. Session 11 granted both sides 7 premium days the instant a code was redeemed — which rewards **signups**, and signups are free. One person could create accounts, redeem their own code from each, and mint premium days indefinitely. It also spent the reward on users who may never convert.

Redemption is now two-phase:

| | what happens |
|---|---|
| `redeem_referral_code()` | records a **pending** claim. No days, no counter movement. |
| `complete_referral()` | fires from `activate_subscription()` after Razorpay's signature is verified server-side. Grants both sides 7 days and moves the referrer's counters. |

Phase 2 is not reachable from the client in any useful way: `activate_subscription` is behind the `app.subscription_secret` shared secret that only the `razorpay-verify` edge function holds, and `complete_referral` additionally refuses unless the caller genuinely holds an active, non-free, unexpired subscription row. The call is wrapped in its own exception block — the student has already paid, so nothing about a referral is worth failing the activation over.

**Fixed a latent bug shipped in session 11 while doing this.** `subscriptions` has `UNIQUE (user_id)`. `referral_grant_premium_days` looked for an *active, unexpired* row and INSERTed when it found none — so any user with a **lapsed** subscription would hit `subscriptions_user_id_key` and take the whole redemption transaction down with a `unique_violation`. Now upserts, and extends from `NOW()` rather than from a past expiry date.

`uses` now means *converted* referrals, so `get_or_create_referral_code` returns a fourth column, `pending` — without it a referrer whose friend has signed up but not yet paid would see a flat zero for weeks with no signal anything was in flight. The Profile card shows three numbers now (Subscribed / Joined, not yet / Days earned) and no longer reloads the page on redemption, because there is no new subscription state to pick up.

Copy was corrected everywhere the promise is made — the card, the redeem confirmation and the share message all now say the days arrive **when you subscribe**, with a regression test asserting the confirmation never claims premium was "added to your account".

Verified end-to-end against production in a rolled-back transaction, all 21 checks: redemption returns pending with counters untouched, conversion refused without payment, payment converts and grants (referee 30d + 7d = 37d, referrer 7d), a webhook retry is a no-op, a **lapsed-subscription** user redeems and pays cleanly into one row (365 + 7 = 372d), an **admin comp leaves the referral pending** (it goes through `admin_grant_subscription`, which deliberately does not call this path), and the referrer is notified exactly once per conversion.

### Admin referrals screen

There was nowhere in admin to see any of this. New `admin_list_referrals(p_caller)` RPC (superadmin/admin gated, refusal verified) plus `AdminReferrals.jsx`, added as a **Referrals** tab under **Students** alongside Subscriptions. Shows referrer, code, referred student, converted/awaiting-payment status, both dates, and per-referrer totals, with search and an all/pending/converted filter. Four counters across the top: codes created, pending, converted, premium days given away.

It `LEFT JOIN`s from `referral_codes`, so a student who generated a code but never landed anyone still appears — early on that is most of them, and hiding them would make the screen look empty.

Not visually verified: the screen needs a real admin session (passcode in `sessionStorage`), which the QA bypass can't produce. The RPC is verified directly, including that it returns unused codes and correct pending/converted splits.

### Notification toggle UI

The switches on Profile → Notifications rendered as plain coloured pills with the knob missing or hanging off the right edge. Cause: the knob was `absolute top-0.5` with **no `left`**, so it started from its static position — which sits after the `<button>`'s UA default horizontal padding, pushing the "on" position past the track. Extracted a single `Toggle` component (the markup was duplicated for push and email), laid the knob out as a flex child moved by `translate-x` instead of absolute positioning, and added `p-0`/`border-0` so UA defaults can't shift it again. Also picked up `role="switch"`, `aria-checked`, a focus-visible ring, and the busy spinner now sits inside the knob rather than floating over the track.

---

## 2026-08-09 (session 11) — referral system built, landing images filled, footer socials removed

Three requests: fill the landing page's placeholder image slots, implement the referral system, remove the footer's social links.

### Referral system

**It did not exist.** What was there looked like a finished feature and wasn't: three overlapping tables (`referral_codes`, `referral_uses`, `referrals`), a "Refer & Earn" card on `ProfilePage`, and exactly one function — `get_user_referral(p_uid)`, which SELECTs from `referral_codes`. Nothing in the codebase ever INSERTed into that table, so the RPC returned zero rows for every user, the card's `{referral && ...}` guard never passed, and **no student has ever seen it**. There was also no way to enter a code, no crediting logic, and nothing that turned a referral into a reward.

Decisions taken, since the schema didn't imply them:

- **`referral_codes` + `referral_uses` own the feature.** `referrals` was the shape used by the deleted `src/lib/referral.js` (a different, deterministic `EWE-XXXXXX###` scheme); it was empty and unread, and dropped. Leaving a third half-schema in place is what made this confusing to begin with.
- **A credit is a premium day.** Not invented — the Profile card already said *"earn premium days when they join"* and already labelled `credits_earned` as *"Days earned"*. The database now matches the promise the UI was already making.
- **Both sides get 7 days.** A one-sided referral gives the new student no reason to type the code in.

`20260809060000_referral_system.sql` adds `get_or_create_referral_code` (creates on first call, which is what makes the card render at all), `redeem_referral_code`, and `referral_grant_premium_days`. Both entry points check `verified_uid()` against the passed uid. Redemption returns a jsonb result rather than raising, because every rejection is a normal thing a student can do by accident and each needs its own message: `invalid_code`, `self_referral`, `already_redeemed`, `account_too_old` (30 days, so an existing user base can't refer each other in a circle after the fact). The `UNIQUE` on `referral_uses.referred_uid` is what actually closes the concurrent-double-submit race; the pre-check is only there for the friendly message.

**The reward grants a real plan, not a made-up one.** `referral_grant_premium_days` extends an existing active subscription rather than inserting a second row — `get_student_effective_plan()` takes the first active row it finds, so two rows would make the effective plan depend on scan order. It grants `premium_monthly` because that is a real `plan_id` in `quota_config`; a plausible-looking `'referral_bonus'` would miss `quota_config` entirely and silently fall back to `FREE_LIMITS` in `resolveQuota()` — a reward that grants nothing.

Verified end-to-end against production inside a rolled-back transaction, standing in for two signed-in users via `request.jwt.claims`. All 16 checks passed: unauthenticated call rejected, code created, second call idempotent, impersonation rejected, self-referral rejected, bad code rejected, redemption succeeds with a lower-cased and space-padded code, second redemption rejected, 400-day-old account rejected, referrer counters at `uses=1 credits_earned=7`, both parties on `premium_monthly`, one subscription row each at +7d, a second grant extending to +14d across **one** row, the referrer notified, the audit row written, and the code matching the no-`0/O/1/I/L` alphabet.

Client side: new `src/lib/referral.js` (20 unit tests), the Profile card rewritten as a self-contained `ReferralCard` with share, copy and a code-entry field, and `captureReferralFromUrl()` in `main.jsx` parking a `?ref=` code in localStorage until onboarding creates the account. `applyPendingReferral` is deliberately silent — it clears the pending code on every outcome, so a stale code can never wedge a student on their first screen. `get_user_referral` was dropped; a read-only function that can only ever return zero rows is exactly the trap that made this look implemented.

### Landing images

All six slots are now **real screenshots of the running app**, not stock art or mocked-up UI. Captured through the DEV-only `?qa_uid=` bypass in `AuthContext.jsx` against a seeded demo account, then cropped and composited: `hero-collage` (dashboard plate with the analytics score trend and onboarding card layered in front, on transparency), `showcase` (dashboard), `feature-tutor` (the Ask EWE thread), and `step-1..3` (sign-in card, board picker, practice generator) matching the three step captions.

Reproducible rather than one-off — `npm run landing:shots` and `npm run landing:assets` (`scripts/landing-*.mjs`, Playwright is already a devDependency). Raw captures land in the gitignored `.landing-shots/`; only the cropped results are committed. The demo account and its seeded rows were deleted afterwards. Retired assets from the previous design (`ewe_img.png`, `hero-illustration.png`, `why-section.png`, ~3.7MB) removed.

Two framing details worth keeping: the dashboard is cropped to 1650px because the sidebar is full-height and its profile row would otherwise leak the test account's email; and `showcase.png` is near-square because that slot is `object-cover` in a roughly 1:1 box, so a wide image loses half its width to the centre crop.

**Noticed while capturing, not fixed:** the dashboard hero reads *"0 days to go"*. `Dashboard.jsx` hardcodes `EXAM_DATES = { NEET: '2026-05-03', ... }`, all of which are now in the past, and the countdown clamps at zero. Every NEET/JEE student currently sees this. Needs the 2027 dates, or better, an admin-editable row — left alone because the official 2027 dates aren't published yet and guessing them would be worse than showing zero.

### Footer

Social icons removed from `PublicChrome.jsx` (`Facebook`/`Instagram`/`Youtube`/`Linkedin` imports dropped, grid rebalanced to `1.8fr_1fr_1fr`). Shared chrome, so About, Contact, Privacy and Terms pick it up too.

---

## 2026-08-09 (session 10) — landing page rebuilt from reference designs

Owner supplied 11 reference screenshots of a course-platform landing page: use that structure, swap the reference orange for the brand green, **no gradients**, image slots may stay placeholders, and section content must be EWE's real concept rather than filler.

**The real design problem was truthfulness, not layout.** Five of the reference's sections are pure social proof — "4.9★ 10k+ reviews" with an avatar stack, a *trusted by Google / Udemy / Khan Academy* logo row, two testimonial carousels, a "15.000+ / 500+ / 95%" stats band, and "Join 5000+ Learners". EWE has two real accounts and no partner relationships, so filling any of those means inventing reviews, logos and user counts. Agreed with the owner to keep each section's visual rhythm and substitute facts that are actually checkable: trusted-by → the syllabi genuinely supported (CBSE, Kerala State, NEET, JEE Main, JEE Advanced); stats band → "6 subjects · Classes 8-12 / 5 exam patterns / 24×7 tutor / 20 free questions a day"; testimonials → a "What makes it different" card grid (Socratic tutor, generated figures, SM-2 spacing, misconception engine); the newsletter block dropped entirely, since no subscriber backend exists and the count would be fabricated.

New `src/lib/landingContent.js` holds all page copy so wording is a one-file change, and **derives the free-tier numbers from `FREE_LIMITS`** rather than restating them.

**Found while sourcing the FAQ:** `HelpPage.jsx`'s FAQ claimed *"Free accounts get 15 AI questions, 20 EWE messages, and 3 mock tests per day."* All three numbers were wrong — the enforced limits are **20 questions, 15 messages, and 2 mock tests per WEEK**. Stale on a help page; on a landing page that becomes a false pricing claim. Both surfaces now read from the shared module, with the numbers interpolated from the constant the quota gate actually enforces.

Page order: hero → syllabus strip → split showcase with 2×2 value grid → feature bento (the 7 real tools) → three light step cards → green facts band → differentiator cards → **all four real plans at real ₹ prices** (₹0 / ₹399 / ₹3,999 / ₹4,999, yearly highlighted) → category-rail FAQ accordion → dark closing band. `PublicChrome.jsx` also rebuilt (centred nav links, Sign Up outline + Get Started solid, Explore/Company footer columns with socials and a legal bar) — shared, so About, Contact, Privacy and Terms pick it up too.

**No gradients meant real work, not a colour swap:** the old page used them in the image placeholder, the hero backdrop blobs, the highlighted plan card and the closing banner. All are flat fills now. Verified by computed style rather than by grepping class names — `getComputedStyle(el).backgroundImage` matched `gradient` on **0 elements** across `/`, `/about` and `/contact`, at 1440px and 390px, with no horizontal overflow and no console errors on any of them.

`ImgOrPlaceholder` was kept and reused — it already did exactly the "real image if present, styled placeholder if not" behaviour asked for. `public/landing/README.txt` now documents the new slots (`hero-collage`, `showcase`, `feature-tutor`, `step-1..3`) and lists the retired ones as safe to delete.

---

## 2026-08-09 (session 9) — app icon

Owner supplied `ewe_app_icon.png` (500x500). Moved it to `public/` and generated the real icon set from it via the browser's canvas (Playwright) rather than adding an image library: `icon-192`, `icon-512`, `icon-maskable-512`, `apple-touch-icon` (180) and `favicon-32`.

Two things worth doing properly rather than pointing every `<link>` at one big PNG:

- **Maskable needs its background bled to the edges.** The manifest previously declared `purpose: 'any maskable'` on a single transparent-corner icon, which tells Android that icon is safe to crop — so a circular or squircle mask cut into the artwork. The maskable variant now samples the artwork's own background colour (`rgb(60,142,168)`) from just inside the rounded square, fills the full square with it, and insets the wordmark into the middle 80% safe zone. `any` and `maskable` are separate manifest entries now.
- **iOS renders `apple-touch-icon` opaque** and applies its own rounding, so that variant gets the solid background with full-bleed artwork (no inset) instead of the transparent-corner file.

Also fixed the notification icons flagged in session 6: `push-handler.js`, `notifications.js`, `AdminTestData.jsx` and the `send-push` edge function all referenced `/pwa-192x192.png` and `/pwa-64x64.png`, **neither of which has ever existed** in `public/` — so every push and local notification rendered with a blank/default icon. All now point at `icon-192.png` / `favicon-32.png`.

---

## 2026-08-09 (session 8) — nine-item bug sweep

**Quota: `upsert_usage_quota` rejected `podcasts_used`.** Its whitelist listed six fields but never podcasts, despite `FREE_LIMITS`, `FIELD_LABELS`, `quota_config` and the Sidebar usage panel all carrying it. Currently masked — `incrementQuota()` picks between this and `check_and_increment_quota()` on the `atomic_quota_rpc_enabled` flag, that flag is on, and the atomic path handles podcasts fine — but the moment anyone flips that flag to its documented "safe fallback", every podcast would silently stop counting, because `incrementQuota` swallows the error in a bare catch. Rewrote the whitelist to derive from `information_schema` (still constrained: real `%_used` columns of that table only, since the name is interpolated into dynamic SQL) so a future quota column can't drift out again. Verified all four real fields now return 204 and a bogus field still 400s. Also confirmed the TTS route works (57KB audio), so podcast generation itself was never the problem.

**Admin could not review a generated paper.** `AdminPublishedTests`'s expanded row showed "First 5 questions" as 2-line-clamped text — no options, no correct answers, no figures. Replaced with a full scrollable review: every question, options with the correct one marked, answer, explanation, marks, and the rendered figure. Matters more now that questions carry generated diagrams, which are precisely the thing most likely to be wrong and most in need of a human look; an unrendered figure now shows its description in amber so a failed generation is visible rather than silent.

**Paper Gen modal had no max-height.** `p-6 space-y-5` with nothing bounding it, so on a short laptop screen the modal grew past the viewport and "Start Generating" was unreachable — nothing scrolled, because the modal overflowed its fixed parent rather than scrolling internally. Now `max-h-[90dvh] flex flex-col` with a scrolling body and the CTA pinned in a footer outside the scroll area.

**Subscriptions showed a raw 28-char Firebase UID** as the only identifier — unusable for deciding whose subscription you're about to downgrade. Joins `adminGetAllUsers` on, shows name + email, falls back to the UID when a user row is missing, and search/confirm dialog now match on name and email too.

**Exam Center:** the filter row rendered "All | CBSE Class 12" for a Class 12 student — a filter with nothing to filter, restating what they told us at signup. Hidden whenever every visible paper shares one exam type. Separately, background generation could finish while the page was already mounted, so a new paper never appeared until a manual reload; it now refetches on tab focus/visibility and on a new `ewe:paper-ready` window event dispatched by `backgroundGeneration.js` (same decoupled pattern as `ewe:quota-updated`).

**Notification bell:** `.touch-target` forces 48x48, correct for a thumb but leaving an 18px icon adrift in a large empty box on desktop with the badge parked at the corner of that box rather than on the bell. Now 48px on mobile, 40px from `lg:`, with the badge tightened to match.

**Tab inconsistency:** `HubTabBar` uses an animated subtle pill (`bg-primary-50` + `layoutId`), while `PaperModePage`'s tab bar used a heavy solid `bg-primary-600` fill with no animation — two treatments for the same control. Paper Mode now uses the same animated-pill pattern.

**EWE avatar is now admin-editable.** New `ewe_avatar_url` platform setting with an upload row in Platform > Settings (same flow as the logo, separate state so the two uploads can't clobber each other). `VedaAvatar` reads it and falls back to the brand logo when unset or if the image fails to load, so it applies everywhere EWE speaks — chat bubbles, Doubt Studio intro, header chip — with no code change.

Follow-up after the owner reported that chemistry bonds were still wrong, labels still overlapped, and online mode couldn't be started.

**Online exam was unreachable — a real dead end, fixed.** Opening `/paper-mode` locks the attempt to `paper`, and `MockTestPage` then redirects `/test` straight back. The only escape was "Start Fresh" *inside* `MockTestEngine`, which is unreachable precisely because of that redirect — so any student who merely previewed the printable paper was permanently locked out of online mode. Confirmed from `exam_attempt_mode`: the owner's account held a `paper` lock on the test. Cleared the locks and added a **"Switch to Online Mode"** action to Paper Mode's tab bar, shown only while `evalResult` is null so it can't be used to re-attempt a graded paper.

**Two rounds of prompt tuning fixed layout but not chemistry.** Adding explicit layout rules (reserved 60px label margin, no text over geometry, leader lines, deliberate `text-anchor`) removed the overlaps. Adding per-subject **symbol conventions** — what a battery/resistor/ammeter/lens actually looks like — moved circuits and ray optics from unusable to genuinely good; before that the model drew a "circuit" as a grid of plain rectangles with no symbols at all. A `y = x²` graph also came out inverted, which is the dangerous failure mode: a figure that contradicts its own equation teaches the wrong thing, so the Mathematics conventions now require plotting real points and re-checking curvature against SVG's downward y-axis.

**But chemical structures kept failing, and that was the signal to change tools, not prompts.** Benzene rings kept coming out with no alternating double bonds. Drawing a molecule correctly needs bond lengths, ring geometry and layout rules a language model isn't computing. What it *is* excellent at is emitting SMILES, because SMILES is text. So chemistry structures now route: model produces the SMILES string, and **smiles-drawer** (a real cheminformatics layout engine, added as a dependency, lazy-loaded as a 196KB/60KB-gzip chunk) does the geometry. New `src/lib/chemStructure.js` handles description → SMILES → rendered structure; `attachDiagrams()` tries it first for `subject === 'Chemistry'` and falls back to the SVG path when the description isn't a single molecule.

Verified the routing behaves: phenol, CO₂, aspirin and acetic acid all resolved to SMILES and rendered as textbook-quality structures (aromatic rings with correct double bonds, proper substituent placement); the Daniell cell correctly returned NONE and fell through to SVG, since it's apparatus rather than a molecule.

**Where it stands now**, judged against the real exam figures the owner supplied as reference:

| Figure type | Path | Quality |
|---|---|---|
| Chemical structures | SMILES → smiles-drawer | **Exam quality** |
| Ray optics, free-body | SVG | Good |
| Maths geometry, graphs | SVG | Good |
| Circuits | SVG | Usable; topology occasionally off |
| Apparatus (galvanic cell) | SVG | Residual label overlap, salt-bridge shape wrong |
| Biology schematics | SVG | Weakest — recognisable but not anatomical |

**Still open:** apparatus and biology schematics remain the weak spots and are unlikely to be fixed by further prompt work — the same conclusion reached for molecules. The realistic answer for those is a curated figure library, which `AdminContentIntake`'s existing `has_diagram` attachment flow already supports: an admin uploads the real figure once and it is reused, rather than regenerated per paper. Also worth noting there is no automated check that a generated figure is *correct* — the inverted parabola passed every structural test (valid SVG, shapes present, labels present, nothing unsafe) and was still wrong, so admin review before publishing remains necessary.

Asked whether diagram-based questions (Physics ray diagrams, Chemistry bonding, Maths geometry) actually work. They didn't, in three separate ways.

**1. Paper Mode rendered no figure at all.** `QuestionView.jsx` (Online Mode) has always rendered `image_url` with a zoom overlay and fallen back to a `DiagramBox` description. `PaperModePage.jsx` — the printable paper, and the mode most likely to be used for a diagram-heavy physics paper — rendered only `q.question` and `q.options`. The `image_url` matches in that file were the *vision evaluation* payload (uploading answer-sheet photos to GPT), not question rendering. Added a `.q-figure` block plus print CSS (`page-break-inside: avoid`, 280px cap, `print-color-adjust: exact` so line diagrams survive greyscale printing). Verified the data path was already intact end to end — `toEngineFormat` and `publishPYQPaper` both carry `image_url`/`diagram_description` — so rendering was the only break. Added four `toEngineFormat` regression tests covering attached images, description-only, neither, and descriptive (non-MCQ) questions.

**2. Descriptions were being printed instead of drawn.** Project owner's correction, and the right call: `[Figure: A diagram of a parallelogram with two pairs of parallel sides]` is not a usable exam paper. New `src/lib/diagrams.js` generates the actual figure. **Chose LLM-authored SVG over DALL-E deliberately** — raster image models garble text labels and get geometry subtly wrong, which is worse than no figure when a student is learning from it, whereas SVG gives exact geometry, legible labels, stays sharp in print, and is far cheaper and faster (a NEET paper wants figures on 10-15% of questions). Delivered as a `data:image/svg+xml;base64` URI rather than inline markup: an `<img>` cannot execute script, so model-generated SVG is inert without needing `dangerouslySetInnerHTML`, and every existing render site already handles `image_url` unchanged. `attachDiagrams()` runs at the end of `generateQuestionPaper()` in batches of 3, only for questions that describe a figure and have no image (an admin-uploaded scan or real PYQ figure always wins), and never throws — a failed figure keeps its description so the render sites degrade gracefully.

Verified against three real generations: Mathematics (6 shapes / 4 labels), Physics ray diagram (12 / 6), Chemistry Lewis structure (8 / 3), none containing script/foreignObject/external refs. Checked the geometry rather than trusting it — parsed the parallelogram's polygon points and confirmed `AB ∥ DC` and `BC ∥ AD` with equal lengths and vertices labelled A–D. Then rendered it end-to-end in a browser through the real `/paper-mode?id=` route: figure present at 400×300 with correct labels.

**3. Found while testing: every admin-published test was invisible to every student.** The render check kept showing an empty paper. Root cause was unrelated to diagrams — the *live* `can_student_view_test()` differs from what `20260807000000` contains (that migration was applied by hand and later marked applied via `migration repair` without being run, so the file was never the source of truth). It requires an active `test_assignments` row targeting the student before an admin-created test is visible. `test_assignments` has **0 rows**, and no frontend code calls `admin_upsert_test_assignment` — the RPC surface was built but the UI never was. Confirmed live: `get_published_tests_for_student()` returned 0 rows while `admin_list_published_tests()` returned 5 for the same table. So every paper produced in Admin > Publish > Paper Gen was hidden from all students, permanently, with no way to reveal it. Fixed in `20260809040000` by making assignment an **optional narrowing**: a test with no active assignments is open to everyone (what Exam Center has always assumed), and once assignments exist only targeted students see it — keeping the targeting feature intact for when its UI is built. Verified: students now see published tests again.

Also confirmed a side effect of the previous session's hardening while cleaning up test data: `admin_delete_student` can no longer be called with the service-role key alone, because it requires a *verified* Firebase caller. That is correct behaviour, but it means ops scripts need a real admin ID token rather than just the service key.

---

## 2026-08-09 (session 5) — verified identity: Firebase tokens now proven server-side; CI fixed

The structural fix flagged last session, plus CI. The per-user table lockdown is **not** done — see the end.

**Firebase is now a Supabase third-party auth provider.** `[auth.third_party.firebase]` exists in `config.toml`, but `supabase config push` pushes the *entire* local config and aborted with `402 Please upgrade the project to a paid tier` on `[storage.vector]` — after it had already applied the auth section, a confusing half-applied state. Verified the auth part had NOT landed by minting a real Firebase ID token (Admin SDK custom token → `signInWithCustomToken`) and getting `PGRST301 No suitable key was found to decode the JWT`. Configured it properly through the Management API instead (`POST /config/auth/third-party-auth` with `oidc_issuer_url = https://securetoken.google.com/edutech-app-acenzos`); Supabase resolved Google's JWKS immediately (4 RS256 keys). Re-tested: the same token now yields `PGRST202 function not found` — i.e. the JWT was **accepted** and reached PostgREST as an authenticated identity. Also set `[storage.vector] enabled = false` locally so a future `config push` doesn't abort halfway again.

**The client now sends that token on every request.** `createClient` takes `accessToken: currentFirebaseIdToken`. Admin and student sessions are separate Firebase app instances by design, so the resolver picks `adminAuth` on `/admin/*` routes and `auth` elsewhere, falling back the other way rather than dropping to anon. Returning null stays valid — signed-out visitors hit public reads with the anon key alone.

**Authorization is now bound to a proven identity.** New `verified_uid()` (`auth.jwt() ->> 'sub'`, NULL for anon-key callers) and `assert_verified_admin(p_caller)`, which requires a verified token whose subject equals `p_caller` *and* is an active admin. Applied in two layers: a **role gate** revoking `anon`'s EXECUTE and granting `authenticated` across **81** `admin_*`/`coaching_admin_*` functions — that single change makes the whole admin surface unreachable without a real Firebase sign-in, with no function rewrites — plus **identity binding** inside the most destructive RPCs (`admin_list_users`, `admin_delete_student`), which additionally stops one signed-in user acting as another. `get_admin_record` and `admin_verify_passcode` stay anon-callable by design: they're the authentication step itself, return no secrets, and are rate limited.

Verified live, five cases:

```
anon key + real admin uid        -> 401  Access denied: unverified caller
ADMIN token + own uid            -> 200  (legitimate admin still works)
STUDENT token + admin uid        -> 401  Access denied: caller mismatch
ADMIN token + someone else's uid -> 401  Access denied: caller mismatch
anon + admin_delete_student      -> 401  Access denied: unverified caller
```

Student RPCs (`get_own_user`, `get_published_tests_for_student`, `get_onboarding_options`) deliberately stay anon-executable and were re-checked at 200 — they don't match the `admin_` prefix, so the dev QA-bypass harness (which has no Firebase token) keeps working.

**CI had never passed — two runs, both failed, nobody looked.** The cause was mundane: the `env:` block sat on the Build step only, so `npm test` ran without `VITE_SUPABASE_URL` and `createClient` threw `validateSupabaseUrl` at import. Moved env to job level with placeholder fallbacks so CI is a genuine clean-clone check even before repo secrets exist; bumped Node 20→22 (20 is deprecated on runners); added an explicit clean-clone build step — that is what would have caught both the outage and the `.gitignore` breakage, since a clean checkout only contains committed files; added a warning for untracked files under `src/`/`supabase/`; and added a `migration-drift` job that fails when local migrations and the linked project disagree, which has bitten this project in both directions. Confirmed locally that the suite passes under CI's exact placeholder env.

**NOT done — per-user table RLS, and deliberately so.** Real RLS is now *possible* for the first time, which was the point of the above. But auditing the call sites showed naive `using (user_id = verified_uid())` policies would silently break real features: `AdminOverview`, `AdminQuota`, `AdminStudentLookup` and `AdminTestData` read `daily_usage_quota` / `user_gamification` / `subscriptions` / `test_sessions` **directly** rather than through RPCs; `broadcastNotification` inserts `user_notifications` rows for *every* user; and `ParentDashboardPage` reads another student's `parent_student_links` and sessions. Those paths need moving behind SECURITY DEFINER RPCs *before* the policies go on, or the admin panel starts returning empty results with no error — the worst failure mode. Still the same ~14 tables / 62 call sites sized last session, but now much cheaper per table, since student-side access becomes a policy instead of an RPC re-point.

---

## 2026-08-09 (session 4) — admin auth hardening: a verified two-request full-admin bypass, closed

Triggered by the owner asking whether a client-side admin panel is sound architecture. Tested rather than reasoned about, and found a live, exploitable chain.

**The exploit (verified live, then closed).** Every `admin_*` RPC takes the caller's Firebase UID as a plain `p_caller text` parameter and trusts it — the consequence of Firebase Auth not being integrated with Postgres, so `auth.uid()` is NULL and each RPC hand-rolls its own check. The only thing standing between an attacker and full admin was that UID staying secret. It wasn't: `changelog` carried an anon-readable SELECT policy and **1,041 rows with `actor_uid` plus a helpfully-labelled `actor_role: 'superadmin'`**. Two requests with the public anon key (which ships in the client bundle by design) were enough:

```
GET  /rest/v1/changelog?actor_uid=not.is.null      -> superadmin UID
POST /rest/v1/rpc/admin_list_users {p_caller:UID}  -> every user's email, phone, name
```

A wrong UID correctly returned `Access denied`, so the check worked — it was checking the wrong thing. Separately, `get_admin_record` returned `passcode_hash` to any anon caller and `AdminGuard` compared it **in the browser**, so the second factor was both leakable (6-digit SHA-256, brute-forced offline in milliseconds) and bypassable outright via `sessionStorage.edu_admin_v1 = '1'`.

**Fixed** in `20260809020000_admin_auth_hardening.sql`: dropped the anon SELECT policies on `changelog` (admin reads already go through the `admins`-checked `admin_get_activity_log` RPC; the only direct client read, `changelog.js`'s `getEntityHistory()`, had zero call sites); `get_admin_record` now returns `has_passcode boolean` instead of the hash; and new `admin_verify_passcode(uid, hash)` does the comparison server-side with a 5-attempt limit and a 15-minute lockout. `AdminGuard.jsx` reworked so the client only ever learns pass/fail, and stale sessionStorage entries still carrying `passcode_hash` are force-refetched rather than trusted.

Verified after applying: changelog returns `[]` to anon; `get_admin_record` returns `has_passcode: true` with no hash; `admin_get_activity_log` still works for a real admin (no regression); and six wrong passcode attempts produced `attempts_left` 4→1 then `locked`. The test locked the superadmin out, so the lockout was cleared afterwards.

**Deliberately NOT fixed — the underlying model.** `p_caller` is still an unverified parameter; this migration removed the known way to *discover* a UID, it did not make identity provable. The real fix is verifying Firebase ID tokens server-side via Supabase's third-party auth support, which makes `auth.jwt()->>'sub'` trustworthy, lets real RLS replace the SECURITY-DEFINER-everywhere pattern, and collapses 100+ hand-rolled `p_caller` checks into one enforced invariant. That is a coordinated frontend + database breaking change — every RPC signature and call site is affected — so it needs its own planning pass and a synchronised deploy, not a drive-by.

**Also flagged, not active:** `CoachingPortalGuard.jsx` carries the identical client-side passcode comparison. `coaching_admins` has 0 rows and `COACHING_MODULE_ENABLED` is false, so there's no live exposure, but it needs the same treatment before that module is re-enabled.

**Remaining lockdown backlog (measured, not done).** The wide-open-policy pattern still sits on ~14 per-user tables — `subscriptions`, `test_sessions`, `notification_prefs`, `user_gamification`, `daily_usage_quota`, `user_chapter_progress`, `user_daily_tasks`, `study_goals`, `user_notifications`, `parent_student_links` and others (the same follow-up first flagged in the 2026-08-06 batch-3 notes). That's **62 direct client call sites** to re-point through RPCs — genuinely the same scale as the A1/A2/A3 batches, each of which took a full session with live verification. Sized here so it can be scheduled rather than attempted piecemeal.

---

## 2026-08-09 (session 3) — Exam Watch was fabricating notifications: it never fetched any page

Reported symptom: Admin > Ops > Exam Watch showed only two notifications, both "NEET UG 2024", on a 2026-08-08 scrape.

**Root cause: `src/lib/examAlerts.js` never scraped anything.** `fetchExamAlerts()` sent GPT-4o a prompt containing only the source's *name, URL and category as text* — the URL was never requested — and asked it to "list ALL currently relevant notifications ... from this organisation". That is model recall presented as scraping. The prompt's own "no hallucinations" instruction was inert: with no source material, recall is all the model has. The `exam-scraper` edge function, which does real fetching, existed but **nothing called it** — dead code since it was written.

The output was confidently wrong in a way that's easy to miss: "NEET UG 2024 Application Form Released — candidates can apply online through the official CBSE website", with a Dec-2023 application window and a 05 May 2024 exam date. **CBSE has not conducted NEET since 2019** (NTA does), and the scrape ran in August 2026. Initially misdiagnosed as an Akamai 403 on the CBSE URL (which is real — the page returns a 318-char "Access Denied" stub) before reading `examAlerts.js` and finding the fetch never happened at all.

**Fix.** Rewrote `examAlerts.js` to delegate to the `exam-scraper` edge function, and hardened that function so it cannot fabricate: (1) refuses non-OK HTTP responses; (2) refuses when extracted text is under 500 chars — a redirect stub, bot-block page or nav-only chrome, never enough for a real notification; (3) refuses short pages matching an error-page signature (access denied / captcha / cloudflare / error 4xx), which catches bot-blocks served with HTTP 200; (4) rewrote the prompt to supply the page text in explicit delimiters and forbid prior knowledge, stating that an empty result is correct and expected. Also added a `caller_uid` admins-table check — the function runs with `verify_jwt: false` and spends real money on gpt-4o per call, so it was an open, unauthenticated endpoint. De-duplication moved server-side, and `last_scraped` is now stamped **only** on a genuine successful read, so a permanently blocked source keeps showing as stale instead of looking healthy.

`AdminExamWatch.jsx` no longer optimistically stamps `last_scraped` on failure (it did so unconditionally, masking every failure), surfaces a per-source reason on the source card, and reports failures in the summary toast — "found 0 notifications" reads like "nothing new was published" when it actually means every source was blocked.

**Verified live against the deployed function:** non-admin caller → `access_denied`; the CBSE URL → `http_error 403` with no model call and no rows written; `mcc.nic.in` → succeeded with 2,003 chars and extracted one item. The contrast is the proof — the new MCC row reads "NEET UG Counselling **2026** Round 1 registration" with **every date null** (the model declined to invent any), versus the old fabricated rows' invented 2023/2024 date range. Deleted the two fabricated CBSE rows.

**Worth knowing for content ops:** of the nine preset sources, only 3 return usable content from a local network (`nta.ac.in`, `jeeadv.ac.in`, `aaccc.gov.in`); five refuse connections and `cbse.gov.in` 403s. Reachability differs by network — `mcc.nic.in` fails locally but works from Supabase's edge — so the practical test is running a scrape, not curling from a laptop. Several of these sites are also JavaScript-rendered, which plain HTML extraction can't read regardless of reachability. The existing CBSE monitored source is permanently blocked and will now correctly report as such rather than silently producing invented rows.

---

## 2026-08-09 (session 2) — onboarding rebuilt: board+class always, competitive exam as an add-on

Reported symptom: onboarding asked for class twice — once disguised as an "Exam / Target" choice (`CLASS_8`…`CLASS_12` sitting alongside `NEET`/`JEE_MAIN`), then again as its own step — and offered NEET/JEE to Class 8 students. Investigating it surfaced a modelling error underneath and three real bugs.

**The modelling error: the goal was treated as exclusive.** A Class 12 CBSE student preparing for NEET is preparing for *both*, and a single `target_exam` field can't express that — so `buildExamType()` had to pick a winner, and picked wrong. Verified live: `NEET | CBSE | 8` resolved to `"CBSE Class 8"`, meaning **8 of the 15 real users had chosen NEET and were being served CBSE Class 8 content** in paper gen, practice, daily challenge, study plan, flashcards, Veda and syllabus tracker. `buildExamType` has 14 call sites, so this was the single highest-leverage fix in the codebase.

**New model.** `class_level` and `syllabus` are universal and asked first; `target_exam` becomes the optional competitive add-on (`'NONE'` when board-only — already a recognised sentinel in `formatExamLabel` and `Sidebar`). Flow is now class → board → competitive, with the competitive step gated by a new `allowed_class_levels` column and skipped entirely when nothing qualifies (classes 8–10 get a 2-step flow). Replaced the single-winner resolver with `getSchoolExamType()` / `getCompetitiveExamType()` / `getExamContexts()`; `buildExamType()` stays as a competitive-first alias so no call site broke in the same commit. Scope narrowed per product decision to classes 8–12 and CBSE + Kerala State.

**Two more bugs found while tracing it.** (1) Onboarding stores `syllabus` as `KERALA_STATE` while `BOARDS` holds `"Kerala State"` — `'KERALA_STATE' !== 'KERALA STATE'`, so state-board students resolved to no combo at all. The same comparison bug existed *independently* in `isRelevantToStudent()` (`board === userProfile.syllabus`), so those students saw none of their own board content either; both now go through a shared `resolveBoard()`. (2) `EXAM_TAG_RE` hardcoded `cbse_class_`/`icse_class_`/`state_board_class_` but not `kerala_state_class_`, so Kerala State content never produced a filter pill in `AdminContentLibrary` and leaked through `PracticeGeneratorPage`'s tag-stripping filter as a fake chapter name. Replaced with `isExamTag()` derived from the live `BOARDS` list — hardcoding is precisely how Kerala State got missed, so the next board an admin adds can't silently fall out. `prettyExamTag()` derives its board cases the same way. Also fixed `normalizeExamType('CLASS_8_9')`, which mapped to `'Class 8-9'` — a key that has never existed in `CATEGORIES`.

**Pricing.** Confirmed with the owner that NEET/JEE students buy the *same* plans (₹399 monthly, yearly, 3-year), so there was no entitlement gating to build — `quota_config` already grants `neet_complete` and `premium_*` identical unlimited quotas. But that plan was titled "NEET Complete — Competitive Exams" with NEET/JEE chips while being shown to *every* student including Class 8. Repositioned as the **3-Year Plan**, `examChips` dropped, features reworded to duration/value. **Plan id left as `neet_complete`** — it's what live subscriptions, `quota_config` and the edge functions' `PLAN_DAYS` all resolve on. Fixed a stale label found alongside: Admin > Students offered "NEET Complete (365 days)" when `adminGrantPremium()` has always granted 1095.

**Migration written but deliberately NOT applied** (`20260809000000_onboarding_flow_class_first.sql`). Its re-seed sections rewrite the onboarding option rows, and the currently-deployed app still expects the old `needs_board`/`needs_class` branching — applying it before the code ships would leave live onboarding inconsistent. It must go out *with* the deploy. One trap avoided inside it: `admin_upsert_onboarding_option` gains a parameter, and adding a defaulted param creates a second *overload* rather than replacing the function — PostgREST can't disambiguate two overloads, which is exactly the `PGRST203` failure that silently broke every flashcard review in production (BUG-004). The migration drops the old signature first.

**Content reality, flagged not fixed.** The new scope creates 12 content buckets (10 board+class + NEET + JEE Main), roughly 70+ subject-level buckets, of which exactly one is populated — everything tagged in production is `CBSE Class 8`. Recommended keeping the other combos `is_active = false` until content lands, since `AdminContentMap.jsx` already tracks the gaps. Added the missing empty state to `SyllabusTrackerPage`, which rendered `subjects.map()` over nothing — a blank screen under the stats header; Notes, Flashcards and Important Q&A already had one.

Verified: build clean, **66 tests passing** (up from 53) with 13 new cases covering the full resolution matrix — competitive-goal-wins, both-contexts-present, the Kerala State regression in both `getSchoolExamType` and `isRelevantToStudent`, repeater handling, legacy `CLASS_*` compatibility, and the exam-tag fix.

**Follow-up same session — migrations applied, accounts deleted, flow verified in a real browser.**

Applied both migrations to production (owner confirmed they're not deploying soon, and without the migration local testing would read the *old* option rows and exercise the wrong flow). Live catalog is now exactly: classes 8-12 + Repeater, boards CBSE + Kerala State, competitive NONE/NEET/JEE_MAIN/JEE_ADVANCED/BOTH gated to `{11,12,REPEATER}`, and 10 board+class combos active. All retired rows are `is_active = false`, not deleted — the admin editor still lists them (marked "hidden") so they can be re-enabled, while `get_onboarding_options()` filters them out so students never see them.

**Found `admin_delete_student` has never worked.** The first deletion attempt failed on all 15 accounts with Postgres `55000: Views containing LIMIT or OFFSET are not automatically updatable` — the function does `DELETE FROM leaderboard_alltime` and `leaderboard_weekly`, both of which are **views**, which aborts the whole function body. So no admin has been able to delete any student since `sql/0041` shipped. Fixed in `20260809010000_fix_admin_delete_student_views.sql` by dropping those two statements (the views derive from `user_gamification`/`test_sessions`, which the function already clears). All 15 accounts then deleted cleanly; both superadmin rows in `admins` preserved, since admin auth is keyed off that table rather than `users`.

Deliberately did **not** run `scripts/delete-non-superadmin-firebase-users.mjs`: it preserves only `thaslimshajahans@gmail.com` and would have deleted the Firebase Auth identity for `info@acenzos.com`, the owner's other superadmin login. It's also unnecessary — deleting the Supabase row alone re-triggers onboarding, because a fresh `upsertUser` row has `onboarding_completed = false`.

**Browser-verified end to end** (Playwright against the dev server + the dev-only `qa_uid` bypass): Class 8 → 2 steps with no competitive option and only CBSE/Kerala State offered; Class 12 → 3 steps with NEET/JEE present; a `Class 12 + CBSE + NEET UG` run saved `target_exam='NEET'` and resolves to competitive `NEET` **plus** school `CBSE Class 12` — the exact case that was collapsing to `CBSE Class 12` before.

**Three ProfilePage bugs fixed off the back of that**, all consequences of `target_exam` now being optional: (1) a board-only student rendered a bare `Target Exam —` row, because the old `examIsClassGrouping` heuristic assumed `target_exam` always held something meaningful — the row now shows only when `getCompetitiveExamType()` returns a real target; (2) `Board / Syllabus` did a raw `replace(/_/g,' ')` and rendered `KERALA_STATE` as the shouty "KERALA STATE" — now goes through `resolveBoard()` for "Kerala State"; (3) `Class / Year` unconditionally prefixed "Class", producing "Class REPEATER" — now renders "Repeater / Dropper". Verified live for both a NEET Class 12 profile and a Kerala State repeater.

---

## 2026-08-09 — Paper Gen restored: abandoned refactor had gutted the exam picker and four panels

Reported symptom: Admin > Publish > Paper Gen only offered NEET, with no way to generate for boards, classes, or other competitive exams. Two independent causes.

**Cause 1 (code, fixed) — an unfinished refactor had removed the UI.** `AdminPaperGen.jsx` had been split into a lazy wrapper plus a new `AdminPaperGenCore.jsx`, and the split never finished — the stub still carried the tell "For brevity, export a placeholder that re-exports the default from the original file." The Core file kept `competitive`/`selBoard`/`selClass` state and the `buildExam()` helper, but **the setters were never called from anywhere and the selector JSX was never ported**, so `buildExam('NEET', null, null)` returned `'NEET'` on every render — exactly the reported symptom. `EXAM_TYPE_GROUPS`/`BOARDS`/`CLASS_LEVELS` were imported and unused. The same shape had eaten three more panels plus one piece of dead state: `ChapterPicker` (so `chapters` could only ever be reset to `[]`, never set), `PYQExtractPanel`, `PYQTemplatePreview`, and `TemplatePickerPanel`. Meanwhile the original `AdminPaperGen.jsx` had been reduced to ~1040 lines of orphaned code referencing `supabase`/`motion`/`MathText` without importing them — it only compiled because nothing in the render path referenced it and rollup tree-shook the lot (its built chunk was 1.74 kB).

Fixed by restoring `AdminPaperGen.jsx` from git and deleting `AdminPaperGenCore.jsx`, rather than porting four panels into the stub — the original is the proven-working version and the Core copy had diverged only trivially. Checked before restoring that the split hadn't added anything worth keeping: the `generateQuestionPaper` call was byte-identical, and the only genuine additions were a "generation started" toast/notification and a "Prepare Publish" button whose `setPublished(false) && setPubTitle(...)` short-circuited so `setPubTitle` never ran. Carried the `createNotification` call across (generation takes 1–2 min, so an in-app notification beats watching a spinner); dropped the broken button. Built chunk back to 50.31 kB with all five panels rendering; build passes, 53 tests pass.

**Cause 2 (data, not fixed — owner's call) — the live category catalog is short.** The picker reads `exam_categories`, and `loadCategories()` *replaces* the hardcoded fallback wholesale whenever the DB returns rows. Production has only 2 competitive exams (NEET, JEE Main) against the fallback's 7, and 3 boards (CBSE, ICSE, Kerala State) against 4 — `State Board`, `JEE Advanced`, `CUET`, `UPSC`, `SSC CGL` and `Olympiad` have no rows. Classes (6–12) and all 21 board+class combos are present, so those work fully now. Project owner opted to add the missing competitive exams themselves via Admin > Platform > Categories rather than have them seeded here — worth noting the same list also feeds student onboarding, which is part of why it wasn't seeded blind.

---

## 2026-08-08 — migration audit, anon-readable backup tables, `.gitignore` fix, dead-file cleanup

Started as a narrow check of which migrations were actually applied to production. That question resolved cleanly — but the verification work surfaced two live problems that mattered more than the original question.

**Migration state (the original question) — everything IS applied.** All 134 RPCs the frontend calls exist in production, every table/column from `sql/0039–0057` and the migration set exists, and `quota_config`'s free-tier row matches `FREE_LIMITS` in `quota.js` exactly (20/15/2/3/3/2, i.e. `sql/0050`'s values). No repeat of the last outage. **Caveat worth remembering: `supabase migration list` was lying** — it reported `20260807000000_published_tests_rls_assignments` as local-only when `test_assignments` and all its RPCs were demonstrably live. Migrations had been applied by hand via the SQL editor, so the remote history table never recorded them. Method note: a first pass using PostgREST's `PGRST202` `hint` field as an existence signal produced 8 false negatives and was discarded — that hint reflects *name similarity*, not existence. The authoritative answer came from the `service_role` OpenAPI catalog (`GET /rest/v1/`), which enumerates every exposed function and table.

**Live PII exposure via backup tables (found, fixed).** 30 `*_backup_20260804/05` tables had RLS **disabled** while still exposed through PostgREST, so anyone with the public anon key (which ships in the client bundle by design) could read them by name. This completely defeated the Aug-6 A1/A2/A3 RLS lockdown: `users` correctly returned 0 rows to anon while `users_backup_20260804` returned all 17 (firebase_uid, email, display_name, target_exam, class_level). Worst of them, `admins_backup_20260804` exposed `passcode_hash` — a 6-digit SHA-256 that brute-forces offline in milliseconds, which combined with `AdminGuard`'s client-side passcode comparison made the admin second factor worthless. Also found three leftover `_debug_get_columns4`/`_debug_get_constraints3`/`_debug_get_policies4` RPCs, anon-callable and returning full column/constraint/RLS-policy metadata for any table — the 2026-08-06 `drop_debug_helpers` migrations had missed them, and they were what made enumerating all of the above trivial. Fixed in `20260808000000_drop_exposed_backups.sql`: all 30 tables plus the 3 debug functions dropped. Verified after: backup tables return 404 to anon, debug RPCs return PGRST202, live `users`/`admins`/`knowledge_base`/`subscriptions` intact, and all 134 called RPCs still resolve (checked specifically because `drop … cascade` can take dependent functions with it — none were).

**The backups were not redundant, and were dropped anyway as a deliberate call.** Flagged before acting: the snapshots held substantially *more* than the live tables — `knowledge_base` 20,890 rows (with embeddings already generated) vs 23 live, `pyq_questions` 2,934 vs 17, `study_notes` 561 vs 4, `daily_challenges` 510 vs 206. Something wiped the content library after 2026-08-04 and these tables were the only remaining copy. Project owner confirmed twice, intending to re-ingest from the source PDFs in `easy with exam/` — so they were dropped rather than preserved. **Re-ingestion will re-incur the OpenAI embedding cost for ~21k chunks.**

**`.gitignore` was ignoring the entire repository (found, fixed).** Line 23 read `* f i r e b a s e - a d m i n s d k * . j s o n` — a UTF-16 write artifact that git parsed as a bare `*`, plus a following ` secrets/` with a leading space. Confirmed via `git check-ignore -v`: every path in the project matched `.gitignore:23:*`. Tracked files were unaffected (ignore rules don't apply to them), but **every new file was silently invisible to git** — 21 of them, including 8 the running app imports (`src/lib/onboardingOptions.js`, imported by `main.jsx`; `email.js`; `authErrors.js`; `onboardingIconRegistry.js`; `AdminEmailTemplates.jsx`; `AdminOnboardingOptions.jsx`; `AdminPaperGenCore.jsx`; `EweSpinner.jsx`), three edge functions (`connect-email`, `send-email`, `unsubscribe-email` + `_shared/emailLayout.ts`), three migrations, and `sql/0055–0057`. A fresh clone would not have built. This is the same class of local/remote drift that caused the last outage, already staged for the next one. Rewrote `.gitignore`; re-verified `.env`, `supabase/.env.local`, and the Firebase service-account JSON are still correctly ignored. **Checked the full git object history — nothing sensitive was ever committed.**

**Migration history repaired and `.sql` clutter removed.** 19 of the 34 local migrations were pure debug/fixture scaffolding (`debug_inspect*`, `drop_debug_helpers*`, `a3_test_fixtures*`) — verified to contain zero persistent DDL (create-then-drop temp functions only) and deleted, with their orphaned history rows marked `reverted`. The loose `sql/` directory (a parallel, tooling-invisible set of 19 hand-applied files) is gone: `0039–0054` deleted as recoverable from git history, and `0055–0057` **moved into `supabase/migrations/`** rather than deleted, since the `.gitignore` bug meant they were untracked and deletion would have been permanent. Those three were then marked `applied` via `migration repair`, since they already are. `supabase db push --dry-run` now reports **"Remote database is up to date"** — local migrations and production are genuinely in sync for the first time, so `db push` is usable again.

**Dead-file cleanup.** Removed `dist/`, `dev-dist/`, `.qodo/` and three `dist*.zip` deploy artifacts (~27MB, all regenerable), plus 7 source files with zero inbound references, found by tracing the import graph from `main.jsx`: `AuthScreen.jsx` (superseded by the landing-page `AuthModal`), `TestTimer.jsx`, `ui/Chip.jsx` (`AdminCategorySettings` has its own local `ChipInput`), `ui/ExamLabel.jsx` (call sites use `formatExamLabel()` instead), `VoiceInput.jsx`, `lib/referral.js` (`ProfilePage` calls `get_user_referral` directly), and `public/firebase-messaging-sw.js` — misnamed, FCM isn't used anywhere, and it duplicated `push-handler.js`, which is the one actually wired into workbox. Build passes and all 53 tests pass after. Kept deliberately: `easy with exam/` (1.6GB, now the only re-ingestion source for the discarded corpus), `secrets/`, the logo originals, and `VideoLearningPage.jsx` (unreferenced but parked intentionally per `StudyHubPage`'s comment).

**Flagged, not fixed:** both push service workers reference `/pwa-192x192.png` and `/pwa-64x64.png`, which don't exist — `public/` only has `icon-192.png`/`icon-512.png`, so notification icons are broken. The admin passcode is still verified entirely client-side. And the working tree still carries a large uncommitted change set (~70 files) that has never been deployed.

---

## 2026-08-06 (batch 4) — Exam Mode full fix: over-generation root cause, background generation, mode lock

Seven items, auto-run except Item 1 (called out as the priority — full diagnosis + live verification before the rest).

**Item 1 (CRITICAL) — question generation delivering 3–4.5x the configured count:** root cause was a missing enforcement step, not a double-invocation bug (initial hypothesis, ruled out by reading `GenerateModal` — no double-fire mechanism exists in current source; "2 ai-proxy calls" for a 34-question NEET request is normal batching at `safePerBatch=20`, not a bug). `generateQuestionPaper()` in `questionGen.js` asks each AI batch call for `batchCount + 2` as a truncation buffer, per a comment reading "ask N+2 and trim later" — the trim was never implemented, so every batch's full, sometimes wildly over-generated raw output flowed straight through to the published paper uncapped. Fixed with two changes: an early-exit once `allQuestions.length >= count` (skip firing further batches once there's enough raw material), and a hard `allQuestions.length = count` trim after dedup, before the blueprint-match-percentage calculation (which was previously computed against the bloated count too). Live-verified against the real `gpt-4o` pipeline across 4 configs — AI over-generation observed at 15–160% beyond the ask depending on config, confirming this alone fully explains the reported 3–4.5x papers; CBSE-style requests (smaller `safePerBatch=8`, more batches) compound the effect more than NEET/JEE. Cross-referenced production `published_tests`: 2 real affected papers found (both CBSE Class 8 English, 3.3x and 4.6x over), consistent with the batch-count-compounding explanation. No regressions — normal-sized requests unaffected, marks totals now correct as a side effect of the count fix.

**Item 2 — background generation + real notification:** moved paper generation off the modal into `src/lib/backgroundGeneration.js` (`startBackgroundPaperGeneration`, in-flight guard per uid) — `GenerateModal` now fires-and-forgets, shows an info banner ("generates in the background, keep using the app"), and closes immediately; no more disabled inputs/spinner blocking the UI for the ~1–2 min a paper takes. On completion, writes an in-app notification and sends a real push via `send-push`. Found and fixed two bugs blocking this from ever working: (1) `send-push` was admin-only — added a minimal `isSelfNotify` carve-out (caller notifying their own uid) without weakening the existing admin/broadcast checks, redeployed, verified live (self-notify 200, cross-user 403, broadcast-without-target 403); (2) `NotificationToast.jsx` (mounted globally in `AppShell`) was subscribed to a `notifications`/`firebase_uid` table/column pair that `createNotification()` doesn't write to — it actually writes `user_notifications`/`user_id`. Fixed the subscription to match; verified live with a real Realtime insert that the toast's exact query pattern now fires. Reconciled with batch 3's interrupted-generation fix by removing it — the `AbortController`-on-unmount behavior is now wrong given generation is meant to survive navigation, so it was deleted rather than left dead. Deep-link (`/exams?tab=papers`) confirmed to route to the finished paper's tab.

**Item 3 — Answer Key gating + Grade Any Paper separation:** `PaperModePage.jsx`'s tab bar — Answer Key now hidden until `evalResult` is set (was visible any time mid-attempt, defeating the exam); Results tab disabled until graded; Grade Any Paper pulled out of the in-exam tab bar entirely into its own top-level nav entry (`ExamsHubPage.jsx`'s 3rd mode pill, `/exams?tab=grade`) so it's reachable independent of any exam state, and hidden from the in-exam tab bar. Trimmed tab bar now shows only what's relevant to the current state.

**Item 4 — Paper Mode visual fixes:** print/view stylesheet was Times New Roman serif at 11–13px — replaced with the app's own Inter/system-ui stack at the app's real type scale (13–14px body, 20px title), which was the actual cause of the "unreadable" report (not a contrast issue — #111-on-white already had good contrast). Added a low-opacity rotated EWE logo watermark to both the question paper and answer key views (screen + print/PDF, since `window.print()` → Save as PDF is the existing PDF path). Header info (title/exam type/subject/marks) is pulled directly from the same `questions`/`title`/`examType`/`subject` state used to render the questions, so it can't drift from actual content.

**Item 5 — marks-per-question/total verification:** independently verified, not modified (already correct). NTA-style (NEET/JEE) marks are a fixed constant in code (`{correct: 4, incorrect: isNumerical ? 0 : -1}`), correct by construction. CBSE-style fallback marks (`cbseMarksForSection`: MCQ/Section A=1, B=2, Short Answer/C=3, Long Answer/D/E=5) verified live to match the scheme exactly across configs, with section/total sums checking out.

**Item 6 — AI evaluation scoring quality:** tested both paths live against real `gpt-4o` calls, since typed-answer (`MockTestEngine.jsx`'s `evaluateDescriptiveAnswers`) and uploaded-image (`PaperModePage.jsx`'s `evaluateAnswerSheet`) go through separate code. Both scored fairly and consistently — strong/correct answers got near-full or full marks, a deliberately wrong MCQ got 0/1 with no generous credit, partial answers got reasonable partial credit with specific misconception feedback rather than vague "wrong" verdicts. No scoring-quality issues found in either path.

**Item 7 — lock exam mode selection mid-attempt:** new `exam_attempt_mode` table + 3 RPCs (`lock_exam_attempt_mode` — idempotent, returns whichever mode actually holds the lock; `get_exam_attempt_mode`; `clear_exam_attempt_mode`), no direct RLS policies per this project's established Firebase/Postgres pattern. `MockTestPage.jsx` and `PaperModePage.jsx` each call `lock_exam_attempt_mode` with their own mode on load; if the lock belongs to the other mode, redirect there instead of letting a second independent attempt spin up. Also closed a real asymmetry found while investigating: `PaperModePage.jsx` had **zero** completion check at all — a test finished via Online Mode could still be reloaded and resubmitted via Paper Mode (the reverse direction already worked, since `test_sessions`/`getTestAttempt` is mode-agnostic and `MockTestPage.jsx` already used it). Mirrored `MockTestPage.jsx`'s existing "Already Submitted" screen into `PaperModePage.jsx` on the same `getTestAttempt` check. "Start Fresh" in `MockTestEngine.jsx` (distinct from "Resume", same `onStart` callback, button label switches based on `hasSavedProgress`) now clears and immediately re-locks the mode, so a student who discards in-progress work and backs out to Exam Center can legitimately pick either mode again, per spec — resuming via "Resume" is unaffected and stays in the original mode. Live-verified end-to-end against real fixtures: locking online then attempting to lock paper for the same uid+test correctly returns 'online' (proving the redirect fires); a paper-mode completion is correctly picked up by the mode-agnostic completion check (proving Online Mode would now show "Already Submitted" too — the symmetry gap is closed in both directions). `ExamCenterPage.jsx`'s card still shows both mode buttons before any lock exists (by design — that's the legitimate first choice); showing only the locked mode once one exists was flagged as optional UI polish in the spec and not implemented, since the data-layer + in-exam-tab-bar (Item 3) enforcement already fully prevents the switch — a stale button would just redirect harmlessly if clicked.

---

## 2026-08-06 (batch 3) — full RLS lockdown, QA sweep, interrupted-generation fix

The big one. Four parts, ~25 migrations applied directly to production (pre-approved for Part A).

**Part A — RLS lockdown, applied to production:**
- **A1 (`users`)**: closed the biggest gap — every account's full profile (email, phone, name) was dumpable in one unauthenticated `GET`. Locked down, moved to RPCs (`get_own_user`/`upsert_own_user`/`update_own_user`/`check_phone_registered` for students, `admin_*` variants for admin screens). Re-pointed 6 consumer files. Verified live: bulk dump blocked, real login/onboarding/profile-edit flow still works end to end, cross-account enumeration closed.
- **A2 (`flashcards`/`flashcard_progress`/`question_history`/`user_weak_topics`)**: same shape. Built the RPC surface `question_history`/`user_weak_topics` never had (`save_wrong_answers`, `record_review`, `get_due_questions`, `get_error_notebook`, `get_notebook_stats`, `update_weak_topics`, `get_weak_topics`), rewrote `errorNotebook.js` on top of it. Caught and fixed a design bug of my own mid-flight — first pass used bare `current_date`/`now()` (server/UTC time) instead of IST, a real behavior change from the original `IST_DATE()`-everywhere code; corrected before it shipped, plus fixed the same latent issue in last batch's `review_flashcard`. `record_review` now also checks row ownership — the old client-side version took a bare history ID with no uid check at all. Verified live including the required flashcard-SM2 regression check (review still works end-to-end post-lockdown).
- **A3 (coaching group)**: applied the plan drafted last batch (`sql/0054`), re-verified still accurate, added 3 more RPCs the plan had flagged as an open decision (`admin_*` assignment variants for `AdminCoaching.jsx`, which manages any centre, not "its own"). Re-pointed all 6 consumer screens. Fixed two more latent wrong-field-name bugs found while re-pointing: `AdminStudentLookup.jsx`'s coaching badge (as previously flagged) and `AdminCoaching.jsx`'s "Add Student" form, which sent `student_uid` as a literal column name against a table that has no such column — every previous attempt to add a student this way had likely been failing outright. Verified live with real fixtures: cross-centre write attempts correctly no-op (0 rows, not an error), a real enrolled student sees only their own centre's tests (closing the actual BUG-002 exposure — previously any student could see every centre's published tests platform-wide).
- Also finished off `AdminTestData.jsx` (the dev test-data seeder), which touched all three RLS groups across its seed/cleanup functions — routed everything through new admin-checked RPCs, fixed a pre-existing bug where its cleanup loop targeted `flashcards.user_id`, a column that's never existed (real column is `firebase_uid`), so that cleanup step silently no-op'd on every run.
- **Not fixed, flagged for a real follow-up pass**: the same wide-open-policy pattern that motivated all of Part A also showed up on `daily_usage_quota`, `user_gamification`, and `notification_prefs` while working through `AdminTestData.jsx` — not part of this batch's named scope, so left alone rather than silently expanding.

**Part B — testing pass:**
- **B1 (UI audit)**: no browser/login access available (same limitation as every prior session), so this was a code-level audit, not a rendered one — sampled representative screens per portal rather than claiming exhaustive coverage. Found and fixed one contained consistency issue (`CoachingAssignmentsPage.jsx` used the app's semantic `danger`/`rounded-card` design tokens for its error state while every sibling coaching page uses raw Tailwind `red-500` for the same purpose — real tokens, properly defined, just a 7-file-vs-52-file minority pattern; aligned to the dominant convention). Flagged one structural finding, not fixed: the **admin portal has zero responsive/mobile layout** — `AdminLayout.jsx`'s sidebar is a bare `w-[220px]` with no breakpoint guard at all, unlike the student portal's `Sidebar.jsx` which correctly hides itself below `lg:`. May be an intentional desktop-only scope call rather than an oversight — flagged either way, not assumed.
- **B2 (vision hallucination)**: tested live against the real `gpt-4o` vision pipeline with the exact system prompt from `ChatInterface.jsx`, using synthetic test images (a blank white page, an unrelated doodle) since no real handwritten sample images were available. Both of the prompt's explicitly-flagged critical cases passed cleanly — the model correctly identified the blank page as blank and asked for a re-upload rather than fabricating a score, and correctly described the unrelated doodle instead of forcing it into the answer-sheet template. Could not test messy handwriting, wrong-subject-but-real-handwriting, or partial answers — no real handwriting samples available; flagged as a genuine capability gap, not silently skipped.
- **B3 (concurrent session / network drop)**: found the mock test engine already has real resilience engineering — periodic localStorage backup every 5s, a 4-hour-staleness-checked resume flow, a submission-failure path that keeps the local backup and shows a visible retry option instead of swallowing the error, and a re-entrancy guard against double-submission. Two simultaneous sessions of the same account would each keep independent local progress and could both submit an attempt — not corrupting, just two independent attempt rows (existing "most recent" display logic already handles this reasonably).
- **B4 (rate limiting)**: no custom rate limiting exists anywhere (auth, AI-cost endpoints, invites) — but auth itself is fully Firebase-delegated (Google OAuth + Phone OTP behind reCAPTCHA), so there's no custom password endpoint to brute-force. AI-cost endpoints are gated by daily/weekly quota ceilings only, no burst/per-minute throttling — a user could exhaust a full day's quota in a rapid-fire burst. Found one more concrete thing along the way: the admin 6-digit passcode second-factor is checked **entirely client-side** (the correct SHA-256 hash is fetched into `sessionStorage` and compared in the browser) — meaningless against brute-force since it never leaves the client and has no attempt limit; only matters as a factor at all against someone with access to an already-Google-authenticated admin's browser/session. Not fixed — flagged only, per the instruction not to implement rate limiting this pass.

**Part C — WhatsApp/Razorpay docs only, nothing implemented:** `docs/WHATSAPP_PREP.md`, `docs/RAZORPAY_PREP.md`. WhatsApp: Twilio-backed, deployed, secrets configured — real open question is sandbox-vs-production sender and template approval, not code. Razorpay: client-side checkout flow is fully wired and correctly designed (server resolves the charge amount, never trusts the client), but two of three required edge functions aren't deployed and zero Razorpay secrets are set, so checkout is broken end-to-end right now. **Found a live, currently-exploitable gap while documenting** (not fixed — Part C is docs-only): the one Razorpay function that *is* deployed, `razorpay-webhook`, has a `// skip in dev` signature-check fallback that fires because `RAZORPAY_WEBHOOK_SECRET` was never set — meaning it currently accepts a fabricated `payment.captured` event from anyone who finds the URL and grants free premium, no real payment or valid signature required. Flagged prominently in the prep doc for immediate attention.

**Part D — interrupted question/paper generation:** root cause: no `AbortController` anywhere in the AI-generation path, so navigating away mid-generation didn't cancel anything — the fetch kept running in the background and, on completion, still wrote a real published test / burned a quota unit the student never saw. (Corrupted/half-written DB records were never actually a risk — every write already happened only after full generation completed, atomically.) Fixed: threaded an `AbortSignal` through `chatComplete()` → `generateQuestionPaper()` → both call sites (`ExamCenterPage.jsx`'s paper modal, `PracticeGeneratorPage.jsx`), each now creates an `AbortController` and aborts it on unmount. Also found and fixed the same gap one layer deeper — the `ai-proxy` edge function made its own separate upstream call to OpenAI with no signal propagation at all, so even a correctly-aborted client request wouldn't have stopped the actual OpenAI billing. Fixed and redeployed `ai-proxy` with `signal: req.signal` threaded through. Verified live end-to-end: a real `gpt-4o` call aborted client-side at 300ms actually terminated (confirmed via `AbortError`, not just the client giving up on waiting), both before and after the edge function redeploy; a normal non-aborted request still round-trips correctly post-deploy.

---

## 2026-08-06 (batch 2) — mobile upload camera, math rendering, chat persistence

Auto-run pass through 3 items. Item 3 turned into the largest piece of work — surfaced that the
"open RLS policy" pattern from the previous batch's BUG-002 isn't unique to coaching tables at all;
confirmed live the same `USING(true)` policy also sits on `doubt_chats`, `doubt_messages`,
`flashcards`, `flashcard_progress`, `question_history`, `user_weak_topics`, and `users`. Fixed the
two tables this item actually touches (doubt_chats/doubt_messages); the rest is flagged below as a
follow-up, not fixed — same reasoning as BUG-002: real scope, not something to fold into an
unrelated item silently.

**Item 1 — mobile upload forcing camera:** confirmed and fixed. `capture="environment"` was set
alongside `accept="image/*"` on the file input in 4 places, not just one — `DoubtStudio.jsx`'s
"Drop your answer sheets here" widget (the literal match), plus the same pattern in
`QuestionView.jsx` and two spots in `PaperModePage.jsx`. Removed `capture` from all 4 — the native
file picker already offers Camera as one option among Photos/Files without it, so a separate
"Take photo" button wasn't needed. Verified: build passes, grep confirms zero remaining `capture=`
attributes app-wide. Could not interactively click-test on a real device/emulator (same limitation
as every prior session — admin/student flows sit behind Google OAuth that can't be scripted
through), but removing `capture` is standard, unambiguous HTML behavior — MDN documents this exact
fix for exactly this symptom.

**Item 2 — math rendering as literal $...$:** diagnosed first, per the fix's instruction not to
guess. `MathText.jsx` (custom KaTeX wrapper, not a markdown-plugin pipeline) was already correctly
wired into 9 files. The gap was two components that render AI-generated content as plain text/spans
instead of through it: `NotesBrowser.jsx`'s `renderNoteContent()` (student Study Notes viewer, also
reused as-is by `CoachingNotesPage.jsx`) and the brand-new `ImportantQAPage.jsx`'s `QACard`. Found
the smoking gun for the first one: `SummarizerPage.jsx` has the *exact same* paragraph/bold-parsing
logic, explicitly commented "Same lightweight **bold**/paragraph handling as NotesBrowser's note" —
and correctly wraps segments in `MathText`, while `NotesBrowser.jsx` itself never got that wrap.
Classic diverged-copy bug. Fixed both to match the already-proven pattern. Verified: build passes,
and confirmed the actual KaTeX segmentation regex + renderer live against sample input — real math
delimited by `$...$` renders correctly, `$500`/`$600`-style currency prose is correctly left alone
(the heuristic guard already in `MathText.jsx` for that). Checked remaining raw-text render sites
app-wide (grepped every `.explanation}`/`.answer}`/`.content}`/`.question}` usage) — MockTestEngine,
PaperModePage, PracticeGeneratorPage, ErrorNotebookPage, DailyChallenge, and QuestionView already
render through `MathText` correctly; admin-only content previews (AdminContentLibrary, AdminPaperGen,
AdminStudyNotes, AdminPublishedTests) were left as raw text deliberately — those are admin authoring/
review screens, not final student-facing content, out of scope for this symptom. `ChatInterface.jsx`'s
one remaining raw-text branch is the student's own typed message echoed back verbatim (correct,
not a bug — nothing to re-render there).

**Item 3 — chat sessions cleared instead of persisted:** the write path (`createDoubtChat`/
`saveDoubtMessage`) was already live and called on every message — the read path never existed, so
every page load/refresh started fresh regardless. Two things found along the way, both fixed:
1. `doubt_messages_role_check` only allows `role IN ('user','ai')`, but `ChatInterface.jsx` was
   calling `persistMessage('assistant', ...)` for every AI response — silently failing the check
   constraint, caught by an empty `.catch(() => {})`. **Every AI response has never actually been
   saved**, only the student's own messages. Fixed the two call sites to pass `'ai'`.
2. `doubt_chats`/`doubt_messages` carried the same wide-open policy described above. Locked both
   down fully (zero direct-table policies for anon) and moved every read/write through new
   SECURITY DEFINER RPCs (`create_doubt_chat`, `save_doubt_message`, `get_recent_doubt_chat`) —
   this also meant fixing the two existing admin oversight call sites (`AdminVeda.jsx`,
   `AdminOverview.jsx`), which read these tables directly with no caller check at all; added
   `admin_list_doubt_chats`/`admin_list_doubt_messages` (same `admins`-checked pattern as the rest
   of the `admin_*` surface) and wired both screens to pass `callerUid`.

   Added a restore-on-mount effect in `ChatInterface.jsx`: on load (skipped for the answer-sheet
   analysis flow, which is intentionally a fresh session each time), fetches the student's most
   recent chat via `get_recent_doubt_chat` and rehydrates both the visible message list and the
   LLM context array (`historyRef`) so a resumed conversation stays coherent, not just visually
   restored. Guards against clobbering an already-in-progress new chat if the student sends a
   message before the fetch resolves.

   Verified live end-to-end against production (temp test accounts, cleaned up after): messages
   with `role='ai'` now save successfully; `get_recent_doubt_chat` correctly restores a multi-message
   thread in order; a second test account's restore call returns only its own chat, never the
   first account's — confirmed the actual "can student B read student A's history" property this
   item asked for, not just code review. The "N exchanges in session" counter (`historyRef.current.length`)
   naturally reflects the restored count after rehydration — intentional, not a regression, since it
   now genuinely tracks "how far into this resumed thread," which is a more useful number than
   always restarting at 0. Direct-table admin RPC correctly rejects a non-admin caller (tested).

**Not fixed, flagged as a follow-up:** the wide-open RLS pattern also sits on `flashcards`,
`flashcard_progress`, `question_history`, `user_weak_topics`, and `users` — meaning anyone with the
public anon key can currently read/write any student's flashcard progress, error notebook, weak-topic
stats, or profile row by firebase_uid alone. Same shape and same fix as `sql/0054`'s coaching-tables
plan (SECURITY-DEFINER RPCs + full RLS lockdown), but each of those tables has direct client-side
calls scattered across several files — real, separately-scoped work, not something to fold into
this batch silently.

---

## 2026-08-06 — bug batch: RAG search, flashcards SM-2, misconception widget, coaching RLS plan

Auto-run pass through a 5-phase fix list from a prior audit (BUG-002 through BUG-006). First
Supabase-CLI-authenticated session for this project — discovered `npx supabase projects list`
already had DB push access to the linked EduTech project, so Phase 2 was applied directly to
production after confirming with the project owner (previous sessions always wrote SQL files for
manual review instead).

**Phase 0 (exposure window):** resolved, no action — both subscription grants flagged were
Thaslim's own accounts.

**Phase 1 — BUG-003, semantic search:** `ChatInterface.jsx:571` called `searchKnowledgeBase(text)`
with no embedding, so Veda's RAG context always used the weak `ilike` keyword fallback — the
`match_knowledge_base` pgvector RPC was correct and reachable, just never actually called. Now
calls `embedText(text)` first and passes the embedding through, with a console warning (not a
silent swallow) if embedding fails. Verified live against production: a paraphrase with zero
keyword overlap ("tiny bloom" style test) now returns the correct chunk via the real RPC, versus a
different, wrong chunk from the old `ilike` path; exact-keyword queries still work with no
regression.

**Phase 2 — BUG-004, flashcards SM-2:** worse than scoped — `mark_flashcard_known` had two
overloads (`bigint` id → `flashcard_progress`, a dead `uuid` id variant referencing columns that
don't exist on the live `flashcards` table) and PostgREST couldn't disambiguate between them, so
*every* flashcard review in production was throwing `PGRST203` and silently failing. Dropped both,
added real `ease_factor`/`interval_days`/`repetitions`/`due_date` columns to `flashcard_progress`,
and built `review_flashcard(uid, id, grade)` running the same SM-2 formula already proven in
`errorNotebook.js`. `get_user_flashcards` now returns SM-2 state and orders by `due_date` instead
of insertion order. Frontend: `FlipCard`'s 2-button Again/Got-it swapped for 4-button
Again/Hard/Good/Easy, wired to `reviewFlashcard()`. Verified live: interval grows 1→6→15 across
three "Good/Easy" reviews, resets to 1 on "Again", repetitions increments correctly — all against a
real test card via direct RPC calls, cleaned up after.

**Phase 2 — BUG-005, misconception engine:** the write path (`upsert_misconception`, live since
2026-07-13, feature flag on) was already correctly logging distractor/correct-answer/chapter/count
— nothing ever read it back. Added `get_user_misconceptions()` (per-chapter rollup, most-repeated
first, with one concrete example) and a new `MisconceptionsWidget` on the student dashboard. Also
added `admin_get_top_misconceptions()` (stretch scope, platform-wide weekly rollup) but did not
build admin UI for it, per the fix scope's own "stretch, student surface is priority" framing.
Verified live: 3 wrong answers across "different sessions" (same + different question, same
distractor) rolled up to the correct total count, and updated immediately on a 4th.

**Phase 3 — BUG-002, coaching RLS (plan only, not applied):** confirmed all 5 coaching tables
(`coaching_centres/students/assignments`, `centre_published_tests`, `centre_student_results`) have
a `USING(true)` policy open to anyone with the public anon key — no login required — reachable
directly via REST, bypassing every UI guard. Found the tables also carry `auth.uid()`-scoped
policies sitting uselessly alongside the open ones: confirmed live that this app's anon JWT has no
`sub` claim (`GET /auth/v1/user` → "missing sub claim"), so `auth.uid()` is NULL on every real
request — this app authenticates via Firebase, not Supabase Auth, matching the 2026-07-15
architecture audit's finding. Real fix can't be "better RLS," it has to be the same
SECURITY-DEFINER-RPC-with-explicit-caller-check pattern already proven for `admin_*`/
`coaching_admin_*` (sql/0053). Drafted the full lockdown + ~20 replacement RPCs + frontend call-site
mapping + a per-screen test plan in `sql/0054_bug002_coaching_rls_PROPOSED.sql` — **not applied**,
per the fix scope's explicit restriction. Also flagged in passing (not fixed): `AdminStudentLookup.jsx:36`
queries `coaching_students.student_uid` and `coaching_centres.centre_name`, neither of which exist
on the live schema (real columns: `firebase_uid`, `name`) — same shape as other wrong-field-name
bugs already fixed elsewhere in this codebase.

**Phase 4 — BUG-006, zero PYQ data:** confirmed pure content-ops gap. Live: `pyq_questions` has 17
rows, all `status='in_review'`/`question_type='KB_NOTE'` (pending Study Notes items) — zero
published PYQ questions, zero rows in `published_tests`. Blueprint V2 requires ≥20 matched PYQs per
exam+subject before activating (`questionGen.js:743`) and correctly stays inert at 0; PYQ-grounded
style referencing (`fetchPYQExamples`) correctly returns `[]` and generation falls back cleanly. No
code fix needed — checklist for content ops: publish PYQ questions (not KB_NOTE) with
`status='published'` for each subject × exam type combo the platform serves; Blueprint V2 needs
≥20 per exam+subject to engage at all, so that's the practical per-combo minimum worth hitting
first for NEET/JEE before Blueprint V2 is worth trusting for those.

---

## 2026-07-18

Investigated 5 reported issues, then built fixes/features for 4 of them:

1. **Coaching centre login** — confirmed the current flow is fully manual (superadmin looks up a Firebase UID and pastes it into a form). Built a real email-invite system: `sql/0025_coaching_admin_invites.sql` (new table + RPCs, needs to be run in Supabase — see `ACTION_ITEMS_FOR_YOU.md`) plus a full UI in Admin → Students → Coaching (generates a shareable link with copy/WhatsApp/email share buttons) and a redemption page at `/coaching-invite/:code`. Manual UID entry kept as an advanced fallback in the same modal. Access control is still "only this email" — just automated instead of manual.
2. **Content mapping tree** — didn't exist. Built `AdminContentMap.jsx` (new tab in Admin → Academic), a coverage tree of board/class → subject → chapter cross-referencing `syllabus_nodes` against `pyq_questions` and `study_notes`, flagging chapters with zero content.
3. **Veda sessions not working** — confirmed this is the same OpenAI-key issue from the previous session, not a new bug (`ai-proxy` still returns `invalid_api_key` — still blocked on rotating the key).
4. **Admin/student nav redesign** — admin sidebar had ~27 flat top-level links; regrouped into 8 hubs with tabs inside (`Admin*Hub.jsx` + shared `AdminHub.jsx`), mirroring the hub+tab pattern the student side already uses for Study/Exams/Progress. Old flat routes (`/admin/papers`, `/admin/quota`, etc.) redirect to the new hub+tab URLs. Reviewed student sidebar — already compact (5 items) and already tabbed, no changes needed there.
5. **Phone OTP login** — confirmed `PhoneOTP.jsx` was fully built but `sendOTP`/`verifyOTP` never existed in `AuthContext.jsx` and the component was never rendered anywhere — dead code end to end. Implemented both functions for real, wired the component into `AuthScreen.jsx` behind a toggle, and added email/phone account de-duplication (phone-first sign-in checks the `users` table by phone number before creating a new account; if one exists under a different Firebase uid, the new phone-only identity is discarded and the user is told to continue with Google instead). Needs Phone sign-in enabled in Firebase Console (a console setting, not code) to actually work end to end.

Also: verified in a real (headless) browser that the auth screen, admin login screen, and the new phone-OTP toggle all render without console errors — couldn't get past actual Google OAuth to visually verify the authenticated admin hub tabs, so those were verified by build success + code review only.

**Unresolved:** discovered mid-session that 8 pre-existing docs (`ADMIN_UX_STANDARD.md`, `CURRENT_SCHEMA_MAP.md`, `FINAL_REPORT.md`, `PHASE_B_REPORT.md`, `PLATFORM_AUDIT.md`, `UI_PASS_NOTES.md`, plus the two 2026-07-15 review docs referenced above) are missing from disk. Nothing in this session's tool calls deleted them — asked the project owner to confirm whether this was an intentional manual cleanup before deciding whether to restore them from git history.

---

## 2026-07-18 (session 2) — bug batch + Flashcards redesign

Worked through an 8-item bug/feature list. Fixed and shipped:

1. **`questions.filter is not a function`** — `toEngineFormat()` in `questionGen.js` was handed the whole `{ questions, meta }` result object by `PracticeGeneratorPage.jsx` instead of the bare array (`ExamCenterPage.jsx` unwrapped it correctly, this call site didn't). Fixed at the function boundary so every caller is safe regardless of which shape it passes.
2. **Paper Gen / Practice Generator missing Class 6 & 7** — `categories.js`'s `CLASS_LEVELS` started at 8, even though `syllabus_nodes` already has real CBSE Class 6/7 and Kerala State Class 6/7 rows (confirmed live). Added the missing category/exam-type-group entries so those classes are actually selectable.
3. **Content Map had no class dimension** — rebuilt `AdminContentMap.jsx`'s tree to `exam → class → subject → chapter` instead of collapsing every class into one board bucket. PYQ/notes counts aren't tagged by class in the underlying tables, so a banner now explains that a chapter shared across classes shows the same count in each.
4. **Coaching paused** — added `lib/moduleStatus.js` (`COACHING_MODULE_ENABLED = false`) and gated the `/coaching/*` routes and nav tab behind it — one flag flips it back on later, no route/data changes needed.
5. **Manual UID entry → dropdown** — built a shared `StudentPicker.jsx` (debounced name/email search against `users`) and wired it into Push Notifications, Quota overrides, and Add Admin (kept as an optional quick-fill there, since a brand-new admin may not exist as a student yet).
6. **Flashcards UI/UX redesign** — real 3D card flip (`preserve-3d`/`backface-visibility`) replacing a cross-fade, collapsible per-subject sections with ring-chart progress and a chapter search box, live known/again tally during study. Also fixed two bugs found while doing this: finishing a session on an "Again" card reported the wrong known-count, and the chapter detail view always showed "Class undefined" (read `.class` instead of `.class_level`). Extracted `RingChart` out of `SyllabusTrackerPage.jsx` into `components/ui/RingChart.jsx` so both pages share it.
7. **Study Notes creation reliability + confusing flow** — the PDF upload's AI auto-fill was calling `FileReader.readAsText()` on binary PDF bytes (garbage input to the AI), now uses the same `extractPdfText()` (pdf.js) already used by the crawler pipeline; analysis also now runs automatically right after upload instead of needing a separate button click.
8. **Paper Gen "data not from syllabus"** — root cause: `generateQuestionPaper()` only read admin-configured chapters when specific ones were picked. Leaving chapters empty (the common case — "full-syllabus spread") silently fell back to a hardcoded `FULL_SYLLABUS` constant covering only NEET/JEE, ignoring anything an admin edits in Admin → Syllabus. Now calls the same live `getChapters()` the chapter-picker UI uses, falling back to the hardcoded list only if the DB has literally nothing for that exam/subject. Applies to Exam Center, Practice Generator, and Admin Paper Gen — all three share this function.

**Reviewed, not changed:** Admin → Syllabus and Admin → Blueprints already looked solid on inspection (consistent dark theme, slide-in panels, chip inputs) — no concrete issue found there beyond what's covered by #7.

**Not started — needs scoping first:** item 8 of the original list, "remove all existing PYQ/fetched papers/content, want to upload fresh" — this is destructive and hasn't been confirmed with the project owner yet (what exactly to wipe: all PYQs? published tests? specific exam types? knowledge_base too?).

---

## 2026-07-18 (session 3) — tab UI redesign

Replaced the solid pill-button tab bars with underline tabs + animated sliding indicator, requested after seeing the Academic hub screenshot. Two shared components carry this everywhere at once:
- `AdminHub.jsx` — the outer hub tab bar, used by all 8 admin hubs (Content, Publish, Academic, Students, Platform, Ops, People & Audit).
- New `components/admin/TabRow.jsx` — same visual pattern for a page's own internal tab row; wired into the exam-type switcher in Syllabus Manager and Content Map.

Left the Class-level chips and Content Map's class filter as pill-style chips deliberately — those are secondary filters layered under the primary tab, not navigation, so keeping them visually distinct from the underline tabs is intentional. Also left Study Notes' light-themed subject filter untouched (different theme, combined inline with search, not a comparable structural match).

Verified via build only — admin screens sit behind Google OAuth + a superadmin passcode that couldn't be scripted through in this session, same limitation as the earlier nav-redesign work.

---

## 2026-07-18 (session 4) — Syllabus auto-fill + subject CRUD

Requested after seeing a Class 10 Economics subject that had been typed in chapter-by-chapter: two new ways to populate a subject's chapters in `AdminSyllabus.jsx` instead of manual entry, no schema change:
- **Fetch from Content** — scans `pyq_questions` for distinct chapter names already tagged on uploaded content for the current exam+subject.
- **Generate with AI** — asks GPT for the standard NCERT/board chapter list for the current exam+class+subject (same idea as the existing NEET/JEE-only "Seed NCERT Data" button, generalized to any board+class).

Both open the same review modal — a checklist, deduplicated against chapters that already exist — before one bulk upsert into `syllabus_nodes`. Same table, same RPC-free direct upsert pattern the existing "Seed NCERT Data" button already uses.

Also added subject-level rename and delete (previously only per-chapter). Both loop the existing `admin_upsert_syllabus_node` / `admin_delete_syllabus_node` RPCs over every chapter in the subject rather than adding new SQL — rename re-upserts each row with a new `p_subject`, delete calls the per-chapter delete RPC per row. Zero new backend surface, nothing for the project owner to run.

**Follow-up same day:** Fetch/AI only lived on a subject's row in the list, which doesn't exist until the subject has at least one chapter — so a brand-new subject had no way to reach either option, forced straight into manual entry. Fixed: naming a new subject now shows a chooser (Fetch from Content / Generate with AI / Add Manually) before doing anything.

**Second follow-up same day:** the bulk insert (and the pre-existing "Seed NCERT Data" button, same bug) called `.upsert(rows, { onConflict: 'exam_type,chapter_key' })`, but `syllabus_nodes` has no unique constraint on that pair — Postgres rejected it with "no unique or exclusion constraint matching the ON CONFLICT specification." Replaced both with client-side dedup (fetch existing `chapter_key`s for the exam type, filter them out) + plain insert, matching the schema as it actually exists rather than requiring a migration.

---

## 2026-07-18 (session 5) — Drive folder bulk-import

User has NCERT content organized as nested Google Drive folders (board → class → subject → unit PDFs) and asked whether sharing the parent folder link would auto-fetch and map everything. It wouldn't — Content Intake only understood a single Drive **file** link. Built real folder support:

- New `supabase/functions/drive-folder-list` edge function — recursively lists every PDF in a Drive folder (walking subfolders) via the Drive API v3, key-only auth (no OAuth flow). Deployed.
- New `src/lib/driveFolder.js` client + a "Drive Folder" tab in `AdminContentIntake.jsx`: paste a folder link → Scan → review a checklist (chapter name guessed from each filename, editable) → batch-process through the *same* extract-text → AI-structure → save pipeline already used for single files. Per-file live status (fetching / extracting / AI processing / saved / failed) instead of one spinner, so a batch of dozens of files shows real progress and one bad PDF doesn't stop the rest.

**Blocked on the project owner:** the function needs a `GOOGLE_DRIVE_API_KEY` secret — a Google Cloud API key with the Drive API enabled, created in Google Cloud Console and set via `supabase secrets set GOOGLE_DRIVE_API_KEY=...`. Key-only auth also means the target folder (and every subfolder) must be shared "Anyone with the link can view" — folders shared to specific accounts only come back empty.

**Same-day correction:** the key got configured and read correctly, but the live call came back `403: requests to this API drive method ... are blocked` — Google Drive simply doesn't allow file-listing with a bare API key at all; file access is permission-scoped per account and requires a real signed-in user. Replaced the whole approach: dropped the edge function and the API key secret, and switched to client-side OAuth — reuses the existing Firebase Google Sign-In with the `drive.readonly` scope added, calling the Drive API directly from the browser with the resulting token for both listing and downloading. Better fit for the actual use case too, since it now works for folders shared to a specific account ("Shared with me"), not just public links.

**Second same-day fix:** `inputTab === 'file' ? fileView : urlView` meant the URL panel's `else` branch also matched the new 'folder' tab, so it rendered underneath the folder panel instead of being replaced by it — split into independent conditionals. Also found several inputs on this page (year, chapter, folder URL) had no explicit text color, so a dark-mode browser was auto-inverting native form-control colors to white-on-white — text was only visible while selected. Added explicit `text-slate-900` + `colorScheme: 'light'` to those inputs; worth checking other admin pages for the same pattern if it turns up again elsewhere.

**Third same-day fix:** after a batch finished, the button just reverted to "Process N Selected" with no visible completion state — and clicking it again would reprocess and duplicate-save the same files (no dedup on repeat saves). Successful files now auto-deselect after saving, the button disappears once nothing is left selected, and a clear success/partial-failure banner replaces the small caption.

---

## 2026-07-18 (session 6) — merged Content Intake + PDF Upload into one wizard

User asked why there were two near-identical upload tools (Content Intake and PDF Upload — both AI-extract PYQ/notes from a PDF) and asked for one combined flow instead: pick content type first, then class/subject/board, then the input method, then a step-by-step progress view, ending with the data reflected in Content Map and a clear summary.

Rebuilt `AdminContentIntake.jsx` as a 4-step wizard (Content Type → Class & Subject → Source → Process & Review) and deleted `AdminPDFUpload.jsx` + its hub tab. All three input methods (multi-file upload, URL/Drive-file link, Drive-folder scan) now normalize into one "items" list run through a single processing loop with live per-item status, instead of three separate code paths.

Two things carried over from the merge and got fixed along the way:
- **Chapter alignment** — AI-detected (or filename-guessed) chapter names are now matched against the admin's real `syllabus_nodes` chapters before saving, so they register as "in syllabus" in Content Map instead of showing up as near-duplicate unmapped entries.
- **"Study Notes" now also writes to `study_notes`**, not just `knowledge_base` — Content Map and the curated Study Notes library both read `study_notes`, so content saved only to `knowledge_base` was invisible to both. Also found and fixed `logChange(ENTITY.KB_CHUNK, ...)` in both original files — `KB_CHUNK` was never defined in the `ENTITY` map, so those changelog entries were silently failing; switched to `ENTITY.CONTENT_ITEM`.

Ported PDF Upload's diagram-image enrichment step (upload the actual figure for questions flagged `has_diagram`) into the new wizard's summary screen, and added a "View in Content Map" link there too.

**Follow-up:** the new step-1 screen showed nearly-invisible text. First diagnosed this as a browser forced-dark-mode issue and set `color-scheme: light` globally — a good fix on its own, but not the actual root cause here (see below).

**Real root cause, found after re-checking:** the admin portal's root shell is dark (`bg-slate-950 text-white` in `AdminLayout.jsx`), and every other admin screen (Syllabus, Paper Gen, Blueprints, Content Map) is dark-themed to match — the *old* Content Intake/PDF Upload being light-themed was the actual inconsistency. The new wizard copied those old light-theme colors (`bg-white` cards, `text-slate-800/900`) without giving every container an explicit background, so dark text sat directly on the dark shell. Rewrote the whole wizard to match the established dark admin theme (`bg-slate-900/60` cards, `text-white`/`text-slate-400`, `border-white/10`).

**Second bug found in the same pass:** a user uploaded English CBSE Class 8 notes, the batch reported success, but Content Map showed no English subject at all. Two causes: (1) no CBSE syllabus chapters exist for English in any class, so content with no matching syllabus entry falls into Content Map's "All classes" bucket instead of "Class 8" — expected behavior, just not obvious without checking that tab; (2) the real bug — confirmed live via the DB that the `pyq_questions` review-queue rows saved fine (with correctly AI-detected chapters), but the new "also save to `study_notes`" step never created its row. Root cause: the wizard had its own bare `getCallerUid()` (sessionStorage lookup, no fallback), unlike `AdminSyllabus.jsx`'s pattern of falling back to the Firebase uid — an empty `p_caller` silently fails `admin_upsert_study_note`'s authorization check. Switched to the same `useAuth()` + fallback pattern. Also stopped the "View in Content Map" CTA from appearing when a batch had zero successes.

---

## 2026-07-18 (session 7) — admin-editable categories + Content Library bug + wipe scope

Three asks bundled in one message:

1. **"Clicking PYQ or Study Notes in Content Library redirects to the upload page"** — real bug, found and fixed. `AdminContentLibrary.jsx` and the outer `AdminHub.jsx` both used `useAdminFilter('tab', ...)` — same URL param name. Clicking "Study Notes (KB)" set `?tab=kb`, which `AdminHub` read as "switch to hub-tab id=kb", found nothing, and fell back to its first tab (Content Intake). Renamed Content Library's internal param to `?view=`.
2. **Wipe scope** — `adminClearAllData()` (Admin > Publish > Paper Gen > Danger Zone) now also clears `study_notes` and `exam_blueprints`, which it previously missed. Still deliberately leaves `syllabus_nodes` (chapter structure) untouched.
3. **Admin-editable Board/Class/Subject/Competitive-exam catalog** — the biggest piece. `src/lib/categories.js` was a hardcoded object (`CATEGORIES`, `BOARDS`, `CLASS_LEVELS`, `EXAM_TYPE_GROUPS`) imported by 11 files across the app (Paper Gen, Syllabus Manager, Content Intake, student onboarding, etc.) — this is what "class listed, I think it's hardcoded" was pointing at. Replaced with a DB-backed system:
   - `sql/0026_exam_categories.sql` (**needs to be run in Supabase SQL Editor** — not yet applied) — new `exam_categories` table, public read / admin-only write via RPCs, seeded with every value currently hardcoded so nothing goes blank on first deploy.
   - `categories.js`'s exports are now live, reassignable bindings instead of frozen constants — `loadCategories()` fetches from the table and updates them in place. Because ES module imports are live references, all 11 existing importers pick up the change automatically with zero edits to those files. Falls back to the old hardcoded values if the fetch fails.
   - `main.jsx` awaits the fetch (capped at 1.5s) before first render.
   - New **Admin > Platform > Categories** screen: manage competitive exams, boards, and classes. Saving a board auto-generates its "Board Class 6" through "Class 12" combination rows from two subject-tier inputs (6-10 / 11-12) instead of requiring the admin to edit every combination individually.

**Blocked on the project owner:** run `sql/0026_exam_categories.sql` before the new Categories screen (or the DB-backed catalog generally) does anything — until then the app keeps working exactly as before, off the hardcoded fallback baked into `categories.js`.

**Known limitation:** category edits apply immediately in the tab where they were made, and to any page loaded afterward — but a different browser tab already open won't see the change until it's reloaded (this isn't a real-time subscription, just a load-once-at-boot cache with a manual refresh after saves).

---

## 2026-07-18 (session 8) — exam_blueprints wipe fix + Danger Zone moved to Settings

User ran "Clear All Data" but still saw blueprint entries (CBSE/JEE Advanced/JEE Main/JEE_ADVANCED) in Admin > Academic > Blueprints, and asked why. Confirmed live via direct queries: every other table the wipe touches (`knowledge_base`, `pyq_questions`, `published_tests`, `question_cache`, `topic_frequency`, `question_papers`, `study_notes`) was correctly empty — only `exam_blueprints` still had its original 6 rows. Root cause: that table's RLS silently blocks anon-key deletes (the request returns success but affects 0 rows, no error thrown, so `adminClearAllData()` had no way to notice). Separately, what the user was seeing in the Syllabus/Content Map screenshots (subjects, chapters, "gaps") was the intentionally-*kept* syllabus structure — expected, not a bug.

Fixed: `sql/0027_admin_clear_blueprints.sql` adds `admin_clear_exam_blueprints`, a proper SECURITY DEFINER RPC with the same caller-authorization check every other admin_* RPC uses, and `adminClearAllData()` now calls it instead of a direct delete (needs a `callerUid` param, so its one call site was updated). **Needs this SQL file run** before blueprints will actually clear — the button doesn't error, so re-running it before the migration is applied will look like nothing happened (same silent-0-rows behavior, just via the RPC returning a permission error caught by the try/catch this time instead of a silent no-op).

Also moved the whole Danger Zone from Admin > Publish > Paper Gen to Admin > Platform > Settings, per request — a platform-wide destructive wipe fits better there than buried in a content-generation tool.

---

## 2026-07-18 (session 9) — removed the Blueprints feature

Asked why Blueprints existed and whether it could go — confirmed it was safe to remove: Paper Gen already falls back cleanly to its hardcoded exam patterns whenever `exam_blueprints` has no matching row (true right now, the table's empty), and the data that had been there was hand-seeded placeholder numbers, not the AI-analyzed real pattern the "Regenerate" button was meant to produce.

Removed: `AdminBlueprints.jsx` + its Admin > Academic tab, the `exam_blueprint_enabled` feature flag, the DB-blueprint-overlay block in `questionGen.js` (the separate `BLUEPRINT_V2` chapter-allocation-from-real-PYQ-data mechanism is untouched — different feature, still works), the `blueprint-analyze` edge function (undeployed), and the now-dead "regenerate blueprints" prompt in Content Review Queue that linked to the removed tab. Left the `exam_blueprints` table itself alone — harmless to keep it around and keep clearing it in the Danger Zone wipe, and dropping it needs a migration that isn't necessary just to stop using it.

---

## 2026-07-18 (session 10) — Study Notes dark theme

"Can we have better UI" after seeing Study Notes' stark white cards clashing against the now-dark Syllabus/Content Map tabs in the same Academic hub. `AdminStudyNotes.jsx` predated this session's dark-theme convention work and was never converted — fixed, along with the shared `ConfirmDialog` component (used by this page plus AdminCoaching/AdminPapers/AdminPublishedTests, all admin-only) which had the same light-on-dark clash.

Also swapped the note-editor's hardcoded `EXAM_TYPES` list (mixed formats — `'JEE_MAIN'` next to the rest of the app's `'JEE Main'`) for `getAllExamTypes()` from the new admin-editable categories system, so it stays in sync with whatever boards/exams get configured instead of carrying its own separate hardcoded list.

---

## 2026-07-18 (session 11) — Content Library / Content Map bugs from the English upload test

User uploaded CBSE Class 8 English notes and found: (1) Content Library's "Question Bank (PYQs)" tab showing the notes as if they were PYQ questions, (2) Content Map showing nothing at all.

1. **Real bug** — `fetchPYQs()` in `AdminContentLibrary.jsx` never excluded `question_type = 'KB_NOTE'` rows, so Study Notes chunks saved via the review-queue path (in `pyq_questions`) got counted and listed in the PYQ tab (confirmed live: "32 Total Questions" that were actually all pending Study Notes content). Added the missing filter.
2. **Real bug** — Content Map's `examTab` state defaults to `'NEET'` and nothing ever corrects it once the tree loads. With `syllabus_nodes` wiped and only CBSE having content (from the English upload), the page got stuck showing "No syllabus or content data found for NEET" while the CBSE tab — which had real data — sat right next to it, unselected. Added an effect that jumps to the first exam that actually has data when the current tab has none.
3. **Not a bug, but explains the third symptom**: the `study_notes` row for this particular English upload still doesn't exist — because that upload happened *before* the `getCallerUid()` fix from earlier this session. The fix doesn't retroactively create rows for uploads that already ran; re-uploading the same content now would create the `study_notes` row correctly.

---

## 2026-07-18 (session 12) — Content Map class attribution

User pushed back correctly: they'd picked CBSE + Class 8 + English before uploading, so `exam_type` on every row really was `"CBSE Class 8"` — fully unambiguous, no guessing needed. The bug was in `applyContent()`: it threw the class portion of `exam_type` away entirely (only used `baseExamType()` to get "CBSE"), then tried to *infer* the class by checking which existing syllabus class already had a matching chapter — which fails whenever the syllabus doesn't have that chapter yet (as with an empty syllabus), no matter how precisely the content was actually tagged at upload time.

Fixed: `classFromExamType(r.exam_type)` is checked first — if the exam_type already spells out a class (any board+class combo), it's used directly, no syllabus lookup needed. Only falls back to syllabus-matching for genuinely class-ambiguous exam types (a bare `"CBSE"` or `"NEET"` with no class suffix at all). Updated the on-page caveat text to describe this accurately.

---

## 2026-07-18 (session 13) — Overview dashboard stale content signal

Asked whether the Overview page's stats/checklist were actually working. Verified each one against the live DB directly: most are accurate (Total Students, Coaching Centres, etc.), but "Papers Loaded" and "KB Chunks" query `question_papers` and `knowledge_base` — two tables the current Content Intake pipeline doesn't primarily write to anymore. Confirmed live: 33 `KB_NOTE` rows existed in `pyq_questions` (pending review) while both legacy tables were empty, so "Needs Attention" showed "No content uploaded yet" when there was, in fact, content sitting in the Review Queue.

Added real signals (PYQ count excluding `KB_NOTE`, pending `KB_NOTE` count, `study_notes` count) combined into one `anyContent` check, used by the Setup Checklist and Needs Attention logic instead of the two disconnected legacy counts. Added a warning that surfaces pending Review Queue items specifically, and fixed dead links pointing at the now-deleted `/admin/pdfupload` route. Left the stat cards themselves alone — they're accurate for what they specifically measure, just no longer a reliable proxy for "any content exists."

**Also surfaced, not yet resolved:** `study_notes` is still 0 rows even though a new `KB_NOTE` chunk appeared after the earlier `getCallerUid()` fix — worth a fresh end-to-end upload test to confirm whether that fix actually resolved it.

---

## 2026-07-15 (session 3) — remaining architecture-review fixes

- `changelog.js`: recovered admin/coaching uid from the sessionStorage cache key itself, fixing Activity Log always showing "system" instead of the real actor — fixed all ~30 call sites at once, no call-site changes needed.
- `AdminQuota.jsx`: added the missing `paper_evaluations` field (schema + `quota.js` already supported it, admin UI never exposed it).
- Coaching Portal: `CoachingPortalGuard` now exposes `updateRecord()` so Settings saves propagate live instead of needing a reload; `centre_tagline` now renders in the portal header; fixed `CoachingTestBuilder`'s `created_by` using the wrong field name; `ExamCenterPage` now selects `exam_type` so coaching-published tests show their NEET/JEE badge.
- `PricingPage.jsx`: free-tier comparison numbers were stale/wrong — now fetched live from `quota_config`.
- `AdminContentIntake.jsx`: board+class `exam_type` wasn't combined into the same key Paper Gen queries for, so board-exam content uploaded here was invisible everywhere else.
- `whatsapp-alert` edge function: broadcast admin-check was skippable by omitting `caller_uid`; now mandatory. Deployed and verified live (403 without it).

## 2026-07-15 (session 2) — OpenAI key exposure, payment verification, infra

- **Found the OpenAI key leak was in 5 files**, not the one first flagged: `aiProxy.js`'s own dev-fallback, `examAlerts.js`, `ChatInterface.jsx`, `pdfAnalyzer.js`, `AdminPaperGen.jsx` all independently instantiated a direct browser OpenAI client with the raw key. All now route through `aiProxy.js`'s `chatComplete`/`chatCompleteStream`/`generateImage` → the `ai-proxy` edge function. Verified the key no longer appears anywhere in `npm run build` output.
- Learned: Vite inlines any `VITE_`-prefixed env var into the bundle wherever referenced in source, regardless of whether that branch is reachable at runtime — a plain flag doesn't reliably keep a secret out. Only `import.meta.env.PROD`/`DEV` (Vite-native) or removing the source reference entirely is a real guarantee.
- Added a missing `embeddings` route and streaming support to the `ai-proxy` edge function (the client's `embedText()` was calling a function that didn't exist at all).
- Deployed `ai-proxy` to production. **Note:** the `OPENAI_API_KEY` secret stored server-side is itself invalid/expired (confirmed via direct test) — AI features are blocked until the project owner rotates it (see `ACTION_ITEMS_FOR_YOU.md`).
- Wrote (not yet deployed) `create-razorpay-order` edge function + rewired `subscription.js`'s checkout flow to create a real server-side order and verify payment via the existing (also not-yet-deployed) `razorpay-verify` function instead of writing to `subscriptions` directly from the client. Blocked on Razorpay secrets being set.
- **Initialized git** — this project had no version control at all until this session. Added `.gitignore` and a GitHub Actions CI workflow (not yet connected to a remote).
- Discovered via the authenticated Supabase CLI: only `pdf-proxy`, `exam-scraper`, `send-push`, `blueprint-analyze`, `whatsapp-alert` were actually deployed — `ai-proxy`, `razorpay-verify`, `razorpay-webhook` existed only as local source, never deployed.

## 2026-07-15 (session 1) — full functional & security audit

Ran a full audit of every student and admin feature (5 parallel research passes, each verified against the live Supabase DB). Findings written up in `docs/FUNCTIONAL_AUDIT_2026-07-15.md`. Highlights: payment checkout had no server-side verification (fixed session 2, pending deploy), two admin RPCs leaked subscription data and the VAPID private key with no auth check (still open, needs SQL access), quota enforcement was completely broken (still open), Coaching Portal invite links were broken (still open). Also produced `docs/PRODUCT_ARCHITECTURE_REVIEW_2026-07-15.md` — product/USP assessment and the core architectural finding that Firebase Auth and Supabase aren't integrated, so every RPC hand-rolls its own authorization check instead of the database enforcing it structurally.

## Earlier — see docs/FUNCTIONAL_AUDIT_2026-07-15.md's "Fixed this session" table

Passcode-loop fix, header notification bell table mismatch, syllabus data not reaching Paper Gen/Exam Center/Practice (raw `target_exam` normalization bug found in 7 different pages), Kerala State board missing from pickers, Syllabus Tracker on hardcoded data, several dead notification links, `pyq_questions`/`knowledge_base` phantom-column errors in the content pipeline.
