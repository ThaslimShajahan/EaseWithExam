All six slots are filled with real screenshots of the running app, captured
against a seeded demo account and then cropped/composited. Nothing here is
mocked-up UI. To refresh them after a design change, see "Regenerating" below.

Replacing a file by hand also works — drop a real image in with the matching
name and it appears automatically (see ImgOrPlaceholder in
src/pages/LandingPage.jsx). A missing file degrades to a styled placeholder
rather than a broken image.

  hero-collage.png    Hero, right side. Dashboard plate with the analytics
                      score trend and the onboarding card layered in front,
                      on a TRANSPARENT background so it sits on the white
                      page without a visible box. 4:3.

  showcase.png        "Study like the exam is the point", left panel. The
                      dashboard on a #f8fafc ground that matches the slate
                      panel behind it. Rendered object-cover in a roughly
                      square box, so keep this near-square — a wide image
                      loses half its width to the centre crop.

  feature-tutor.png   Lead card of the feature grid — the Ask EWE chat.
                      Wide and short; renders at max 160px tall.

  step-1.png          "Up and running in three steps".
  step-2.png            1 — the sign-in card (phone OTP + Google)
  step-3.png            2 — the onboarding board/syllabus picker
                        3 — the practice-question generator

Sizing: nothing renders larger than about 600px. Keep each file under ~300KB.

Regenerating
------------
Two scripts at the repo root, both gitignored and dev-only:

  1. npm run dev                     (note the port it picks)
  2. node .qa-shot.mjs               captures raw screens via Playwright,
                                     driven by the TARGETS env var
  3. node .qa-assets.mjs             crops and composites them into this folder

.qa-shot.mjs signs in through the DEV-only ?qa_uid= bypass in AuthContext.jsx.
The demo account it used ('ewe-demo') was deleted after capture, so re-seed a
throwaway user first if you need populated dashboard/analytics screens.
