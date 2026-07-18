# Changelog

Running log of changes made to this project, newest first. One file, appended to — see `docs/ACTION_ITEMS_FOR_YOU.md` for the standing list of things blocked on the project owner, and the two 2026-07-15 review docs for the original audit/architecture findings this work traces back to.

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
