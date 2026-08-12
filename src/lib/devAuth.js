/**
 * Browser-side sign-in helper for the bulk-load scripts. NOT imported by any
 * application module — the only consumers are scripts/bulk-load-*.mjs, which
 * reach it through the Vite dev server inside a Playwright page.
 *
 * WHY IT EXISTS
 * The loaders drive the real app modules in a headless browser, but never
 * authenticated: they wrote to pyq_questions directly, which worked only
 * because the table carried an `ALL {public}` RLS policy. Once writes moved
 * behind admin_insert_pyq_rows (20260812020000), an unauthenticated page fails
 * on assert_verified_admin — and cannot be fixed by passing a uid, because that
 * function requires verified_uid() to MATCH the uid, and verified_uid() reads
 * the Firebase JWT that an unauthenticated page does not have.
 *
 * So the page needs a genuine Firebase session. `signInWithCustomToken` is not
 * reachable from page.evaluate() — a bare 'firebase/auth' specifier does not
 * resolve in the browser, and page.evaluate code is not processed by Vite. This
 * module is: importing '/src/lib/devAuth.js' goes through Vite's transform,
 * which resolves the bare specifier for us.
 *
 * NOT A PRODUCTION PATH. Nothing under src/ imports this, so it is never part
 * of the production bundle. It grants no privilege of its own — the custom
 * token is minted server-side by scripts/firebaseAdmin.mjs using the service
 * account key, and only for a uid that is already an active admin.
 */
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../firebase/config';

/**
 * Signs the page in as `uid` using a custom token minted by firebase-admin.
 *
 * Returns the signed-in uid so the caller can assert it matches what it asked
 * for — a token for the wrong uid would otherwise fail much later, inside
 * assert_verified_admin, as an opaque "Access denied".
 */
export async function signInWithMintedToken(customToken) {
  const cred = await signInWithCustomToken(auth, customToken);
  // Force a token fetch now so supabase.js's accessToken callback resolves
  // immediately on the first request rather than racing the first insert.
  await cred.user.getIdToken(true);
  return cred.user.uid;
}
