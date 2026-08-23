# Changelog

Running log of changes made to this project, newest first. One file, appended to — see `docs/ACTION_ITEMS_FOR_YOU.md` for the standing list of things blocked on the project owner, and the two 2026-07-15 review docs for the original audit/architecture findings this work traces back to.

---

## 2026-08-24 — Deployed: SEO audit + mobile tap-target pass (commit `1efc4d7`)

Investigated three reports in one session: the site not appearing in Google search despite Search Console submission, a visually broken Help & Guide page on mobile, and mobile not "feeling like an app" (pinch-zoom, general responsiveness).

**SEO — no code bug found.** robots.txt, meta tags, prerendering, sitemap, and canonical URLs were all already correct (confirmed live, not just from source). The domain is genuinely new (RDAP: registered 2026-07-03, 51 days old) with zero indexed pages — normal new-domain latency, not a technical block. Search Console's "Blocked by robots.txt" and "Page with redirect" entries were both traced to git history: robots.txt disallowed 22 fewer paths for 6 days after initial launch (2026-08-05 → 08-11), and the pre-08-15 trailing-slash canonical bug affected 4 of 5 public pages — both are Google reporting what it saw historically, not live misconfiguration. Owner is using Search Console's Removals tool for the stale entries.

**Pinch-to-zoom — no code bug found.** Viewport meta tag has no `user-scalable=no`/`maximum-scale`, and no `touch-action` restriction exists anywhere in `src/`. Matches a documented, independent case of the same symptom (Chrome-iOS-specific, Safari-fine, same page) — a browser-level quirk, not something this codebase controls.

