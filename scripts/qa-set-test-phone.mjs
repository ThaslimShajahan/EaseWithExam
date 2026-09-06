/**
 * QA-ONLY: registers a Firebase Auth "test phone number" so the phone-OTP
 * login flow can be exercised end-to-end (real signup code path, real
 * `users` row) without sending a real SMS or depending on a live carrier.
 * Firebase's own test-number mechanism (Identity Toolkit `accounts:config`,
 * exposed nowhere in firebase-admin's JS SDK, hence the raw REST call) skips
 * the SMS provider entirely and accepts a fixed OTP for that number only —
 * every other number still goes through real SMS. Safe to run repeatedly;
 * it merges into whatever test numbers already exist rather than replacing
 * them.
 *
 * Usage: node scripts/qa-set-test-phone.mjs [+91XXXXXXXXXX] [123456]
 * Defaults to +919633484641 / 123456 (the QA credential requested for this
 * test pass) when no args are given.
 *
 * NOT imported by application code. Requires the same service-account key
 * as scripts/firebaseAdmin.mjs.
 */
import { readFileSync, existsSync } from 'fs';
import { GoogleAuth } from 'google-auth-library';

const KEY_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
  || 'secrets/edutech-app-acenzos-firebase-adminsdk-fbsvc-7f5c5626ed.json';

if (!existsSync(KEY_PATH)) {
  console.error(`[qa-set-test-phone] Service account key not found at "${KEY_PATH}".`);
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(KEY_PATH, 'utf8'));
const projectId = serviceAccount.project_id;

const phone = process.argv[2] || '+919633484641';
const code = process.argv[3] || '123456';

const auth = new GoogleAuth({
  credentials: serviceAccount,
  scopes: ['https://www.googleapis.com/auth/identitytoolkit', 'https://www.googleapis.com/auth/cloud-platform'],
});
const client = await auth.getClient();
const { token } = await client.getAccessToken();

const base = `https://identitytoolkit.googleapis.com/v2/projects/${projectId}/config`;

// Read existing test numbers first so this call is additive, not destructive.
const getResp = await fetch(base, {
  headers: { Authorization: `Bearer ${token}` },
});
const current = await getResp.json();
if (!getResp.ok) {
  console.error('[qa-set-test-phone] Failed to read current config:', JSON.stringify(current, null, 2));
  process.exit(1);
}
if (process.env.DEBUG) console.log('[qa-set-test-phone] current config:', JSON.stringify(current, null, 2));

const existingTestNumbers = current.signIn?.phoneNumber?.testPhoneNumbers || {};
const merged = { ...existingTestNumbers, [phone]: code };

const patchResp = await fetch(`${base}?updateMask=signIn.phoneNumber.testPhoneNumbers`, {
  method: 'PATCH',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ signIn: { phoneNumber: { testPhoneNumbers: merged } } }),
});
const result = await patchResp.json();
if (!patchResp.ok) {
  console.error('[qa-set-test-phone] Failed to set test phone number:', JSON.stringify(result, null, 2));
  process.exit(1);
}

console.log(`[qa-set-test-phone] OK — ${phone} now accepts fixed OTP ${code} (no real SMS sent).`);
console.log('[qa-set-test-phone] All test numbers now configured:', JSON.stringify(result.signIn?.phoneNumber?.testPhoneNumbers, null, 2));
