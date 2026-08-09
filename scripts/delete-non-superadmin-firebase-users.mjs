/**
 * One-off admin script: deletes every Firebase Auth user EXCEPT Thaslim's
 * own superadmin account. Local tool only — never imported from src/, never
 * shipped, never reachable from any route. Run manually:
 *
 *   node scripts/delete-non-superadmin-firebase-users.mjs
 *
 * Requires the service account key at
 * secrets/edutech-app-acenzos-firebase-adminsdk-fbsvc-7f5c5626ed.json (gitignored).
 *
 * Lists every account first, prints the full list + count, THEN deletes,
 * THEN re-lists to confirm only the superadmin account remains — all in one
 * run (this repo's earlier Batch 11 Postgres cleanup already went through a
 * separate explicit-confirmation round for this exact deletion; this script
 * is the follow-up Firebase Auth side of that same, already-authorized action).
 */

import { getAuth } from './firebaseAdmin.mjs';

const SUPERADMIN_UID = '2gPm50tCEme5sZebbB5YlQW6R012'; // thaslimshajahans@gmail.com

async function listAllUsers(auth) {
  const all = [];
  let pageToken;
  do {
    const result = await auth.listUsers(1000, pageToken);
    all.push(...result.users);
    pageToken = result.pageToken;
  } while (pageToken);
  return all;
}

function describe(u) {
  return `  ${u.uid}  email=${u.email || '-'}  phone=${u.phoneNumber || '-'}  providers=${u.providerData.map(p => p.providerId).join(',') || '-'}`;
}

const auth = getAuth();

console.log('Fetching all Firebase Auth users...');
const allUsers = await listAllUsers(auth);
console.log(`Total Firebase Auth accounts: ${allUsers.length}\n`);

const superadmin = allUsers.find((u) => u.uid === SUPERADMIN_UID);
if (!superadmin) {
  console.error(`FATAL: superadmin uid ${SUPERADMIN_UID} not found in Firebase Auth — aborting, refusing to delete anything.`);
  process.exit(1);
}
console.log('Preserving superadmin account:');
console.log(describe(superadmin));

const toDelete = allUsers.filter((u) => u.uid !== SUPERADMIN_UID);
console.log(`\n${toDelete.length} accounts will be deleted:`);
toDelete.forEach((u) => console.log(describe(u)));

if (toDelete.length === 0) {
  console.log('\nNothing to delete.');
  process.exit(0);
}

console.log(`\nDeleting ${toDelete.length} accounts...`);
const uidsToDelete = toDelete.map((u) => u.uid);

// deleteUsers accepts up to 1000 uids per call — chunk defensively in case
// this ever runs against a much larger user base than today's ~40.
const BATCH = 1000;
let totalSuccess = 0;
let totalFailure = 0;
const allErrors = [];
for (let i = 0; i < uidsToDelete.length; i += BATCH) {
  const chunk = uidsToDelete.slice(i, i + BATCH);
  const result = await auth.deleteUsers(chunk);
  totalSuccess += result.successCount;
  totalFailure += result.failureCount;
  allErrors.push(...result.errors);
}

console.log(`\nDeletion result: ${totalSuccess} succeeded, ${totalFailure} failed.`);
if (allErrors.length) {
  console.log('Errors:');
  allErrors.forEach((e) => console.log(`  index ${e.index} (uid ${uidsToDelete[e.index]}): ${e.error.message}`));
}

console.log('\nRe-fetching all Firebase Auth users to confirm final state...');
const remaining = await listAllUsers(auth);
console.log(`Remaining accounts: ${remaining.length}`);
remaining.forEach((u) => console.log(describe(u)));

if (remaining.length === 1 && remaining[0].uid === SUPERADMIN_UID) {
  console.log('\n✅ Confirmed: only the superadmin account remains.');
} else {
  console.log('\n⚠️  Unexpected final state — remaining accounts do not match "superadmin only". Review the list above.');
}