**Mobile tap targets — real bug, fixed.** Audited all 10 main pages at 375/390/428px with a real authenticated session (Playwright + `devAuth.js`'s minted Firebase token). Found a recurring pattern: icon/text buttons with zero or near-zero padding, so their tap target was just the visible content — well under the 44×44px minimum. Fixed by touching shared components once rather than every call site (`HubTabBar`, `HubPageHeader`, `EmptyState`, `PlatformChrome`'s cookie banner, `PracticeGeneratorPage`'s `Chip` component covering 27+ instances) plus targeted per-page fixes (Help, Profile, Dashboard, Analytics, ScorePredictor, Pricing — pricing page changes are padding-only, no changes to `handleSelect`/loading/payment logic). Left inline text links and toggle switches alone (WCAG-exempt / standard UX convention respectively). Zero new horizontal overflow introduced; full test suite (576/576) unaffected.

Standard 8-step procedure. Backup taken first (`webroot-2026-08-23-231238.tar.gz`). scp exit 0, md5 matched both ends before extracting. Extract hit the documented benign `tar` exit 2 (Gotcha 1); confirmed genuine via the disk check. Permissions fixed (0 unreadable files after). Content-checked all 5 prerendered routes (Gotcha 4) — each serves its own title and canonical, not the homepage's.

`deploy_log` entry written (`admin_insert_deploy_log`, version `2026.08.24.1`, id `aa854fcc-1223-4989-b6c0-4cf802a9adca`) — visible in Admin > Changelog. Earlier deploys in this file noted this step as blocked on "a real verified admin uid this session doesn't have"; that reasoning was carried forward without rechecking it against this session, which had used a confirmed live superadmin uid all night for far more sensitive writes. No actual blocker — just wasn't done until asked why it was missing.

---

## 2026-08-22 (session, commit `d2edc3d`) — LaTeX formatting fix: prompt, rendering, backfill infrastructure

Existing `knowledge_base`/`study_notes` content had math written as plain text or bare Unicode (`sin -1 x`, `cos : R -> [-1, 1]`, `pi/2`) instead of LaTeX, and even where `$...$` markup was present, three admin views (Content Library's PYQ/KB list, Content Review queue, Study Notes list) rendered it as raw text instead of typeset math.

Three parts, in dependency order:

1. **Prompt fix** (`contentExtraction.js`): the structuring prompt now mandates LaTeX (`$...$`/`$$...$$`) for every mathematical expression inside a chunk's `content`, not just in the separate `latex` metadata array — with explicit before/after conversions for the failure patterns actually seen in production (inverse trig, domain/codomain notation, set-builder notation, intervals, Greek letters). Fixes new extractions going forward; does nothing for content already in the DB.
2. **Rendering fix** (`MathText.jsx` + 3 admin views): wired the existing `MathText` component into `AdminContentLibrary.jsx`, `AdminContentReview.jsx`, `AdminStudyNotes.jsx` so `$...$` markup actually renders as math instead of showing literal dollar signs. `MathText`'s math-detector regex also gained bracket recognition (`[-1, 1]`) so interval/set notation isn't skipped as plain prose.
3. **Backfill infrastructure** (existing content): `admin_update_knowledge_chunk_content` RPC added (`supabase/migrations/20260822010000_...sql`, applied live) — `knowledge_base` had insert/delete/clear-all but no update-by-id path, needed to correct a chunk's `content` in place without changing its row id (`content_figures.source_id` references it, no formal FK). `scripts/latexify-content.mjs --preview` (dry-run, zero writes) validated the rewrite prompt + word-overlap safety gate against 5 sample rows first (4/5 clean, 1/5 flagged at 99.5% overlap — manually verified as a correct rewrite, which is why the real gate threshold is `overlap ≥ 0.97`). `scripts/latexify-apply.mjs` then does the real, resumable, per-row apply: rewrite via `gpt-4o-mini`, gate-check, and only on a pass, write it — `study_notes` rows are written via `admin_upsert_study_note` with `p_is_published: false` (existing published rows are pulled back to draft for owner review, never left published with unreviewed content), `knowledge_base` rows via the new RPC (content column only). A row that fails the gate, or errors, is left completely untouched and logged, never auto-corrected or retried silently.

**Backfill run status (this session):** `study_notes` apply ran partway (42/89 eligible rows: 40 applied → now `is_published=false` pending review, 1 flagged for manual review at 95.9% overlap, 1 transient fetch failure) before the process died mid-run with no final summary — resuming and finishing this, then starting `knowledge_base`'s first-ever run, is in progress as a follow-up to this commit.

Also produced `docs/schema-live-2026-08-22.md` — live-pulled (not migration-reconstructed) schema + real sample rows for `study_notes`, `knowledge_base`, `pyq_questions`, `content_figures`, `chapter_manifests`, for reference while designing the backfill and rewrite gate.

---

## 2026-08-22 — Deployed: new-signup auth-error-screen fix (deploy 2026.08.22.1, commit `19343ae`)

Real incident tonight: a friend's genuinely first-time signup (both Google and phone tried) hit "Something went wrong — Could not load your account" and stayed stuck. Investigated by minting a real Firebase ID token for a brand-new, never-before-seen uid via the service account and calling the live `upsert_own_user`/`get_user_subscription` RPCs directly — both returned clean 200s, so the RLS/RPC layer itself wasn't reproducibly broken at the time of testing. While tracing the retry path, found a real bug regardless: `retryProfile()` (`AuthContext.jsx`) called `get_own_user` — a plain read — which is a no-op for a brand-new user whose very first `upsert_own_user` never created a row (`get_own_user` returns `null` for a missing row, not an error). Clicking "Try Again" would silently clear `profileError` and drop the user into onboarding with no backing row, rather than ever actually creating the account.

Fixed: `retryProfile()` now re-runs the same upsert the initial sign-in uses (`upsertProfileFor()`, factored out so both paths can't drift apart), after forcing a fresh ID token (`getIdToken(true)`). The initial `onAuthStateChanged` handler also gets one automatic retry — fresh token, 1s delay — before `AuthErrorScreen` shows at all, so a transient blip on a first-time signup now self-heals instead of stranding the user. The duplicate-email conflict path (`23505`) is deliberately NOT retried — that's a deterministic conflict, not a blip.

**Also surfaced, not yet resolved:** the live database already has RPC logic (`get_own_user`'s parent-link check) that doesn't exist in any committed migration — confirmed via direct query against the linked production DB. Whatever "tonight's production reset / RLS lockdown" work was, it was applied straight to Supabase, not through this repo, so `supabase/migrations/` has drifted from what's actually live. Needs the exact SQL recovered from wherever it was run and turned into a real migration file — flagged in `docs/ACTION_ITEMS_FOR_YOU.md`.

Standard 8-step procedure. 576/576 tests, `build:seo` clean, bundle `index-DjRun-P_.js`, prerender sanity confirmed. Backup taken first (`webroot-2026-08-21-213650.tar.gz`). `scp` exit 0, md5 matched on both ends (`b23858a7...`) before extracting. Extract hit the documented benign `tar` exit 2 (Gotcha 1); confirmed genuine via the disk check: `index.html` named the new hash and the file existed. Permissions fixed (0 unreadable files after). Live `index.html` confirmed serving `index-DjRun-P_.js`.

Content-checked past status codes (Gotcha 4) — all 5 prerendered routes show their own title and canonical:

| route | title | canonical |
|---|---|---|
| /about/ | "About EaseWithExam — AI Exam Prep Built for Indian Students" | `/about/` |
| /contact/ | "Contact EaseWithExam — Support for NEET, JEE & Board Prep" | `/contact/` |
| /privacy/ | "Privacy & Cookie Policy \| EaseWithExam" | `/privacy/` |
| /terms/ | "Terms of Service \| EaseWithExam" | `/terms/` |
| /refund/ | "Refund Policy \| EaseWithExam" | `/refund/` |

Cleanup done (`rm -f ~/ewe-dist.tar.gz` both ends).

**`deploy_log` entry not yet written** — same reason as the 2026.08.20.1 deploy: `admin_insert_deploy_log` requires a real verified admin uid, which this session doesn't have and won't fabricate. Prepared for the owner to run from an authenticated admin session:

```
admin_insert_deploy_log(
  p_caller: '<owner admin uid>',
  p_version: '2026.08.22.1',
  p_summary: 'Fixed the new-signup AuthErrorScreen: retry now actually creates the account instead of a no-op read, plus one automatic retry before the error screen ever shows',
  p_changes: [
    {"type":"fixed","text":"retryProfile() now calls upsert_own_user (via the shared upsertProfileFor()) instead of a plain get_own_user read, which was a no-op for a brand-new user with no row yet"},
    {"type":"fixed","text":"onAuthStateChanged's initial profile write gets one automatic retry (forced-fresh ID token, 1s delay) before AuthErrorScreen is shown, for the deterministic-conflict-free error paths only"}
  ],
  p_git_commit_hash: '19343ae',
  p_bundle_hash: 'index-DjRun-P_.js'
)
```

---

## 2026-08-20 — Deployed: dedup scoping fix, stale-file-handle fix, admin-upload timeout extension (deploy 2026.08.20.1, commit `7ef8de3`)

All three of tonight's fixes shipped together — related (the timeout extension reduces how often a slow-but-working extraction ever reaches the retry exhaustion that leaves a stale file handle behind) and the dedup bug was actively blocking real uploads. Fresh pre-flight run immediately before packaging, not reused from earlier in the session: 576/576 tests, `build:seo` clean, bundle `index-BqMaMGdn.js`, prerender sanity confirmed (body is real content not an empty root div, `/about`'s own canonical present).

Standard 8-step procedure. Backup taken first (`webroot-2026-08-20-102256.tar.gz`). `scp` exit 0, md5 matched on both ends (`0379036...`) before extracting. Extract hit the documented benign `tar` exit 2 (Gotcha 1 — directory chmod/utime denied on `.`/`assets`/`landing`, not a real failure); confirmed genuine via the disk check, not the exit code: `index.html` named the new hash and the file existed. Permissions fixed (0 unreadable files after). Live `index.html` confirmed serving `index-BqMaMGdn.js` before touching the content checks.

Content-checked past status codes, per Gotcha 4 — a 200 alone proved nothing during the 4-day soft-404 incident. All 5 prerendered routes show their own title and canonical, never the homepage's:

| route | title | canonical |
|---|---|---|
| /about/ | "About EaseWithExam — AI Exam Prep Built for Indian Students" | `/about/` |
| /contact/ | "Contact EaseWithExam — Support for NEET, JEE & Board Prep" | `/contact/` |
| /privacy/ | "Privacy & Cookie Policy \| EaseWithExam" | `/privacy/` |
| /terms/ | "Terms of Service \| EaseWithExam" | `/terms/` |
| /refund/ | "Refund Policy \| EaseWithExam" | `/refund/` |

`/support` checked too, but it is **not** one of the 5 — it isn't in `PAGE_SEO`, so `prerenderedRoutes()` never generates a directory or its own baked-in title/canonical for it; it's SPA-only by design, same as `/dashboard`. Correct behavior there is 200 serving the current bundle's `index.html` shell with the homepage's static `<title>` (React updates it client-side after JS runs, invisible to `curl`) — confirmed exactly that, plus confirmed a genuinely nonexistent route (`/no-such-page-xyz`) still 404s, so the route alternation itself is intact and this isn't the "everything 200s" regression. Cleanup done (`rm -f ~/ewe-dist.tar.gz` both ends).

**`deploy_log` entry not yet written** — `admin_insert_deploy_log` requires a real verified admin uid (`assert_verified_admin`), which this session doesn't have and won't fabricate or guess (checked: `admins` is correctly unreadable via the anon key, confirming the RLS posture is doing its job). Prepared and handed to the owner to run from an authenticated admin session:

```
admin_insert_deploy_log(
  p_caller: '<owner admin uid>',
  p_version: '2026.08.20.1',
  p_summary: 'Fixed content-upload dedup false positive (chapter_key collision across subjects), stale-file-handle error on Load anyway, and extended the admin-upload AI timeout',
  p_changes: [
    {"type":"fixed","text":"checkAlreadyLoaded()/alreadyLoadedKeys() now scope the knowledge_base dedup query by (exam_type, subject), not chapter_key alone — chapter_key collides across unrelated single-book subjects at the same class level (proven: CBSE Class 11 Accountancy and Biology both resolve to c11_ch01)"},
    {"type":"fixed","text":"getBytes() catches a stale browser File-handle read failure on retry/Load anyway, surfaces an actionable message, and marks the item for re-selection instead of silently reusing a dead handle"},
    {"type":"changed","text":"Added ADMIN_UPLOAD_TIMEOUT_MS (140s), scoped to the 4 admin-upload AI call sites (notes/pyq/manifest/vision extraction) only — student-facing calls keep the 90s default"},
    {"type":"added","text":"docs/MULTI_PART_TEXTBOOK_WORKFLOW.md, linked from the Chapter Manifests screen"}
  ],
  p_git_commit_hash: '7ef8de3',
  p_bundle_hash: 'index-BqMaMGdn.js'
)
```

## 2026-08-20 — Extended AI timeout for the admin upload pipeline only (140s vs the 90s student-facing default)

Follow-up to tonight's dedup false-positive investigation: traced the real timeout mechanism before touching anything, per the owner's explicit request to confirm the approach first. Two stacked ceilings, not one — `AI_REQUEST_TIMEOUT_MS=90_000` × `AI_MAX_ATTEMPTS=3` in `aiProxy.js` (worst case before failure ≈ 273s, matching the "~5 min" symptom exactly), and underneath that, in production, Supabase's Edge Function platform enforces its own **hard 150s request-idle timeout** — a response not sent within 150s gets killed with a 504 regardless of our own client-side deadline. Confirmed via Supabase's docs, not assumed.

`PYQ_MAX_TOKENS=6000` (`contentExtraction.js`) is the largest single-call output reservation anywhere in the upload pipeline — at degraded-but-working GPT-4o throughput that alone can legitimately run close to 90s+ with nothing actually broken, which is the real mechanism behind tonight's false "timed out" on a 9-page chapter.

Added `ADMIN_UPLOAD_TIMEOUT_MS = 140_000` in `aiProxy.js`, scoped via the existing per-call `timeoutMs` override to exactly the 4 admin-upload call sites — `notes-extraction` and `pyq-extraction` (`contentExtraction.js`), `manifest-draft` (`manifestExtraction.js`), `vision-page-extract` (`pdfVision.js`). `AI_REQUEST_TIMEOUT_MS` (90s) is untouched and still the default for every student-facing call (doubt chat, practice generation, flashcards, daily challenge, mock test, etc.) — a student shouldn't wait minutes for an answer just because an admin upload needed more room. 140s, not higher: stays safely under Supabase's 150s platform ceiling so our own deadline fires first with a real message instead of racing an opaque 504. `AI_MAX_ATTEMPTS` left at 3 — new worst case before a genuine failure (network truly down, API genuinely erroring) is reported: ≈423s (~7 min), still bounded.

Checked before proposing progress feedback as a fix: it already exists end-to-end (`onProgress` → live batch results list, `AdminContentIntake.jsx:1796-1813`) — vision shows "Reading page N with vision… (i/total)", notes shows "AI structuring study notes… (part i/total)" (+ "(chapter i/total)" for multi-chapter files), PYQ shows "AI extracting questions… (part i/total)". No change needed there. Also confirmed the stale-file-handle fix from earlier tonight holds regardless of timeout length: `getBytes()` reads the browser `File` object exactly once, before any AI calls, so a longer AI-call timeout adds no new exposure — the fix is keyed to the file-read failure itself, not to elapsed time.

Owner confirmed the 140s number (and declined a same-session `RETRY_AFTER_CAP_MS` bump, left as a flagged follow-up) via AskUserQuestion before implementation. Verified: 4 new/extended tests (`adminUploadTimeout.test.js` new; `manifestExtraction.test.js`, `pdfVision.test.js`, `notesAdaptiveSplit.test.js` extended) each assert their call site passes `ADMIN_UPLOAD_TIMEOUT_MS`, not the default. 576/576 tests pass, `vite build` clean.

## 2026-08-20 — Fixed dedup false-positive (chapter_key collision across subjects) and stale-file error on "Load anyway"; added multi-part textbook workflow doc

Real incident: CBSE Class 11 Biology "The Living World" timed out mid-upload. `knowledge_base` confirmed zero rows for it — a clean failure, nothing saved. Re-attempting hit "already has 1 of 1 chapter key(s) loaded" anyway (false positive), and clicking "Load anyway" then threw a raw browser error, "A requested file or directory could not be found at the time an operation was processed."

**Root cause 1 (false positive), proven live against the DB:** `checkAlreadyLoaded()` (`AdminContentIntake.jsx`) and its script twin `alreadyLoadedKeys()` (`bulk-load-unit-notes.mjs`) queried `knowledge_base` by `chapter_key` alone, with no `exam_type`/`subject` filter. `chapterKeyFor()` deliberately leaves subject out of the key string — identity is `classLevel + book + ordinal`, and the real uniqueness lives in the DB's `(exam_type, subject, chapter_key)` index (`chapterIdentity.js:36`) — so `c11_ch01` is only meaningful scoped to one subject. Queried `knowledge_base` directly: CBSE Class 11 Accountancy's "Introduction to Accounting" (ch.1, blank `book`) and CBSE Class 11 Biology's "The Living World" (also ch.1, also blank `book`) both resolve to `c11_ch01`. Accountancy had real rows; Biology had none. The unscoped query matched Accountancy's rows and reported Biology as loaded. Fixed by adding `.eq('exam_type', …).eq('subject', …)` to both queries (both call sites in `AdminContentIntake.jsx` updated to pass them through). New test `src/admin/__tests__/checkAlreadyLoaded.test.js` reproduces the exact collision and asserts the query is actually scoped.

**Root cause 2 ("file not found" on Load anyway):** a `File` object from `<input type=file>` is a live browser handle, not a stored copy. Nothing in the retry path forces a fresh file pick — `items`/`matchRows` only deselect an entry on *success* ("so a stray re-click of Process can't duplicate-save"); on error the same item, holding the same original `File` reference, stays selected and gets silently reused on the next attempt. After the original attempt burned several minutes retrying through the timeout, that handle had gone stale by the time "Load anyway" finally read it, and the raw Chromium `NotFoundError` surfaced verbatim with no indication of what to do. `getBytes()` now catches this specifically and rethrows an actionable message ("its browser file selection expired … remove it from the list and re-select from disk"); the catch blocks in `handleMatchFiles`, `loadAnywayForRow`, `handleProcessConfirmed`, and `handleProcess` now deselect + flag (`staleFile: true`) the underlying item on this error so a retry can't reuse the same dead handle, and the file-list UI shows an inline "Expired — remove and re-select" note on that row.

Also added `docs/MULTI_PART_TEXTBOOK_WORKFLOW.md` — practical step-by-step for admins loading a textbook published in multiple parts (Part 1/2/3): why each part needs its own manifest and a distinct `book` value, the draft → review → approve → upload sequence, `file_structure` (per_chapter vs combined), the common error messages and what they mean (including both bugs above), and a quick-reference checklist. Linked from the Chapter Manifests screen's own info banner.

Verified: 573/573 tests pass (3 new), `vite build` clean.

## 2026-08-19 — Adaptive batch-splitting for Study Notes structuring (deploy 2026.08.19.3, commit `2270571`)

Real failure during a live admin upload: CBSE Class 12 Maths Part 1, "Relations and Functions", batch 5/6 hit the 3,000-token `NOTES_MAX_TOKENS` output cap and failed the whole file. Checked `knowledge_base` before touching anything: `c12_ch01` (the failed chapter) had zero rows — clean failure, nothing to clean up. Also surfaced a wrong assumption along the way — the 2 files that *did* save that session were not "chapters 2 and 3" as the operator believed, but the manifest's two Appendix entries (`c12_ch07`, `c12_ch08`, ordinals 7-8); chapters 2-6 were still unloaded.

Reframed from "retune the batch size to this chapter's density" to "handle any density automatically" — tuning `NOTES_BATCH_CHARS` down to whatever the densest chapter measured so far needs is the same mistake the PYQ batching (`PYQ_BATCH_CHARS`'s own header) already went through three rounds of tuning to learn from: CBSE, then NEET, then NEET Biology specifically, each denser than the last. `runNotesExtraction` now halves a truncated batch's source text at a page boundary (never splitting a `[[PAGE N]]` marker) and retries, recursively up to `NOTES_SPLIT_MAX_DEPTH` (4) — a batch denser than anything measured so far automatically uses more, smaller calls instead of failing the file; an ordinary chapter makes exactly as many calls as before. The same recovery also covers the unlabelled-truncation case (`finish_reason='stop'` but the JSON is cut off anyway) — the exact shape that had silently broken two Class 11 literature files with no `'length'` reason to catch it. A single unsplittable page, or a batch still truncating past the depth cap, still throws a real, specific error rather than retrying forever or degrading silently.

Verified: 570/570 tests pass (22 new — `notesAdaptiveSplit.test.js` exercises recursive splitting, the depth cap, the unsplittable-single-page case, and no-regression call-count on an ordinary batch, all density-agnostic via mocked `finish_reason` rather than tied to one real file). Deployed the same night via the standard 8-step procedure — bundle `index-lDwo7pj8.js` confirmed matching by md5 pre-transfer and post-extract, all 5 prerendered routes plus `/support` content-checked (own title + canonical, no regression on the nginx canonical fix from earlier tonight). `deploy_log` row `2026.08.19.3` was written first (RPC has no update path — immutable by design, same as `ai_call_log`) and predates this commit; the real commit is `22705712e87fa3f461f74e61e4ae14f14b955272`, recorded here since the row itself can't carry it after the fact.

## 2026-08-19 — Cleared 8 stale content_jobs rows (CBSE Class 9 English)

The 8 `content_jobs` rows from the Aug 15 18:15 CLI bulk-loader enqueue (`run_id ab926cde-c0c3-4204-8b12-88c17282a85f`, CBSE Class 9 English, one row per chapter file) had sat `status: 'queued'` ever since — the run was interrupted by that day's outage before `--work` claimed a single one. Owner decided to switch this book to the manual Content Intake upload path instead of re-running the CLI loader, so the stale queue rows were cleared rather than left to confuse the Status tab.

Verified before deleting, not assumed: all 8 rows were still `queued`/`claimed_by: null`/`chapters_written: []` (never claimed, so nothing partially written), and `knowledge_base` had zero rows for `exam_type = 'CBSE Class 9', subject = 'English'` — confirmed the query itself was valid by checking the same exam_type against Science (real rows) and the same subject against Class 8 (real rows), so the zero result for the Class 9 + English combination was genuine, not a filter miss.

Deleted via direct SQL (no admin RPC exists for `content_jobs` deletes — enqueue/claim/requeue/record are the only ones, by design; the project owner ran it in the Supabase SQL Editor, not this session, since only the anon key is available here). Re-verified after via `admin_list_content_jobs`: table is now empty (0 rows total, not just 0 queued — nothing else had ever been enqueued).

The CBSE Class 9 English manifest (`id 77108c6a-5561-487a-a1aa-f88807f01125`, `status: approved`) is untouched — `content_jobs` has no relationship to `chapter_manifests` at all, just a work queue keyed by filename/exam_type/subject strings. It stays approved and ready for the manual upload.

## 2026-08-19 — Student/parent support chat (Help Center + Contact), disabled by default

Redber AI chat (bot `ewe-support-vo3wl`) wired up as a "Chat with us" entry on `/help` (student, authenticated) and `/contact` (public — parents and prospective students evaluating EWE pre-signup are often the ones with the most pricing/offer questions). Both link to one new `/support` page rather than a duplicate implementation.

**Not their `widget.js` floating bubble.** The task started as "embed this script tag, exclude it from /admin". Reading the actual script (not just the embed snippet Redber gives you) surfaced three real problems: a hardcoded `bottom:20px;right:20px;z-index:999999` position that collided with this app's own fixed bottom UI (BottomNav, the cookie banner, NotificationToast) and, worse, real page content on some screens; no attribute to swap the generic red chat icon for the brand mark; and an **unconditional 5-second auto-open** on every single page load, found only by reading the script — nothing in the embed snippet mentions it. Went through three shapes before landing: a raw floating bubble (dropped for the above), a smaller logo-only floating trigger (dropped — still overlapped real content on mobile), and finally a plain entry point inside the existing Help Center and Contact pages, no floating element anywhere.

`/support` iframes Redber's own standalone `/embed/{botId}` page directly (confirmed live: a genuine full page, not a widget fragment) inside this app's normal layout — full control over placement and icon, no surprise auto-open.

**Found and fixed a real rendering bug along the way**, not just a cosmetic one: the chat body rendered blank white inside the first `/support` layout, which sized the iframe via `min-h-[70vh]` nested inside a `flex-1` chain. Isolated the cause by testing a plain fixed-height iframe against the same embed URL outside the app entirely — that rendered correctly, which meant Redber's page needs a definite, already-resolved iframe height on first layout, not one that only resolves after a later flex reflow. Fixed with an explicit `height: 70vh` in place of the flex-computed one.

Gated behind Admin → Platform → Settings (`support_widget_enabled`, default `'false'`, same on/off pattern this project already uses for `cookie_banner_enabled`) — verified `false` via a direct query before and after every local test, and again after this deploy. The project owner will turn it on once ready for real students, same as the campaign section earlier.

`/help`'s existing support nudge also gained a phone entry — it only had email before this, while `/contact` already had chat/email/phone; this closes that parity gap for signed-in students.

## 2026-08-19 — Found and fixed a 4-day regression silently undoing the canonical fix; tonight's deploy shipped it

Started as a routine indexation check (`site:easewithexam.com`, zero results — Google search results confirm the site is not indexed) and a request to investigate a robots.txt "blocked" signal in Search Console. The robots.txt check came back clean: none of the 6 public routes match any of the 29 `Disallow` prefixes, and the "Indexed, though blocked" GSC signal is consistent with a stale index entry from before 2026-08-11 (when 19 routes moved from crawlable to disallowed), not a live bug — left alone.

**What wasn't clean:** confirming the "page with redirect" signal meant checking what `/about` actually serves, and it turned out every one of `/about/`, `/contact/`, `/privacy/`, `/terms/`, `/refund/` was returning the HOMEPAGE's exact title and canonical (`<link rel="canonical" href=".../">`), not its own — a clean HTTP 200 the entire time, so nothing in routine status-code monitoring had caught it. This is the exact duplicate-content bug `4c841f1` (2026-08-15) fixed — undone the very same day by `aa4d920`'s nginx-404 fix, which had shipped only hours later.

**Root cause:** the nginx app-route block generated by `scripts/gen-nginx-routes.mjs` used `try_files $uri /index.html;` uniformly for every app route. That's correct for genuine client-only routes (no file exists on disk; must fall to the SPA shell) but wrong for the 5 routes that are real prerendered *directories* (`dist/about/index.html`, not `dist/about.html`) — without `$uri/` in the list, nginx never resolves the directory and falls straight through to the root shell. Confirmed via SSH that the files on disk were correct (`about/index.html` had the right title/canonical) — this was purely a serving-layer bug, not a build or transfer one.

**4 days undetected** (2026-08-15 to 2026-08-19, spanning tonight's own deploy) because every verification along the way — the original fix's own "RESOLVED" check, and this project's own `docs/DEPLOY.md` step 7 — checked HTTP status codes (`200/200/200/404`) and the served bundle hash, neither of which can distinguish "the right page" from "a different page that also happens to return 200."

**Fix:** `scripts/gen-nginx-routes.mjs` now derives the prerendered subset from `PAGE_SEO` (rather than a fourth hand-maintained list) and emits two location blocks — prerendered routes get `try_files $uri $uri/ /index.html;`, everything else keeps the original form. New test asserts the split itself (not just that the union still matches `App.jsx`'s routes, which the old test already did and would not have caught this). Reapplied via CloudPanel's Vhost editor — same manual-only path as the original fix, `sudo -n true` confirmed still failing.

**Verified live by content, not status code**, all 5 routes: distinct titles, canonicals ending in each route's own path, and 5 distinct byte sizes (16954/17566/20010/18996/18324) where all 5 previously matched the homepage's 60677 exactly. Bonus fix: the bare no-slash form (`/about`) now correctly issues a real `301 → /about/`, matching what this project's own docs originally described as expected static-server behavior — before this fix it silently 200'd with homepage content directly, a second symptom of the same bug. Confirmed the fix touched nothing it wasn't meant to: `/dashboard` still falls through to the empty SPA shell, `/no-such-page` still a genuine 404.

Sitemap resubmitted in Search Console after this landed, not before — resubmitting against the broken nginx config would just have had Google re-crawl 5 duplicate-homepage pages again.

**Process fix, not just a one-off:** `docs/DEPLOY.md` gained a standing step (Gotcha 4) requiring a title+canonical content check for every prerendered route on every future deploy touching routing, prerendering, or redirects — a 200 status code is evidence the server answered, not evidence it answered with the right page.

## 2026-08-18 — AI cost/efficiency pass; ai-proxy call attribution; OpenAI key rotated; permanent deploy history

### AI cost/efficiency pass (duplicate-upload guard, mini-model drafts, retry cache, per_chapter page numbers)

- `AdminContentIntake` now pre-checks `knowledge_base.chapter_key` before either extraction path runs (single-file/URL/Drive queue and the multi-file batch review) — warns with an explicit "Load anyway" override instead of silently re-spending on a chapter that's already loaded. Mirrors `bulk-load-unit-notes.mjs`'s own `alreadyLoadedKeys()`.
- Manifest drafts (`draftManifestFromContentsPage`) now run on `gpt-4o-mini` — vision extraction and content structuring stay on `gpt-4o`, untouched. The draft still requires human review/approval before anything is gated, so a cheaper model here doesn't lower the bar on what gets approved.
- New opt-in accidental-duplicate cache (`cachedChatComplete`, session-scoped, 15 min TTL, `temperature:0` only) wired into vision page reads and notes/PYQ structuring batches — deliberately never into plain `chatComplete()`, so a "Regenerate"-style caller still gets a fresh answer.
- `'per_chapter'` manifests no longer require page numbers on numbered entries (matching there is already `fileOrdinal`-only); the manifest-draft prompt now tells the model to leave every `pageStart`/`pageEnd` null when a contents page prints none, rather than inventing one. Interleaved manifests are unaffected — they still always require page numbers.
- Verified live: mini-model draft calls log `gpt-4o-mini` in `ai_call_log`, `checkAlreadyLoaded` correctly flags/clears against real fixture rows, a no-page-number contents page drafts with every `pageStart`/`pageEnd` null.

### ai-proxy call attribution

- New `ai_call_log` table (service-role write, admin-only read via `admin_list_ai_call_log`/`admin_ai_usage_summary`) tags every one of the 32 real `ai-proxy` call sites with a feature label — closes the gap where roughly 80% of that month's $84.45 OpenAI spend couldn't be attributed to any feature after the fact.
- Hit the exact anon-grant mistake `20260815060000` had already documented and named, a fourth time this week: the two new RPCs were granted to `authenticated` only, and Firebase-authenticated PostgREST requests run every request as `anon` — unreachable for every real caller until a follow-up migration fixed it. Caught via a live smoke test before shipping.
- **The OpenAI API key itself had been invalid/expired since the July audit** (`docs/ACTION_ITEMS_FOR_YOU.md`), blocking AI features. Rotated tonight and verified live via `ai_call_log` — a real (failed, insufficient-quota, unrelated) OpenAI call logged correctly with feature/model/status/error/duration.
- Deployed and verified end-to-end at the time: migration pushed, `ai-proxy` edge function redeployed, tagged frontend bundle live as `index-DC-IQsmz.js`. **That is still the bundle actually being served as of the 2026-08-19 status check below** — the AI cost/efficiency pass above (duplicate-upload guard, mini-model drafts, retry cache, per_chapter exemption) was written and tested but never transferred to production. See the next entry for the deploy that ships it.

### Permanent deploy history

- New `deploy_log` table + `admin_insert_deploy_log`/`admin_list_deploy_log` RPCs (`SECURITY DEFINER`, gated by `assert_verified_admin`, same anon-grant posture as `ai_call_log`) — replaces "deploy history lives in chat transcripts and `DEPLOY.md`'s own prose" with a queryable, admin-visible record, versioned `YYYY.MM.DD.N`.
- `/admin/changelog` (`AdminChangelog.jsx`, wired into `AdminOpsHub` as a new "Changelog" tab) — read-only, one entry per deploy, written once as the first step of `docs/DEPLOY.md`'s procedure. No update/delete RPC exists on purpose.
- Verified locally (real Firebase admin sign-in, real RPC call, not mocked): `admin_list_deploy_log` returns real data (empty, correctly — no deploys logged yet at verification time), the tab renders, zero console errors.

## 2026-08-16 — Multi-file batch upload; manifest-lookup `.maybeSingle()` bug

- Multi-file batch upload for notes: each file's real printed page range is detected deterministically from its own text (`pageRangeMatch.js` — no second AI call, no model-guessed chapter boundaries) and matched against the manifest's page ranges plus the existing filename-ordinal signal. Feeds a mandatory per-row review screen (`MatchReviewScreen`) — every row, including full-agreement matches, needs an explicit Confirm before Process touches it; ambiguous, conflicting, or unreadable files get no pre-selection and must be picked manually.
- Fixed a latent bug the end-to-end run surfaced: the manifest-lookup query had no status filter, so a book with both a live approved manifest and a newer in-progress draft returned more than one row, which `.maybeSingle()` treats as an error — silently resolving to "no manifest" and blocking uploads against a manifest that was still perfectly approved. Now filters to draft/approved, prefers approved when both exist.
- Verified end-to-end against a seeded, approved 3-chapter manifest and three real fixture PDFs: a clean content+filename match, a content-only match, and a genuinely ambiguous file with no readable page numbers (correctly excluded from auto-selection, required a manual pick). Full suite (548 tests) and production build pass.

## 2026-08-15 — Chapter manifest pipeline hardening; background job runner Tier 2; Refund Policy page

### Manifest pipeline

- `fileOrdinal` now defaults to `printedNumber`/`ordinal` at draft time instead of hardcoding null — was silently breaking Poorvi and CBSE Class 8 Mathematics, fixed each time by hand-editing the approved row. `admin_approve_chapter_manifest` now refuses to approve any manifest with a null `fileOrdinal` on a numbered entry, naming which ones.
- New `chapter_manifests.file_structure` column (`'combined' | 'per_chapter'`) splits the page-range sanity check, which turned out to be combined-book-only logic applied universally: a per_chapter file's own page 1 isn't guaranteed to be the chapter's logical page 1, so the check is skipped entirely for those and `fileOrdinal` matching is the only signal. `inferFileStructure()` suggests a value from the entries' own `fileOrdinal` distribution; the admin screen shows it as a live hint and never auto-saves it.
- Merge entries tool added to the Chapter Manifests draft editor — combines 2+ adjacent draft rows when text-only contents-page extraction can't reliably tell whether two lines are one entry wrongly split or two real ones. Refuses to merge non-adjacent rows rather than silently absorbing whatever sits between them.
- `bulk-load-unit-notes.mjs`'s file filter fixed: required the literal substring "unit" (a leftover from Poorvi-only naming), so a normal numbered-chapter book matched zero files — found live trying to enqueue CBSE Class 9 English. Replaced with the real `fileOrdinalFrom()` parse, the same signal upload-time matching already uses.
- Tier 2 of the background job runner: `content_jobs` gains a `'queued'` status, atomic claim (`for update skip locked`), and stale-`'running'` reclaim; `bulk-load-unit-notes.mjs` gains `--enqueue`/`--work` CLI modes; new admin Status tab (`AdminContentJobs.jsx`) with search, stats-as-filter, and a Requeue action on failed jobs.
- Admin-override picker added for files that can't auto-match a manifest entry — always a picker over the manifest's closed set of entries, never free text. Every override is logged (filename, chosen entry, reason, actor, timestamp).
- Coerced a model-returned `pageEnd` of `0` to null — page numbers are 1-indexed and can never legitimately be `0`.
- Two more anon-grant bugs, same root cause as always (Firebase-authenticated PostgREST requests run as `anon`, not `authenticated`): `admin_upsert_chapter_manifest` (broke every manifest save, found live testing the merge tool) and the 18 other `admin_*` functions the audit script (`scripts/audit-admin-rpc-grants.mjs`) still flagged after an earlier one-time sweep. Both fixed and verified live (anon denied with a real security message, real admin session succeeds).

### Public site

- Refund Policy page added at `/refund` — was promised on the Pricing page and the paywall modal, and contradicted by Terms of Service. States a 7-day window per charge including renewals and a 5-7 business day processing estimate (industry-standard default pending owner sign-off). Terms of Service now points here instead of contradicting it.
- nginx 404 fix marked RESOLVED and the real deploy path documented: the SSH procedure in `DEPLOY.md` turned out unusable (the deploy user has no sudo and can't read the vhost file) — CloudPanel's Vhost editor is what actually works, applied and verified live.

### Investigated, no action taken

- Background upload with no terminal step kept open: an in-tab worker doesn't actually solve it (the tab still has to stay open), and a real server-side/daemon worker is a separate project with its own attack surface. `--enqueue`/`--work` (above) is the usable path for now; logged as a future, unscoped project.

---

## 2026-08-15 — Fixed the trailing-slash redirect that broke 4 of 5 public pages' canonical URLs

Found via Search Console reporting "Page with redirect" for a public page. Root cause, confirmed live before fixing: `scripts/prerender.mjs` writes each non-root route to a real directory (`dist/about/index.html`), and a static server 301s any bare request for a URI that resolves to an actual directory, adding a trailing slash — independent of which nginx location block matches, so this was never dependent on which nginx config variant was live. `sitemap.xml`, `PAGE_SEO`'s canonical URLs, and prerender's own self-check all declared the *no-slash* form as canonical, so Google's crawler requested exactly the URL that redirects, landing on a page whose own baked-in canonical pointed straight back at the URL that had just redirected it there. `/` was never affected — it prerenders straight to `dist/index.html`, no subdirectory involved.

Fix: `absUrl()` in `src/lib/seo.js` now always trailing-slashes non-root paths — that's the URL that's actually 200-able without a hop. `prerender.mjs` imports `absUrl` directly instead of hand-rolling the expected-canonical string, so the two can't drift again. `sitemap.xml` updated to match. Every internal link to these four pages (`PublicChrome.jsx`'s nav + footer, `PlatformChrome.jsx`'s cookie banner, `PhoneOTP.jsx`'s consent line, `NotFoundPage.jsx`'s suggested links) updated to the trailing-slash form too, so real navigations stop eating a redirect hop. `PAGE_SEO`'s dictionary keys and `<Route path>` in `App.jsx` deliberately kept slash-less — those are route *identifiers* matched client-side by React Router (which is trailing-slash-insensitive by default), not the served URL, and changing them would have been scope creep with no effect. `seoRoutes.test.js`'s sitemap-vs-`PAGE_SEO` assertion updated to strip the slash back off before the lookup, since `PAGE_SEO` stays keyed by the no-slash identifier.

The old no-slash URLs still resolve — one clean 301 to the new canonical, same as any legacy link — they're just no longer what the sitemap or canonical tags declare as the real URL. Verified live post-deploy: all four now 200 directly at the trailing-slash form, canonical tags match the serving URL exactly (no more circularity), sitemap.xml matches, and the old form still 301s cleanly rather than erroring.

A second claim investigated the same session — an `X-Robots-Tag: noindex` header allegedly present on every page including the homepage — did **not** reproduce from this vantage point across repeated `curl -I` checks (homepage, `/about/`, and `/admin` directly) before or after this deploy, and the only nginx config file in the repo has no such directive. Left unresolved pending evidence of what was actually seen and from where — not touched, because there was nothing here to fix.

---

## 2026-08-12 (session 29) — non-STEM Stage A: the `book` dimension and a 21-value taxonomy

Stage A of loading the 372 unloaded non-STEM PDFs. **Design and code only — neither migration is applied and nothing is loaded.** Stage B (reading ~35 contents pages) is next and is the step that must not be skipped.

### `book` is a column, but uniqueness is carried by `chapter_key`

Eight subjects are two *separate textbooks* rather than Part 1/2 of one book — Hindi A/B, Hornbill/Woven Words, Economics Development/Statistics, Political Science ×2, Sociology ×2, Accountancy ×2 — and each numbers its chapters from 1. This is not the multi-PART case: `chemistry part 1` + `part 2` collapse to one `Chemistry` correctly, because that book's numbering is continuous.

The obvious move — add `book` to the UNIQUE key — is wrong, and this is the part worth remembering. `book` is NULL for all 148 existing STEM rows and **Postgres treats NULLs as distinct in a unique index**, so putting it in the key would stop `(exam_type, subject, chapter_key)` protecting single-book subjects against duplicate chapters. It would introduce a bug into the corpus that is currently correct, in order to fix one in the corpus that does not exist yet.

So the two concerns are split: `book` (nullable column) does grouping, display and picker scoping; a **book-scoped `chapter_key`** (`c11_hornbill_*` vs `c11_wovenwords_*`) carries identity under the existing constraint, untouched. `chapterKeyFor()` in `src/lib/syllabus.js` builds it, and the same short book label goes into both the key and the column so they cannot disagree.

Within-book *sections* (Hornbill prose `kehb101-106` then poetry `kehb111-116`; Woven Words stories/poems/essays) restart numbering too, and are handled by banding `sort_order` — prose 1-99, poetry 100-199, essays 200-299 — reusing the convention the NEET rows already use. No third column for a display concern.

### 10 new content_type values, not 14

The existing 11 describe STEM; nothing in them fits a poem, a primary-source extract or a balance-sheet format. Added: `literary_prose`, `poem`, `drama`, `author_note`, `event`, `case_study`, `source_extract`, `map_work`, `procedure`, `format_template`.

Three from the original sketch were **dropped as near-synonyms** — `concept` → `definition`, `worked_problem` → `solved_example`, `comprehension_exercise` → `exercise`. Every redundant value is a coin-flip for the classifier and a split bucket for anything filtering on it.

**`prose` is not reused for literature**, which matters more than it looks. `prose` currently means *"the classifier had nowhere better to put this"* — its 79.8% share on the 4,363-row corpus is what justified adding `exercise`/`activity`/`summary`. If First Flight stories land in it, that number stops distinguishing "the taxonomy has a hole" from "we loaded a lot of literature", and the signal is gone permanently. Hence `literary_prose` as a positive value.

Scoping is **prompt-side**: the CHECK constraint is the flat union of all 21, and `SUBJECT_FAMILIES` decides which subset each subject is offered — same shape as `PARTIAL_SYLLABUS_EXAM_TYPES` scoping the closed-list rule per exam type. `CONTENT_TYPES` is now *derived* from the families rather than hand-maintained, so the JS set can no longer drift from them (`normaliseClassification` nulls anything missing from it, silently, with no error).

`familyForSubject()` deliberately has **no `/science/` rule** — `stem` is the fallback. That removes by construction the ordering hazard that bit `subjectForFolder()`, where a generic match swept up Computer/Political/Social Science and each had to be excluded by hand ahead of it.

### Two carried decisions, as they landed

- **Literature granularity = individual text.** The lesson rule inverts for literature only: a unit ("Wit and Wisdom") goes in `unit` and each story inside it is its own lesson. The default rule would have returned one lesson per unit and buried three texts — the exact shape retired from the Class 8 English syllabus last session.
- **`techniques` null for non-STEM.** In practice `[]`, which `normaliseClassification` already produces for a missing value, so no schema change.

`runNotesExtraction` now **throws** if a literature file arrives without the `pages` array. Verbatim source text is sliced from the original pages via the `[[PAGE N]]` markers, never from model output (it paraphrases when asked not to), and a literature load that quietly fell back to `rawText` would produce chapters that look complete and cannot support an extract question.

### Verified both halves

40 new tests, **329 pass**, build clean. The STEM half is asserted as *byte-identical* strings, not "equivalent" — the 148 loaded files were classified by those exact words, and a reworded menu silently reclassifies every future load against a corpus labelled by the old one. The collision half asserts that the naive key **does** collide before asserting the scoped one does not, so the test states why the fix works rather than only that it does.

### Corpus finding: Hindi A is one book, not two

`10 HINDI A/KRITHIKA 2/jhks1dd/` and `10 HINDI A/KSHITIJ 2/` hold the **same 13 filenames at the same 13 byte sizes**. `jhks` is NCERT's code for *Kshitij*; *Kritika*'s code is `jhkr` and **no `jhkr` file exists in the 520**. So Kritika is absent from the corpus and that folder is a misfiled second copy of Kshitij — loading both duplicates 13 chapters. To be md5-confirmed in Stage B; plan on 13 files coming off the 372.

### Deploy ordering — one-way, unlike 20260810070000

`syllabus.js` now selects `book`, and PostgREST rejects a select naming a column that does not exist. **Apply `20260812040000` before deploying the client.** The reverse is safe: the migration alone breaks nothing, because the old client does not ask for the column. There is no degraded window and no need to pair them in one session — a genuinely softer constraint than the `text[]` signature change, and worth not conflating with it.

---

## 2026-08-11 (session 27) — payments gated behind `payments_enabled` until 14 August

Ahead of campaign traffic, with the bank account not yet active.

**Payments were already blocked — just badly.** `create-razorpay-order`, the first server call in checkout, is present in source but **not deployed**: it returns HTTP 404, verified against production. So no payment could complete, and a student clicking a paid plan got *"Could not start checkout. Please try again."* — a message that reads as a transient glitch and invites retries. The exposure was never a bad transaction; it was a confusing one.

`src/lib/paymentsGate.js` is the single source of truth, consumed at the three points that matter:

- **`initiateRazorpayPayment()`** returns before `loadRazorpayScript()`, so a gated site issues no third-party request and renders no checkout chrome. Backstop for any path reaching checkout anyway — a stale tab, a direct call, a future caller.
- **`PricingPage`** shows a dated notice; paid CTAs read "Opens 14 August" and are inert. The free plan is untouched.
- **`PaywallModal`** swaps its Pay button for the notice plus "Keep using the free plan". It fires when a student hits a quota wall — their most frustrated moment — so it has to explain rather than fail.

Both UIs treat *flag-loading* as closed, so a live purchase button never flashes for a frame before the flag resolves and withdraws it.

### The flag is `payments_enabled`, not `payments_disabled`

`getFeatureFlag()` resolves a missing row, an unreachable `feature_flags` table, or a failed fetch to **false**. Naming the flag for the enabled state makes "we could not read the flag" and "payments are off" the same answer, so every failure mode leaves payments off — the safe direction for money. `payments_disabled` would invert it: a transient DB blip would read as "not disabled" and re-open a checkout that cannot complete.

This is the same reasoning as `answer_verification_off`, not a departure from it. That flag is opt-OUT because the safe default is verification ON; this one is opt-IN because the safe default is payments OFF.

The migration seeds the row disabled with `on conflict (key) do nothing`, so re-running it can never silently re-close payments after the 14th. The row also has to exist for the admin toggle to appear at all — `AdminFeatureFlags` lists existing rows via `admin_get_feature_flags` — though **blocking does not depend on it**, since a missing flag already reads as false.

**Re-enable on the 14th:** Admin → Platform → Feature Flags → `payments_enabled` → ON. Procedure and the two pre-flight checks are in `ACTION_ITEMS_FOR_YOU.md`.

7 new tests, 211 pass. Deliberately touches no SEO file. **Not deployed** — the gate has no effect on the live site until the bundle ships.

---

## 2026-08-11 (session 26) — SEO Tier 0 + Tier 1, and a 404 that is actually a 404

An SEO audit found two things that made the rest of the work conditional, both recorded here because they bound what any of this can achieve:

- **Search engines receive a blank page.** Fetched as Googlebot, the live site returns `<body><div id="root"></div></body>`. No SSR, no prerendering. Worse than the usual SPA case, because `/` renders behind `RequireNoAuth`, so the marketing page cannot paint until Firebase Auth resolves.
- **There is almost nothing to index.** The public surface is five routes. The 181 study notes, 268 syllabus chapters and 1,217 PYQs are all behind auth. Perfect metadata on five pages still ranks for almost nothing.

Both are Tier 2 (prerendering + public content pages) and were explicitly **not** started. What follows is the groundwork that has to exist first.

### Fixed

**`og-image.png` returned 404.** `index.html` had pointed `og:image` and `twitter:image` at it since the tags were written; the file never existed, so every share on WhatsApp, LinkedIn, Slack or X rendered as a bare text link. Now generated by `npm run og:image` (`scripts/og-image.mjs`, Playwright, same approach as `landing-assets.mjs`).

**Four of five public pages asked to be de-indexed.** `index.html` shipped one canonical hardcoded to the homepage, and every route serves that file — so `/about`, `/contact`, `/privacy` and `/terms` each declared themselves duplicates of `/`, while `sitemap.xml` simultaneously listed them as distinct URLs. `src/lib/seo.js` now sets title, description, canonical and OG per route.

**The rendered `<title>` was being destroyed.** `PlatformChrome.jsx` ran `document.title = platform_name` unconditionally, so every public page rendered as `"EaseWithExam"` — and Google indexes the rendered DOM, not the static tag. It now skips paths that own their SEO, and still renames the tab inside the app, which is what the setting is for.

**The H1 named none of the target terms.** "Crack Your Exam With an AI Tutor" contains no exam, no board, no country. Now "NEET, JEE & CBSE Prep With an AI Tutor", with the lede naming CBSE, Kerala State, NEET and JEE.

Board coverage is stated throughout as **CBSE and Kerala State, not "all state boards"** — `SUPPORTED_SYLLABI` lists exactly those. The old description claimed "all state and central boards". A test now fails on that phrasing, extending the landing page's "nothing invented" rule to metadata, because an overclaiming description earns a bounce and bounces are a ranking signal.

### The 404 was a redirect, which was worse than nothing

`<Route path="*" element={<Navigate to="/dashboard" replace />}>` sent every logged-out visitor — so every crawler — to `/dashboard`, off `RequireAuth`, and back to `/` under HTTP 200. An unbounded set of bad URLs returned homepage content.

Fixed in two halves, because **a static SPA cannot set its own status code**:

- `src/pages/NotFoundPage.jsx` — branded, links back into the app, `noindex`. Ships with the next normal deploy. Still HTTP 200 on its own.
- `public/404.html` + `deploy/nginx-easewithexam.conf` — standalone page and the vhost block that returns a real 404. **Prepared, not applied**; needs a maintenance window (procedure and verification in `docs/DEPLOY.md`).

Both are needed: nginx answers a direct hit on a bad URL, React answers a bad route reached by client-side navigation, where no request is made. Returning users with the service worker active take the React path too, since the worker serves `index.html` from cache.

**The nginx route list is generated, not hand-written** (`npm run nginx:routes`). Hand-maintaining it fails backwards and silently: add a route to `App.jsx`, forget the conf, and a working page 404s in production. `seoRoutes.test.js` fails on drift. The generator initially hoisted nested `/admin` children — `content`, `publish`, `papers` — to top level, which would have made 28 paths serve `index.html` and soft-404 again; it now takes absolute paths only, 32 prefixes.

### Also

`robots.txt` now disallows all 29 auth-gated prefixes (was 9) — each one previously served `index.html`, redirected to `/`, and looked like another homepage copy. `sitemap.xml` gained `lastmod`. Structured data gained `WebSite`+`SearchAction` and a `FAQPage` generated from `FAQ_FLAT`, the same constant that renders the visible FAQ — Google requires those to match, and deriving both from one source is what guarantees it.

`src/lib/analytics.js` is a deliberate no-op. Search Console is already verified and needs nothing in the bundle; no analytics vendor was chosen (owner's call), so this exists so that connecting one later is a config change rather than a hunt for every pageview site.

10 new tests in `src/lib/__tests__/seoRoutes.test.js`. **Nothing deployed** — the whole batch is local and committed only.

---

## 2026-08-11 (session 25) — syllabus seeded for CBSE Classes 8, 9 and 11; Class 8 Maths found to be seeded against the wrong textbook edition

`syllabus_nodes` went from **141 to 268 rows** (+127), via `scripts/seed-syllabus-from-corpus.mjs` — the same insert-only, dedupe-by-`chapter_key` path used for Class 10 and NEET. Nothing was deleted or edited.

| Exam / subject | Before | After | Inserted |
|---|---|---|---|
| CBSE Class 8 / Science | 0 | 13 | 13 |
| CBSE Class 8 / Mathematics | 11 | 26 | 15 |
| CBSE Class 9 / Mathematics | 0 | 8 | 8 |
| CBSE Class 9 / Science | 0 | 14 | 14 |
| CBSE Class 11 / Physics | 0 | 14 | 14 |
| CBSE Class 11 / Chemistry | 0 | 9 | 9 |
| CBSE Class 11 / Biology | 0 | 20 | 20 |
| CBSE Class 11 / Mathematics | 0 | 14 | 14 |
| CBSE Class 11 / Biotechnology | 0 | 20 | 20 |

Class 8 Science was **not** covered — it had zero rows against 321 loaded chunks.

### Class 8 Mathematics was not partial — it was the wrong book

The 11 pre-existing rows are the **old** NCERT Class 8 Maths chapter list (Rational Numbers, Linear Equations in One Variable, Practical Geometry, Mensuration…). The 427 loaded chunks are the **new** *Ganita Prakash* Part 1 + Part 2 (A Square and A Cube, Number Play, The Baudhāyana-Pythagoras Theorem…). Real overlap is **zero**: the single `chapter_key` collision, `c8_cubes_and_cube_roots`, comes from a stray duplicate ingestion (below), not from a shared chapter.

So Class 8 Maths carried 26 rows for a 14-chapter book: 15 correct new-book names, **10 stale old-book names with no corpus behind them**, and 1 collision. The stale rows were live snapping targets — `matchSyllabusChapter()` would happily snap an extracted PYQ chapter onto "Mensuration", which no chunk uses, making that content unreachable.

### The 10 stale rows are now deactivated, not deleted

`scripts/deactivate-stale-c8-maths-syllabus.mjs` sets `is_active = false` on exactly those ten `chapter_key`s. Deliberately reversible rather than destructive, this close to launch — the same script with `--reactivate` puts them back, and no row was destroyed.

**Class 8 Mathematics: 26 rows, 16 active.** The active set is now *exactly* the set of chapter names the corpus uses — verified both directions, zero active rows without corpus and zero corpus chapters without an active row. Those 16 are the book's 14 real chapters plus the 2 section-level names from the duplicate Chapter 1 ingestion below, which stay active so their chunks are not orphaned.

`c8_cubes_and_cube_roots` was **excluded** from the deactivation despite looking like an eleventh old-book row: `knowledge_base` really does carry 3 chunks under that name.

**The deactivated rows are invisible in Admin → Syllabus**, which filters `is_active = true` (`AdminSyllabus.jsx:708`). Reversal is via the script, not the UI.

Verified that deactivation actually gates the snapping path rather than being cosmetic: `getChapters()` filters `.eq('is_active', true)` (`src/lib/syllabus.js:43`), and it is the source for Content Intake's snap list (`AdminContentIntake.jsx:357` → `matchSyllabusChapter`), question generation (`questionGen.js:1042`), the student chapter list (`useSyllabusChapters.js`), and the Content Map (`AdminContentMap.jsx:210`).

### Duplicate ingestion of Class 8 Maths Chapter 1

`Chapter 1 a Square and A cube.pdf` is loaded twice: cleanly under `NCRT 8/…PART 1/` (25 chunks, all named "A Square and A Cube"), and again under a bare `file:` source (14 chunks, which the structuring pass split into three names — "A Square and A Cube", "Understanding Perfect Squares", "Cubes and Cube Roots"). The two section-level names were seeded as chapters, because excluding them would orphan their chunks from chapter-based lookup. Fixing this properly means de-duplicating the corpus, not editing the syllabus.

### CBSE Class 12 could not be seeded

Zero Class 12 chunks exist, so a corpus-derived seed yields nothing — confirmed by dry run across Physics, Chemistry, Biology and Mathematics. Unchanged from the §5 limitation in `PROJECT_STATUS.md`. Note this is a *CBSE Class 12* gap only: NEET already carries 47 `class_level=12` rows (of 99) from the static seeder, so NEET attribution to Class 12 chapters still works — there is just no source material behind them.

### Lower-confidence chapter names now in the vocabulary

Seeded as-is, because the vocabulary must match what the chunks are actually tagged with: Class 9 Science **"Exploration"** (14 chunks, looks like a truncation of "Exploration: Entering the World of Secondary Science", which is also present) and Class 11 Biotechnology **"Chapter 1: Introduction"**. Class 11 Chemistry produced only **9** chapters for 576 chunks, which is short of a full Class 11 syllabus — a corpus coverage gap, not a seeding one.

---

## 2026-08-11 (session 24) — migration + client deployed in one window; NEET now reads the Class 11 corpus

`20260810070000` applied and the client deployed together, as required: the migration drops `match_knowledge_base`'s scalar `filter_exam_type` signature, so the live bundle and the new schema cannot both work. The site was deliberately degraded for the ~6 minutes between them.

Verified at each stage rather than at the end. Immediately after the push: the `text[]` filter is accepted, a NEET query reaches `CBSE Class 11` rows, the 3-arg legacy call still resolves, and — the check that matters most — the **old scalar shape now returns HTTP 400**, confirming the cutover was real and the deploy genuinely urgent rather than assumed so.

Post-deploy, against production: retrieval works, **NEET reaches Class 11 content**, CBSE Class 10 is uncontaminated, Ask-EWE works, student generation runs with verification correctly skipped (0 model calls, `stats.disabled=true`), and Exam Center CBSE papers keep their sections at `{MCQ:17, A-R:2, Short Answer:11}` — matching the pre-change baseline, so the regression guarded against in session 23 did not materialise.

**Semantic verification shipped OFF** (`answer_verification_off = true`), a deliberate launch-day choice: students get option shuffling and the free cross-check without the extra per-question API call. Enabling it later needs no redeploy.

### Two deploy failure modes found, both now documented

**`tar` exits 2 on a successful deploy.** `assets/` and `landing/` are owned by a different user, so tar cannot restore their mode/mtime and exits non-zero *after extracting every file correctly*. Trusting the exit code alone would have triggered a false rollback. `--no-overwrite-dir` fixes it.

**199 files landed non-world-readable.** The tarball carries the build machine's permissions, so files extracted as `640` where the previous deploy's were `644`. Directories are `770` and owned by another user, so a web server outside that group could not have read them. Caught by comparing against the previous deploy's permissions rather than by waiting for a 403.

The procedure existed only in the owner'''s head until now; it is written down in `docs/DEPLOY.md`, along with the SSH-alias trap (`IdentitiesOnly yes` means the bare `user@host` form fails), the breaking-migration ordering, and rollback in both directions.

---

## 2026-08-11 (session 23) — semantic answer verification shipped, and both question types measured for the first time

`src/lib/answerVerification.js` — a second `gpt-4o` pass re-solves each generated question from scratch and disagreements are flagged `needs_review`, which the student paths drop. Wired into `PracticeGeneratorPage` and `backgroundGeneration.js`. Behind an **opt-out** flag (`answer_verification_off`): a missing flag row reads as false, so a safety check stays on by default while remaining disable-able without a deploy.

Two properties worth keeping. It **never sees the stored key, explanation or answer** — showing the model the answer turns independent re-solving into agreement bias, and the measured recall would be fiction, so a test asserts it with sentinel values. And it **fails open**: a verification error leaves the question exactly as it was, because turning a transient API fault into an empty quiz would be the worse failure.

### Measured, hand-adjudicated, both types

| | MCQ (30) | Numerical (34) |
|---|---|---|
| wrong keys generated | 4 (13.3%) | 5 (14.7%) |
| served-wrong, no checks | 13.3% | 14.7% |
| served-wrong, cross-check only | 10.3% | **14.7%** |
| served-wrong, **both** | **7.4%** | **6.9%** |

Roughly halved on both types. The middle Numerical row is the finding: **the free cross-check flagged 0 of 34**. It compares the keyed *option* against its explanation, and numericals have no options — it is structurally blind to them, so before this work numericals had no validation of any kind.

**The ~75% combined recall projected when this was scoped did not hold — measured 50-60%.** Recorded plainly rather than quietly restated: both MCQ misses were cases where the verifier agreed with a wrong key, including one where the correct option was present and the explanation stated the right value (`p(1) = 0`, keyed as `1`).

### Three defects found by measuring

**1. A student path was never filtered at all.** `backgroundGeneration.js` publishes straight to the student, scores them and writes `weak_topics` — and had never filtered `needs_review`, so it served questions the blocking flow has withheld since session 17.

**2. The Numerical type could not be measured because it is barely generated.** Asking CBSE Class 10/11 for `qTypes:['Numerical']` returns 28 MCQ + 2 Assertion-Reason and **zero** Numericals: `generateQuestionPaper` hardcodes `effectiveTypes` for CBSE-style exams and that list omits Numerical, so the request is silently discarded. Measured under JEE Main/Advanced instead, which honour it — and even there compliance is partial (one Physics batch returned 15/15 MCQ). The CBSE evidence is kept as a benchmark set rather than deleted.

**3. A false positive of my own making.** The verifier answered `1/3` against a key of `0.333333` — the same value — but `firstNumber` took the numerator and reported a disagreement, withholding a sound question. Fractions are now evaluated, guarded against slash chains so `1/3/2024` still reads as `1` rather than `1/3` or `3/2024`. Recomputed over the same 34 from the stored verifier answers (no new model calls): that FP disappears, nothing else moves — precision 50% → 60%.

### Benchmark is now reproducible

The previous two measurements were ad-hoc, so "the same benchmark" could only be re-approximated. `scripts/benchmark-answer-quality.mjs` fixes the configuration in code and checkpoints each batch; `benchmark-score.mjs` computes served-wrong rates per regime. The harness deliberately does **not** judge correctness — the premise is that the model is wrong ~10-15% of the time, so letting a model grade itself would launder the error rate rather than measure it. Verdicts are hand-adjudicated and merged in.

Left open and logged rather than fixed unsupervised: the residual ~7% served-wrong rate, ill-posed Numericals whose answer isn't a single number, CBSE ignoring a caller's `qTypes`, and Admin Paper Gen not running the verifier.

---

## 2026-08-10 (session 22) — 1,130 NEET PYQs loaded across six years, and four defects found by checking rather than counting

New `scripts/bulk-load-pyq.mjs`, same hardened shape as `bulk-load-corpus.mjs`: checkpointed and resumable, one file at a time against the 30,000 TPM ceiling, 429 backoff, dev-server probe up front. It drives the real modules — `extractPagesWithVision`, `runPYQExtraction`, and `savePYQRows`, which was exported from `AdminContentIntake.jsx` so the loader shares the admin screen's row shape instead of keeping a second copy that could drift.

**1,130 questions, 99.7% snapped to the seeded syllabus, all three subjects clearing Blueprint V2.**

| subject | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 | total |
|---|---|---|---|---|---|---|---|
| Physics | 50 | 50 | 50 | 50 | 47 | 45 | 292 |
| Chemistry | 50 | 46 | 47 | 48 | 41 | 35 | 267 |
| Biology | 100 | 98 | 99 | 100 | 92 | 82 | 571 |

### The manifest is explicit because the folder is not trustworthy

All 20 PDFs were opened and identified — md5 for duplicates, page text for subject/year, chars-per-page for text-layer usability. Three files were **byte-identical**; four more were scans of exams that two combined papers already carried with a clean text layer. Globbing the folder would have double-loaded ~300 questions. Six files skipped, each with a recorded reason.

### Four defects, each caught by verifying rather than trusting the counts

**1. The branding filter ate the subject matter.** `MOTION` and `PW` were in the institute-brand strip list. "Motion" is a core physics word — the first 2021 Physics load returned **zero** questions containing it, in a paper whose chapters include "Laws of Motion" and "Motion in a Plane". Those rows were deleted and reloaded. Only unambiguous brand tokens remain; `PW`/`Motion` now match solely alongside app-store chrome.

**2. Batching was silently dropping a quarter of every paper.** 2021 Physics extracted **37 questions; the paper has 50**. Independent denominators — counting question-number markers in each PDF, where NEET numbers Physics 1-50, Chemistry 51-100, Biology 101-200 — turned "the extractor said 37" into "the extractor lost 13". `PYQ_BATCH_CHARS` 12,000 → 9,000 → **5,000** and `PYQ_MAX_TOKENS` → 6,000, the second cut forced by a real truncation throw on 2021 Biology: Biology runs **200+ tokens/question** against Physics/Chemistry's ~130, because its stems and explanations are prose. Both re-runs then came back exactly complete (50/50, 50/50, 100/100).

**3. A solutions section read as a second set of questions.** The 2025 combined paper returned **329 questions against a true 180** (71/81/177 versus the real 45/45/90) — pages 27-48 are full solutions, and sequential batching has no memory of what it already extracted. Duplicates are worse than gaps here: Blueprint V2 weights chapters by raw frequency, so a duplicated section silently doubles its pull on every generated paper. Added `pageRange` to the loader; 2025 reloaded to **exactly 180**.

Its answer key sits alone on page 26 as a compact list covering all 180. A key in one batch can only answer that batch, so `runPYQExtraction` gained an optional **`preamble`** repeated into every batch. 2025 answer coverage went **67 → 180 of 180**.

**4. NEET answer keys were unparseable, and one paper's were invented.** `parseAnswerLetter` mapped only `A`-`D`, but NTA numbers its options `(1)`-`(4)` — so all 180 valid 2025 keys resolved to null, reported as "unparseable answer key". Now accepts both, anchored to the first token so `"42"` is still not option 4 and `"BONUS"` is still not option B. 246 stored rows normalised to canonical letters; the key distribution is now unskewed (A 237 / B 270 / C 207 / D 209).

Separately, the 2024 source turned out to be a **question-only test booklet** — 2 "Ans" markers in 66k characters, no key, no solutions — yet the extractor returned 45 answers, betraying themselves as option *text* (`"Succinyl-CoA → Succinic acid"`, `"( ) 2 1 x kcalm yr − −"`) with no explanations. **All 198 were set to null.** This project has already measured 10% hard-wrong keys from model inference, and a wrong key marks a correct student wrong *and* poisons their `weak_topics`. Options for recovering 2024's keys are logged in `ACTION_ITEMS_FOR_YOU.md` rather than guessed at.

Owner decision: **leave 2024 as-is** — questions and chapter attribution kept, no answer keys. Nothing depends on them, and Blueprint V2 needs chapter distribution rather than answers. Recovery options are recorded as post-launch and optional.

**Answer keys: 923 of 1,130 (81.7%)** — the 207 nulls are 198 from that 2024 booklet plus 9 genuinely absent.

The run checkpoint was reconciled against the database afterwards, which mattered more than it looked: the loader's end-of-run summary **sums `withAnswer` across checkpoint entries**, so the stale pre-null figures would have reported 968 keys against a real 923. Every entry is now recomputed from the live table, with `withAnswerAtLoad` preserving what extraction originally returned. No institute name is recorded anywhere: `exam_type` is NEET, plus subject and year, and `source` is a synthetic key. Zero branding leaks in the loaded text.

---

## 2026-08-10 (session 21) — NEET syllabus seeded from the Class 11 corpus, ahead of the first NEET PYQ upload

43 `syllabus_nodes` rows for NEET Physics (14) / Chemistry (9) / Biology (20), so chapter snapping works on the first upload rather than after it.

**Seeded from the Class 11 corpus on purpose, not from a syllabus list.** Content Intake snaps every extracted PYQ chapter onto a `syllabus_nodes` name, so seeding NEET from the same chapter strings `knowledge_base` already uses is what lets a NEET question reach Class 11 content at all. Seeding from any other list would have produced a syllabus that looks right and silently fails to join. Verified after writing: **43/43 chapter names match a `knowledge_base` chapter exactly**, covering all 1,531 Class 11 Phy/Chem/Bio chunks.

`seed-syllabus-from-corpus.mjs` gained `--from-exam` (read chapters under one exam_type, write rows under another) and a `--preset=neet`. `class_level` and the key prefix come from the *source* exam, so these land as `c11_*` and a Class 12 pass can add `c12_*` without collision. Class 11 Mathematics is deliberately excluded — it is JEE's subject.

**Found and fixed a real bug in that script, by checking the count instead of the exit code.** The first run inserted 42 rows, not 43: the dedupe query was scoped to `exam_type` alone, so NEET Chemistry's "Thermodynamics" was skipped as "already present" because NEET Physics had just claimed `c11_thermodynamics`. CBSE Class 10 never exposed this — Mathematics and Science share no chapter names. Dedupe is now scoped to `exam_type + subject`, which is also how `getChapters()` reads, and the missing row was inserted.

Recorded three things in `ACTION_ITEMS_FOR_YOU.md` rather than acting on them: **Class 12 is entirely absent** (NEET is 11+12, so roughly half of each paper will not snap — seeding a static Class 12 chapter list first is recommended); two corpus-vocabulary artifacts that must *not* be renamed in AdminSyllabus without renaming `knowledge_base` too, or the join breaks; and a pre-existing `chapter_key` collision that merges flashcard decks for same-named chapters across subjects, now reachable for the first time.

### Class 12 and pre-rationalisation chapters — 56 more rows, NEET now has 99

The corpus-derived 43 are Class 11 and post-2023 rationalised. The papers being uploaded are **2018 and 2022**, which predate rationalisation, so beyond the missing Class 12 half they also ask about chapters the current NCERT books no longer contain. `scripts/seed-neet-static-chapters.mjs` adds Class 12 current (37), Class 11 legacy (9) and Class 12 legacy (10), owner-reviewed before running.

Deliberately **not** corpus-derived, and deliberately carrying no content: a syllabus row makes a name available to `matchSyllabusChapter()`, it does not create chunks. Retrieval for Class 12 still finds nothing — the win is chapter *attribution*, which is what Blueprint V2 groups on.

Legacy rows are `is_active = true` because `getChapters()` filters on it and intake snaps against that exact list, so an inactive row would be invisible to snapping and the exercise pointless. The visible cost — ~19 empty chapters in the picker — is pushed to the bottom via `sort_order` bands (Class 12 current 100+, Class 11 legacy 900+, Class 12 legacy 950+). Verified after writing: 99 rows, zero duplicate `(subject, chapter_key)`, original 43/43 corpus join intact.

### Option B implemented — four call sites, not five

`match_knowledge_base`'s `filter_exam_type` becomes `text[]` (one changed line, `= ANY()`, copying the `filter_content_type` pattern already in that function), plus `src/lib/examMapping.js` — `examTypesFor()`, dependency-free because `supabase.js` imports it and putting it in `syllabus.js` would close an import cycle. Call sites: `questionGen.js:662` (`.eq` → `.in`), `questionGen.js:727`, `supabase.js:243`.

**The fifth site was a miscount, corrected on inspection.** `fetchVerbatimPassages` (`questionGen.js:769`) returns `[]` unless the subject is English/Hindi/Sanskrit, so it was never on the NEET path and was left alone.

Build passes; 161 tests pass, including 8 new ones covering the widening, exact-match-not-fuzzy behaviour, and that the shared fallback list can't be mutated between calls.

**Migration deliberately NOT applied.** A parameter type change drops the old signature, so the live client's scalar argument would start failing — migration and client deploy must go in the same window. Flagged at the top of `ACTION_ITEMS_FOR_YOU.md` so it can't be applied accidentally on its own. Nothing about the PYQ upload depends on it.

---

## 2026-08-10 (session 20) — `study_notes.unit` cleanup, and the CTM figure-cropping plan audited then corrected

Two items picked up while PYQ sourcing is in flight. Nothing touching generation steering or the NEET/JEE mapping was changed — both stay parked.

### `unit` repeated the chapter title on 81 backfilled notes

`unit` exists to GROUP notes into a table of contents (`NotesBrowser`, `AdminStudyNotes`), so a unit whose only member is a chapter of the same name rendered as an accordion section of exactly one item, repeating its own title twice.

Source of the dirt: `runNotesExtraction` asks for "Unit name if this content is part of a numbered/named unit, else null". A bulk-loaded NCERT PDF **is** one chapter, so the model has nothing else to name and answers with the chapter title; `scripts/backfill-study-notes.mjs` then copied it through verbatim.

**The obvious one-liner was wrong, and measuring first is what caught it.** `UPDATE ... WHERE unit = chapter` would have hit 84 rows, but NCERT genuinely names a unit after its own opening chapter: `Number Play` (CBSE 10 Maths, 3 sibling chapters), `Locomotion and Movement` (CBSE 11 Biology, 1), `Proportional Reasoning` (CBSE 8 Maths, 1). Clearing those evicts the intro chapter from a unit that really exists and orphans it into "Other Notes" while its siblings stay grouped — worse than the cosmetic problem being fixed. `20260810060000_clear_self_referential_note_units.sql` therefore carries a `NOT EXISTS` sibling guard scoped to `exam_type + subject`.

Applied and verified against the before-snapshot: 181 rows unchanged, 179 → 98 with a unit, **81 cleared, the 3 protected rows intact by ID**, 95 genuine-unit rows over 65 distinct names untouched.

Also fixed at source — `dropSelfReferentialUnits()` in the backfill script carries the same guard so the next corpus load can't reintroduce it. Verified over the real 4,363-row corpus: clears the same 81. It preserves 2 of the 3 rather than all 3, which is **not** a disagreement — Class 10's "Number Play" unit exists only in `study_notes`, not in the corpus `knowledge_base`, while Class 8's same-named chapter genuinely has no siblings and should be cleared. Both paths clear the identical 81 rows.

### Geometric figure cropping — audited, the documented plan disproved, then parked

Session 17 recorded the follow-up as "derive figure rectangles by tracking the CTM through `paintImageXObject`" (in `CHANGELOG` and as a comment in `pdfVision.js`). Audited against the real corpus before writing any code, and **that plan finds nothing.**

Every NCERT page paints exactly two rasters, neither of them a figure: a full-bleed page background at `{x:-0.012 y:-0.05 w:1.024 h:1.1}` and the diagonal "© NCERT not to be republished" watermark at `{x:0.096 y:0.246 w:0.782 h:0.594}`. Both repeat to four decimal places on every page — which is also the cheap way to recognise furniture. The real figures are **vector line art**, invisible to every `paintImage*` op.

The workable source is `constructPath`, whose pdfjs-6 args are `[opsFlags, coords, minMax]` — a free per-path bounding box in user space that the CTM maps to an exact page rect. A scratch prototype on real Class 11 Physics ch. 4 produced **tight, correct crops of Fig 4.3 and Fig 4.5**, against the model bboxes' 0-for-5, with one characterisable false positive (stacked display equations).

The pitfall worth recording: naive proximity clustering merged the **entire page into one cluster**, because a fraction bar, a callout border and a table rule each sit within the merge gap of the next thing, so the union walks the whole column. Pre-filtering those bridging paths *before* merging is the whole trick. Scans degrade correctly to a single whole-page rect, so there is no regression risk there.

**Verified by rendering pages in a real browser and drawing the derived rects over them** — the same discipline that caught the model-bbox failure in session 17, and the reason the premise got corrected instead of implemented.

Parked behind launch, not started. Full findings and the staged plan are in `docs/ACTION_ITEMS_FOR_YOU.md`; the stale comment in `pdfVision.js` was corrected to point there rather than keep asserting a disproved plan as fact.

---

## 2026-08-10 (session 19) — §3 pattern stats and §4b paper scoring, narrowed to what the data supports

### §3 — `chapter_pattern_stats`, deliberately two axes short of its original scope

A **view**, not a materialised table: `pyq_questions` is 87 rows and a stale blueprint is worse than a marginally slower query. Nothing to refresh, nothing to drift.

§3 was scoped as *chapter / year / difficulty / type*. Two of those four carry no information in the data that exists, so they are **absent rather than present-and-useless** — aggregating a constant column produces something that looks like data and is not:

- **`year`** — every loaded question is 2025. Year-over-year trend needs 3–5 years per subject, which is more papers, not more SQL.
- **`difficulty`** — `pyq_questions.difficulty` is hardcoded `'Medium'` by `savePYQRows`, and `runPYQExtraction` never asks the model for it. **Difficulty is derived from marks instead** (≥5 hard, 3–4 medium, ≤2 easy), which is the better signal anyway: marks are set by the exam board rather than guessed, and a 5-mark Long Answer really is harder than a 1-mark MCQ.

What it does aggregate, per chapter: `question_count`, `total_marks`, `avg_marks`, `pct_of_questions`, `pct_of_marks`, and jsonb breakdowns by question type, marks, section and derived difficulty. 27 chapters across the two loaded subjects.

`technique_frequency` is **not** built. `pyq_questions` has no techniques column, and `knowledge_base`'s equivalent holds 1,189 distinct free-text values across 2,095 rows — that needs a controlled vocabulary before aggregation means anything.

### No data is not zero

Only 2 of 11 exam+subject combinations have any PYQs. `getChapterPatternStats()` always returns the same shape with an explicit `hasData` flag and a human-readable reason, and callers must branch on that rather than on `chapters.length` — which is 0 both when there is genuinely no data and when a query fails. Verified live across seven combinations: the two with papers return real stats, and CBSE Class 11 Physics/Biology, Class 9 Science, Class 8 Mathematics and NEET Physics all return *"No past-year questions have been uploaded for … yet"* rather than an empty table a UI would happily render as a red 0%.

### §4b — scoring generated papers on chapter, type and marks

`generateQuestionPaper` now returns `pattern_match` alongside the existing `blueprint_match_pct`. The difference matters: `blueprint_match_pct` only exists when the 20-PYQ allocation threshold fired and only scores **chapter**. `pattern_match` works off whatever measured data exists and scores **chapter, question type and marks** separately, plus derived difficulty.

Scoring reuses the total-variation formula already behind `blueprint_match_pct` (100 − half the summed absolute percentage difference), so the new per-dimension numbers are directly comparable to the one already displayed. Difficulty is reported but **excluded from the headline average** — it is derived from marks, so folding it in would count the same signal twice.

Sanity-checked against a deliberately lopsided paper (10 questions, all MCQ, all 1 mark, all one chapter): Class 10 Mathematics scores overall 43 (chapter 18, type 53, marks 59) and Science 30 (chapter 15, type 28, marks 47). A bad paper scores badly, which is the point.

Scoring is wrapped so a failure logs and returns undefined rather than losing a generated paper — it is reporting, not a gate.

One bug caught by its own test: `difficultyFromMarks(null)` returned `'easy'`, because `Number(null)` is 0. A question with no marks was being labelled the easiest possible rather than unknown.

---

## 2026-08-10 (session 18) — Step 4: real PYQs loaded, chapter attribution fixed

Two real CBSE Class 10 board papers (2025 Mathematics Standard and Science) are in `pyq_questions`. **Blueprint V2's 20-question threshold now passes for both subjects** — the first time it has been reachable for any exam+subject.

### Seeding the syllabus first was the load-bearing step

Content Intake runs every extracted question's chapter through `matchSyllabusChapter()`, and Blueprint V2 then groups by the **exact** chapter string. With `syllabus_nodes` nearly empty there was nothing to snap onto, so a paper's questions would scatter across spelling variants — the threshold gets crossed and the allocation is still junk, silently, because each variant looks like its own low-frequency chapter.

`scripts/seed-syllabus-from-corpus.mjs` lifted clean chapter titles out of `knowledge_base` (they were read off the actual NCERT books during the corpus load) into `syllabus_nodes`: 15 → 42 rows, adding 14 Class 10 Mathematics and 13 Class 10 Science. Sorting by source file then first page produced exact textbook order.

### First upload measured 86–87% snapping — the misses were two different problems

| | Mathematics | Science |
|---|---|---|
| questions | 39 | 44 |
| snapped to syllabus | 87% | 86% |

**Near-misses** the matcher should have caught: `Human Eye and Colourful World` against the real `The Human Eye and the Colourful World` — exact-then-substring matching fails because an interior "the" defeats containment. **Invented chapters** no matcher can rescue: `Chemical Bonding`, `Exponents and Powers`, `Simple Interest` — names that don't exist at Class 10.

### Fixed by constraining the model, not by cleaning up after it

`runPYQExtraction` now receives the syllabus and requires each question's chapter to be **copied exactly from a closed list**. That turns fuzzy string matching into multiple choice. `matchSyllabusChapter` also moved into `contentExtraction.js` (so intake and any headless loader snap identically rather than drifting from a copy) and gained a token-overlap backstop using common-prefix matching — `trigonometric` and `trigonometry` agree for 11 characters and then diverge, so neither is a prefix of the other and stemming alone can't unite them.

The backstop deliberately **declines** `Human Reproduction` → `How do Organisms Reproduce?` (0.20), because that scores below `Chemical Bonding` → `Chemical Reactions and Equations` (0.25), which would be a genuinely wrong snap. No purely lexical rule separates them, and a wrong snap is worse than none — it silently attributes a question to a chapter it doesn't test.

### Re-run result

| | Mathematics | Science |
|---|---|---|
| questions | 39 → 34 | 44 → 53 |
| distinct chapters matched | 11/16 → **14/14** | 11/15 → **13/13** |
| snap rate | 87% → **100%** | 86% → **100%** |

**0 of 87 questions landed outside the syllabus**, against 11 of 83 before. Distributions also look more like real papers: `Some Applications of Trigonometry` 0 → 4 and `Quadratic Equations` 0 → 1, with the inflated `Introduction to Trigonometry` dropping 10 → 2 as its applications questions were attributed correctly.

**Confound, stated plainly:** this is not a clean A/B. The PDFs were identical but the *extracted text* was not — the re-run harness called `extractPagesWithVision` with `extractFigures: false` while Content Intake passes figures on, so vision triggered differently and the question counts moved (−5, +9) when a prompt-only change should have left them alone. A deliberate choice was made not to burn another upload cycle isolating this: the mechanism proof stands on its own, since the model can only emit names from the list. What is *not* isolated is how much of the distribution improvement came from the constraint versus the different text.

### Also this session

`runPYQExtraction`'s `max_tokens` dropped 16000 → 5000 with batches at 12,000 chars, sized from measurement (30 real questions serialised into this extractor's schema: median 354 chars, ~90 tokens each, so a 38-question paper is ~3,500 output tokens, not 16,000). Per-call reservation fell from ~20,000 to ~8,600 against a 30,000 TPM ceiling. A `finish_reason === 'length'` guard was added — truncation here silently drops questions off the end of a paper while the upload still reports success.

---

## 2026-08-10 (session 17) — generated answer keys: measured, then partly fixed

Tracing the verification path for generated questions found there isn't one. A repo-wide search for `verifyAnswer`, `validateQuestion`, `answer_verified`, `solution_check` and any `verify*`/`validate*` in `questionGen.js` returns nothing. The only gate is structural (`toEngineFormat`): does the question have text, does an MCQ have ≥2 options. **Nothing looked at the answer key at all**, and `Numerical` questions were waved through unconditionally.

Exposure is very uneven. The student path (`PracticeGeneratorPage.jsx`) runs `generateQuestionPaper() → toEngineFormat() → live quiz` with no review of any kind — and because that quiz awards XP and writes `weak_topics` accuracy, a wrong key marks a correct student wrong *and* corrupts their diagnostics. The admin path renders questions for a human before Publish, but nothing requires or records that review. `CONTENT_REVIEW_QUEUE` does not cover either — it gates Content Intake and `extractPYQFromKB` only.

### Measured before fixing

30 questions through the real pipeline (Class 10 Maths ×15, Class 11 Physics ×15), every answer hand-checked: **10% hard-wrong keys, 10% flawed questions, 80% clean.** The three wrong keys were three different failure modes — a value not present among the options at all, an option set where nothing satisfied the question, and one where the explanation correctly computed 28 while the key pointed at 30.

Separately, **answer positions were badly skewed: A 50%, B 37%, C 7%, D 7%** — Class 10 Maths produced not one C or D in 15 questions. Always guessing "A" scored ~50%.

### Fixed

- **Option shuffling.** Fisher-Yates over options with the key index remapped, guarded by `hasOrderedOptions()` — Assertion-Reason ladders and anything containing "all/none/both of the above" or "Both A and C" keep their order, because shuffling an option that references other options by letter is a worse bug than the skew it fixes.
- **Unparseable keys now fail loudly.** `correctOption` was `LETTER_IDX[...] ?? 0`, so a missing or malformed answer silently became a confidently-scored "A". It now resolves to `null` and the question is dropped with a warning.
- **Key-vs-explanation cross-check**, as a soft flag rather than a drop: a numeric keyed option sharing *no* value with its own explanation sets `needs_review`. The student path filters those out; admin Paper Gen still renders them, flagged, for a human.

### Re-measured — one fix works, one doesn't

| | before | after |
|---|---|---|
| answer position A/B/C/D | 50 / 37 / 7 / 7 | **33 / 30 / 20 / 17** |
| hard-wrong keys | 3/30 (10%) | 4/30 — 1 caught and withheld → **3/28 (11%) served** |
| flagged | — | 2/30: 1 true positive, 1 false positive |

**Shuffling is a decisive win.** The cross-check is not: it caught a genuinely wrong key (flywheel at 1200 rpm keyed `20π` against an explanation correctly deriving `40π`) and withheld one sound question (a 45° triangle whose explanation happened to mention only 180 and 90).

It cannot catch the dominant failure mode, where the explanation agrees with the wrong key — "10th term of AP 2, 5, 8" keyed `31` with an explanation stating `2 + 9 × 3 = 31`, which is simply false arithmetic. An earlier claim in this session that the cross-check would catch all three measured failures was wrong; it only catches the class where key and explanation disagree. The wrong-key rate is statistically unchanged.

Closing that gap needs semantic verification, not logic. Tracked, with both the before and after numbers, in `docs/ACTION_ITEMS_FOR_YOU.md` (created this session — the CHANGELOG had referenced it for weeks without it existing).

**Numericals remain unmeasured.** Both benchmark runs produced MCQ and Assertion-Reason only, so the category with no structural filter whatsoever still has no measured error rate.

---

## 2026-08-10 (session 16) — Phase 2 groundwork: provenance, taxonomy, type-filtered retrieval

Three changes off the back of the Phase 2 audit. §3 (`chapter_pattern_stats`, `technique_frequency`) and §4b (exam-pattern blueprint scoring) are deliberately **not** built: `pyq_questions` is empty — not thin, zero rows — so both would ship as an empty table plus UI that renders nothing. Blueprint V2's 20-PYQ threshold is currently unreachable for all 11 exam+subject combinations.

### 1. `topic_frequency` was presenting a guess as exam data

`analyzeTopicDistribution()` asks `gpt-4o-mini` to *"estimate relative frequency (1-10)"* from ~20 `knowledge_base` excerpts, then stored the result in a column called `frequency` with nothing to mark it. It reached students as:

```
PYQ frequency: 8/10 — this is a very high priority chapter.
```

No PYQ was ever involved, and with `pyq_questions` empty none *could* be — the estimator is the only path that has ever written to that table. Students were being told which chapters to prioritise for an exam on the strength of an LLM's impression of a textbook. The full corpus load made this worse rather than better: the estimator now has 4,363 real chunks to guess from, so the output looks more credible.

Added `topic_frequency.source` (`measured` | `estimated`, CHECK-constrained, defaulting to `estimated` so any write path that doesn't know about the column is labelled the safe way). Only `source === 'measured'` gets the confident wording; everything else — including rows predating the column — degrades to an explicit "this is an ESTIMATE… NOT measured from past-year papers… do NOT call it a PYQ statistic".

### 2. `content_type` gained `exercise`, `activity`, `summary` — and 417 rows were re-classified

79.8% of the corpus landed in `prose`. Two measurements on how much of that was real: a manual read of 48 stratified chunks put correct-`prose` at ~65%, and a heading-anchored scan of all 3,488 put the mis-bucketed floor at 14.7%. The scan is a floor because it only matches explicit headings — it can't catch "Ionization Enthalpy **is the energy required to**…" (a definition) or "Power of i — i²=−1, i³=−i…" (a formula).

The bigger finding was a **taxonomy gap, not just classifier error**: NCERT spends real page area on unsolved exercise sets, practical activities and end-of-chapter summaries, and the original eight types had nowhere to put any of them. Re-classifying into the old taxonomy would have reshuffled definitions and left the rest stuck in `prose`, so the types came first.

A `gpt-4o-mini` pass over the ~500 flagged rows (not all 3,488 — cost) re-classified **417 rows, 0 failures**, using stored chunk text with no re-extraction:

| | before | after |
|---|---:|---:|
| prose | 3,488 (79.7%) | **3,071 (70.2%)** |
| exercise | — | **186** |
| definition | 114 | **176** |
| summary | — | **92** |
| activity | — | **65** |

**94 of 511 candidates were correctly kept as `prose`** — the model pushed back on ~18% of what the scan flagged, which is the number that says it wasn't just relabelling whatever it was shown.

The 186 `exercise` chunks matter beyond tidiness: with `pyq_questions` empty these are the only real, chapter-attributed questions in the system. Not past-year papers, but the closest thing available. The extraction prompt carries the new types too, so future uploads classify correctly at intake rather than needing another backfill.

### 3. §4a: generation now retrieves by content type

`match_knowledge_base` has accepted `filter_content_type`, `filter_difficulty` and `filter_techniques` since the multimodal migration, and **no caller had ever passed any of them**. Worse, question generation didn't use the RPC at all — it read `knowledge_base` with an unfiltered `.limit(12)`, so with 4,363 rows loaded it seeded itself with twelve arbitrary paragraphs, ~70% of them `prose` by base rate.

New `fetchChunksPreferringTypes()` prefers the types a question can actually be built from, and **is guaranteed to return at least as many rows as the unfiltered read it replaced**. The fallback is arithmetic rather than a tuned threshold: a short typed read is topped up from a fully unfiltered read, deduped by id. The top-up is unfiltered (not "everything except the preferred types") specifically so that a typed read which errors to `null` still yields the complete old result set.

Verified against thin subjects, where it matters — Class 8 Science / "How Nature Works in Harmony" has **zero** typed chunks and returns 30 rows, identical to the old behaviour.

| seed | before | after |
|---|---|---|
| Class 11 Physics | prose 8, law 3, solved_example 1 | solved_example 6, derivation 3, exercise 2, formula 1 |
| Class 11 Biotech | prose 12 | exercise 7, definition 2, law 2, formula 1 |

Same prompt, both seeds, Class 11 Physics: before produced "What is the significance of the gravitational force…" plus a numerical with invented values; after produced the real NCERT problems (work done for `v = a·x^(3/2)`, copper block on ice, significant figures for a 7.203 m cube).

**This changes which questions get asked, not whether their answers are right.** In that 3-question sample one answer was wrong (20 J stated, 50 J correct). Answer correctness lives in the generation/verification layer and is untouched here.

---

## 2026-08-10 (session 15) — full corpus load: 148 files, and the four bugs it took to get there

Loaded the whole local NCERT STEM corpus into `knowledge_base` (option D — STEM only, figures off, concurrency 1) and backfilled `study_notes` from it. **148/148 files, 4,458 chunks, 0 outstanding failures.** Getting there surfaced four separate defects, three of them mine from session 14.

### The TPM ceiling — a reasoning error, corrected

Session 14 claimed the smaller notes batch kept reserved tokens under the org's 30,000 TPM ceiling. Per call that was true; in aggregate it was backwards. OpenAI charges `max_tokens` as **reserved**, not consumed, so the real unit is tokens per *minute*:

```
input ~3,200 + max_tokens 6,000  =  ~9,200 reserved/call  ->  ~3.3 calls/min
```

A 74.6k-char Physics chapter needs ~10 calls, so one file alone wanted ~92,000 reserved tokens — three minutes of the entire org budget, with zero headroom for the file after it. Files 1–52 (short Biology and Class 10 Science chapters) stayed under; Chemistry, Maths and Physics did not. `keph104` and `keph107` failed with `Limit 30000, Used 30000`.

Fixed by sizing `max_tokens` from measured output instead of padding: **6,000 → 3,000**, now a documented `NOTES_MAX_TOKENS` constant. A batch yields 5–8 chunks and the largest chunk ever measured was 1,092 characters, so real output lands near 2,000–2,500 tokens — 6,000 was reserved on every call and thrown away. That lifts sustainable throughput to ~4.8 calls/min.

**Verified no quality cost**, on the same file under both settings (`keph104`, "Laws of Motion"):

| | max_tokens 6000 | max_tokens 3000 |
|---|---|---|
| chunks | 51 | 50 |
| median chunk | 630 chars | 650 |
| retention | 32,721 chars | 34,383 |

Across the full corpus, the 71 files loaded at 3,000 have a *higher* median (607 vs 600) and a *lower* rate of chunks ending mid-sentence (0.2% vs 0.3%) than the 77 loaded at 6,000. Added a `finish_reason === 'length'` guard that throws a named error rather than letting a truncated response fail as an opaque `JSON.parse` offset — it never fired across ~700 calls.

Backoff alone could not have fixed this. A 429 anywhere in a file throws out the **whole file**, and the retry restarts from batch 1 — so a file needing more calls than one minute's budget allows re-saturates at the same point forever. `keph107` burned all six attempts (380s) three separate times before the ceiling was raised.

**Still open:** `runPYQExtraction` reserves `max_tokens: 16000` — over half the org's entire per-minute budget in one call. Same hazard, latent on the question-paper path, untouched here.

### `knowledge_base` insert: one statement was too wide

`adminSaveKnowledgeChunks` inserted every chunk in a single `INSERT`. A dense chapter builds 50+ rows each carrying a 1,536-float embedding, which hit Postgres's `statement_timeout` and was cancelled outright — `keph104` lost a full extraction pass at the write step, after all the AI cost was already paid. Now inserted in batches of 20, matching `_addEmbeddings` directly above it.

Batching costs the all-or-nothing guarantee a single statement gave for free, so a failed batch now **rolls back the rows this call already wrote** before throwing; without that, the loader's retry (it only checkpoints successes) would duplicate them. If the cleanup itself fails the error says so explicitly. This also fixes the same latent bug on the admin Content Intake path, where a long chapter would have failed identically.

### Loader hardening — three ways a run died silently

`scripts/bulk-load-corpus.mjs` only. All three shared one failure signature: the run kept going and reported every remaining file as a genuine failure.

1. **Chromium OOM.** All 148 files ran through one long-lived page, each loading a whole PDF as an ArrayBuffer into the same renderer. It crashed around file 6–7 every time, and the loop then ran the rest of the queue against the corpse — 20 files "failed" in milliseconds. Added crash detection, one honest retry on a rebuilt page, and proactive context recycling (`--recycle`, default 8). The first attempt at this was insufficient: the crash takes the **whole browser process**, not just the tab, so reviving also relaunches Chromium on `!browser.isConnected()`.
2. **Dead dev server.** Port 5173 died mid-run, producing an identical-looking cascade with a completely different cause (`Failed to fetch dynamically imported module`) that cost another 10 files. Added a preflight fetch of `/src/lib/pdfVision.js` that refuses to start rather than emit a queue-length list of misleading failures.
3. **Background runs terminated.** Two long runs ended with no error, no exit code, no crash trace. Cause never established; worked around by running in bounded foreground slices. The per-file checkpoint made every interruption cost at most one file.

### `study_notes` backfill

The bulk loader writes `knowledge_base` only — `admin_upsert_study_note` checks `p_caller` against `admins`, and a headless script has no admin identity. But Content Intake writes **both** tables deliberately (`saveNoteChunks`), so bulk-loaded chapters were invisible to Admin > Study Notes, Content Map, the student `NotesBrowser`, and `getStudyChapters()`'s chapter picker. Confirmed live: 345 Class 10 Science chunks in `knowledge_base`, zero Class 10 Science rows in `study_notes` — which is why the Study Notes subject chips showed All/Mathematics/English and no Science.

New `scripts/backfill-study-notes.mjs` groups existing `knowledge_base` rows by (exam_type, subject, chapter) and creates the missing note per chapter. **No re-extraction and no API cost** — every field already exists as a column, and `embedding` is excluded from the read. The body is reconstructed to be byte-shaped like an intake-written note: `buildKbRows` stores `heading\n\ncontent`, so splitting on the first blank line recovers both halves and re-emits `**heading**\ncontent`.

It only ever adds: a skip-set of existing (exam_type, subject, chapter) keys is built before any write, every call passes `p_id: null`, and re-running writes nothing. **29 rows before → 191 after (+162), 0 failed**, with the 29 pre-existing rows untouched.

**Known limitation, documented in the script:** chunk order within a chapter is not reconstructable. `knowledge_base` has no chunk-index column and `created_at` is transaction time — all 35 chunks of "Life Processes" share one identical timestamp. The backfill reads with no `ORDER BY`, which returns physical (= insertion) order for an insert-only table. Best-effort, not guaranteed.

### Cleanup: front matter and split artifacts removed from both tables

Making the corpus visible in the notes library also made its junk visible. Ten "chapters" were not chapters, and they fell into two groups that look alike in a list and are not the same problem at all. Telling them apart needed the sibling chapters from each one's **source file**, not the title:

**Front matter (5 notes, 87 chunks).** Four files produced nothing but front matter, so nothing real was attached to them: `CURIOSITY INTEX.pdf` → "Foreword and Introduction" + "The Constitution of India"; `LEARNING MATERIAL SHEETS & INDEX.pdf` → "Foreword"; `Ganithaprakash part 1 INDEX.pdf` and `GANITA MANJARI.pdf` → "Foreword and Introduction". The NCERT short-code filter in the loader (`isFrontMatter`) couldn't catch these because they don't use short codes — the rule only works on `jesc1an`-style names.

**Split artifacts (5 notes, 8 chunks).** Not front matter at all — the session 14 chapter-splitting failure surviving in miniature. Each is a tiny sibling of a dominant chapter from the *same* file: "Game of Hex" (1 chunk) beside "The Balancing Act" (31), "Peaceful Knights" (1) beside "Fractions as Percentages" (37), "Cell Signaling" (2) beside "Metabolic Pathways" (22) and "Cell Cycle" (18).

Deleted from `study_notes` first (**191 → 181**), then the corresponding chunks from `knowledge_base` (**4,472 → 4,377**, 95 rows). Removing the note alone would have left the chunks retrievable by the doubt-tutor — a student could still have been served "Foreword" as Class 8 Maths.

**The filter was chapter identity + source file, never source file alone.** Three of the artifact files also contain legitimate chapters, so a file-wide delete would have destroyed a 31-chunk chapter to remove a 1-chunk artifact. Verified after the fact: all ten deleted chapter names return 0 rows, the six legitimate siblings are intact at their exact original counts, and 144 of 148 corpus files still have chunks (the missing four being the all-front-matter ones).

---

## 2026-08-10 (session 14) — study-note chunking: coverage, chapter splitting, text-layer equations

Preparing the full 148-file NCERT bulk load surfaced three defects in `runNotesExtraction`, all of which would have been baked into every row the load wrote.

**1. One call per chapter meant the model summarised instead of transcribing.** A 22-page chapter went in as a single 30,000-char batch and came back as ~14 chunks averaging ~170 characters — an outline, not the book. This is an output-length prior, not an instruction-following failure: telling the model harder to write more moved the median only 169 → 284 chars. Fixed by shrinking `NOTES_BATCH_CHARS` to 8,000 (~6 pages), where "about one chunk per page" is a request the model will actually satisfy. Coverage now comes from batching, not from nagging.

> **Correction (session 15).** This entry originally claimed the smaller batch also drops each call's reserved tokens "well under the 30,000 TPM ceiling." That was true per call and wrong in effect, and it is the reasoning error that cost two files mid-load. Shrinking the batch multiplied *calls per file* roughly fourfold, so tokens reserved per *minute* went up, not down. See session 15 for the measurement and the fix.

**2. Chapters were being split into sections.** The prompt said "return a single lesson if it's really one chapter" but never defined a lesson, so one Class 8 Maths chapter came back as three: "A Square and A Cube", "Understanding Perfect Squares", "Cubes and Cube Roots" — the last two are sections of the first. That corrupts chapter-level analytics downstream, and batching made it worse, since a batch starting mid-chapter had no idea what it was in the middle of. Two fixes: the prompt now defines a lesson as a whole Contents-page chapter with a worked wrong/right example and pushes section headings into the chunk `heading` field, and each batch after the first is told which lesson titles earlier batches already produced so a continuation reuses the exact title instead of coining its own.

**3. Merging a multi-batch lesson dropped its figures and equations.** The merge widened `page_start`/`page_end` but not `marker_start`/`marker_end`. `buildKbRows` filters figures and equations by that marker range, so a chapter assembled from four batches kept only the first batch's markers and silently discarded everything past its opening pages. Markers now widen with the pages.

**Also added: text-layer equation harvesting.** Equations previously came only from vision, which fires only on pages that trip the thin-text or raster-image gate — so on a cleanly typeset chapter, where vision never runs, every equation in the book was lost. Chunks now carry a `latex[]` field harvested from the text they were built from (`chunkLatex()`), and `buildKbRows` unions it with the vision set, chunk-level first since it is the better-attributed of the two.

### Verified on two files, different subjects and structures

Dry runs (extraction + row-building, no DB writes), each a 22-page chapter:

| | Class 8 Maths — *A Square and A Cube* | Class 11 Physics — *Laws of Motion* |
|---|---|---|
| lessons returned | 1 (was 3) | 1 |
| chunks | 24 (was ~14) | 51 |
| median chunk | 526 chars (was 169) | 630 chars |
| in the 600–1800 band | 4 / 24 | 27 / 51 |
| stored vs source chars | 12.6k / 31.3k | 32.7k / 74.6k |
| distinct LaTeX | 76 (was 0) | 80 |
| `content_type` spread | prose 23, definition 1 | prose 30, solved_example 16, law 3, derivation 1, definition 1 |

The fix generalises: the Physics chapter, which is denser and more heavily mathematical, came back as one lesson with correct printed page numbers (51–70) and markers spanning the whole file, and its classification spread is genuinely varied rather than collapsing to `prose`. Chunks still run shorter than the 100–300 word target more often than not — accepted at this quality level for now rather than shrinking batches further.

**Known caveat, unchanged by this work:** vision-harvested equations are unioned in at *lesson* granularity, so when vision does run every chunk in that lesson inherits the whole set — which is why all 51 Physics chunks report `has_equations`. It barely affects the bulk load, where figures are off and vision fires on only ~3% of pages, leaving `latex` almost entirely chunk-attributed.

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
