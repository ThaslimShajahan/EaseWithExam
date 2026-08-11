/**
 * Finds components that reference a value from useAuth() without bringing it
 * into scope — the bug behind "Launch failed: currentUser is not defined".
 *
 *   node scripts/scan-auth-scope.mjs [path]      # default: src
 *
 * PYQBankSection in ExamCenterPage.jsx destructured only { userProfile } while
 * handleLaunch used currentUser, so every "Start PYQ Practice" click threw a
 * ReferenceError before the paper was created. Sibling components in the same
 * file each had their own correct destructure, which is what made it invisible
 * on a read-through.
 *
 * Vite does not catch this — it is a runtime ReferenceError, not a build error
 * — and the project has no ESLint, so `no-undef` never ran.
 *
 * NOTE ON String.raw: the first version of this script wrote the word-boundary
 * regex as `\b${v}\b` inside a template literal, where \b is the BACKSPACE
 * character rather than a regex word boundary. The pattern matched nothing, so
 * the scan reported a clean result on provably broken code. String.raw keeps
 * the backslash literal. Verified by running it against the pre-fix file, where
 * it must report the ExamCenterPage hit.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.argv[2] ?? 'src';

const AUTH_VALUES = [
  'currentUser', 'userProfile', 'isPremium', 'subscription',
  'refreshSubscription', 'signOut', 'retryProfile', 'profileError',
];

const word = (v) => new RegExp(String.raw`\b${v}\b`);

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (!/node_modules|__tests__/.test(p)) walk(p);
    } else if (/\.jsx?$/.test(p)) files.push(p);
  }
})(ROOT);

const hits = [];

for (const file of files) {
  const src = readFileSync(file, 'utf8');

  // Top-level function declarations only. Components in this codebase are all
  // declared at column 0, and each one is its own scope.
  const marks = [...src.matchAll(/^(?:export default )?function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/gm)];

  for (let i = 0; i < marks.length; i++) {
    const name   = marks[i][1];
    const params = marks[i][2];
    const body   = src.slice(marks[i].index, i + 1 < marks.length ? marks[i + 1].index : src.length);

    // Only components that actually call useAuth() are in scope for this check.
    // Without this the scan drowns in false positives: `subscription` is also a
    // local push-subscription object in lib/notifications.js, and appears as
    // plain prose in PrivacyPolicyPage. 17 hits, none of them real.
    if (!/useAuth\(\)/.test(body)) continue;

    const destructured = [...body.matchAll(/const\s*\{([^}]*)\}\s*=\s*useAuth\(\)/g)]
      .flatMap((m) => m[1].split(',').map((s) => s.trim().split(':')[0].trim()));

    // Strip the destructure itself (it names the values without using them),
    // plus comments and import paths. Without the comment strip, a line like
    // "// flip isPremium immediately" counts as a use — that alone produced
    // three of the four remaining false positives.
    const usageArea = body
      .replace(/const\s*\{[^}]*\}\s*=\s*useAuth\(\)/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/from\s+['"][^'"]*['"]/g, '');

    for (const v of AUTH_VALUES) {
      if (!word(v).test(usageArea)) continue;        // not used here
      if (destructured.includes(v)) continue;        // properly destructured
      if (word(v).test(params)) continue;            // arrives as a prop
      // Local binding, including array destructuring like
      // `const [currentUser, setCurrentUser] = useState(...)` in AdminGuard,
      // which a `const <name>` pattern alone would miss.
      if (new RegExp(String.raw`(const|let|var)\s+${v}\b`).test(body)) continue;
      if (new RegExp(String.raw`(const|let|var)\s*\[[^\]]*\b${v}\b`).test(body)) continue;
      hits.push(`${file}  ${name}()  uses "${v}" without bringing it into scope`);
    }
  }
}

hits.forEach((h) => console.log(`  ${h}`));
console.log(hits.length ? `\nFAIL — ${hits.length} out-of-scope auth reference(s).` : '\nPASS — no out-of-scope auth references.');
process.exit(hits.length ? 1 : 0);
