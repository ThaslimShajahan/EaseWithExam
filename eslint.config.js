/**
 * Minimal lint config with ONE job: catch undefined identifiers before runtime.
 *
 * Added 2026-08-14 after three crashes in a single night, all the same class —
 * an identifier referenced but never declared, which no test, no type checker
 * and no `vite build` caught, because a bundler happily emits code that throws:
 *
 *   1. AdminContentLibrary.jsx  `examTagFilter`        — crashed every KB render
 *   2. ExamCenterPage.jsx:219   `EXAM_QTYPES`          — crashed the exam screen
 *   3. AdminContentIntake.jsx   `adminSelectedOrdinal` — crashed the first real
 *                                                        Study Notes upload
 *
 * Deliberately NOT a style config. No formatting rules, no React plugin, no
 * opinionated preset — those generate hundreds of findings on an existing
 * codebase and get ignored, which is how a lint step stops catching the one
 * thing it was added for. Rules are added here only when a real bug proves the
 * need, the same way this one did.
 */
import globals from 'globals';

/* The codebase carries 11 `// eslint-disable-next-line react-hooks/exhaustive-deps`
 * comments from a previous lint setup. ESLint errors on a disable directive that
 * names a rule it cannot resolve, so those 11 comments would fail the lint run
 * for a rule we are not even enabling.
 *
 * Stubbed as a no-op rather than solved by installing eslint-plugin-react-hooks:
 * pulling in the real plugin would switch on exhaustive-deps findings across the
 * whole app, which is a separate piece of work with its own judgement calls, and
 * bundling it into "catch undefined identifiers" is how this config would end up
 * too noisy to keep. The comments stay valid and inert; if the hooks rules are
 * ever genuinely wanted, replace this stub with the real plugin deliberately. */
const noop = { create: () => ({}) };
const reactHooksStub = { rules: { 'exhaustive-deps': noop, 'rules-of-hooks': noop } };

export default [
  {
    files: ['src/**/*.{js,jsx}', 'scripts/**/*.{js,mjs}'],
    plugins: { 'react-hooks': reactHooksStub },
    // Those same 11 directives are "unused" as far as this config is concerned,
    // which is noise, not a finding.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        // espree parses JSX natively with this flag — no Babel parser needed.
        // Note this checks identifiers inside JSX *expressions* (`{FOO[x]}`,
        // which is exactly how the EXAM_QTYPES crash appeared); bare component
        // names in `<Foo />` position are not resolved without a React plugin,
        // and that is an accepted gap rather than a reason to add one.
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,   // window, document, fetch, localStorage, URL, …
        ...globals.node,      // process, console, Buffer — the scripts/ loaders
        ...globals.vitest,    // describe, it, expect, vi
      },
    },
    // `no-undef` only. Everything else is off by virtue of not being listed:
    // flat config applies no rules unless asked.
    rules: {
      'no-undef': 'error',
    },
  },
];
