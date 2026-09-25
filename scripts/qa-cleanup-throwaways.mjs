/**
 * Deletes QA throwaway accounts (uid prefix qa-tmp-…) from the live database
 * and from Firebase Auth.
 *
 *   node scripts/qa-cleanup-throwaways.mjs qa-tmp-fixa-          # dry run: counts only
 *   node scripts/qa-cleanup-throwaways.mjs qa-tmp-fixa- --apply  # delete
 *
 * Finds every public table with a uid-like column holding the prefix, deletes
 * those rows in one transaction (users last), and re-counts to prove nothing is
 * left. ai_call_log is KEPT on purpose: it is the spend record of real OpenAI
 * calls. Shared caches a throwaway wrote (important_qa, …) are not keyed by
 * uid — remove those by id, separately.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getAuth } from './firebaseAdmin.mjs';

const [prefix] = process.argv.slice(2);
const apply = process.argv.includes('--apply');
if (!/^qa-tmp-[a-z0-9-]+$/.test(prefix ?? '')) { console.error('prefix must look like qa-tmp-xxx-'); process.exit(1); }
const KEEP = new Set(['ai_call_log']);
const UID_COLS = ['user_id', 'firebase_uid', 'uid', 'caller_uid', 'actor_uid', 'created_by', 'student_id', 'admin_uid'];

function sql(q) {
  const f = join(mkdtempSync(join(tmpdir(), 'qa-clean-')), 'q.sql');
  writeFileSync(f, q);
  const out = execFileSync('npx', ['supabase', 'db', 'query', '--linked', '-f', `"${f}"`], { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const j = JSON.parse(out.slice(out.indexOf('{')));
  if (j.error) throw new Error(j.error.message);
  return j.rows ?? [];
}

const cols = sql(`select c.table_name t, c.column_name c from information_schema.columns c
  join information_schema.tables t using (table_schema, table_name)
  where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.column_name in (${UID_COLS.map((x) => `'${x}'`).join(',')})`);
const like = `'${prefix}%'`;
const count = () => sql(`select * from (${cols.map(({ t, c }) => `select '${t}' t, '${c}' c, count(*)::int n from public."${t}" where "${c}"::text like ${like}`).join(' union all ')}) x where n > 0 order by t`);

const before = count();
console.log('rows found:'); before.forEach((r) => console.log(`  ${r.t}.${r.c}: ${r.n}${KEEP.has(r.t) ? '  (kept)' : ''}`));
const uids = sql(`select firebase_uid from public.users where firebase_uid like ${like}`).map((r) => r.firebase_uid);
console.log('users:', uids.length);

if (!apply) { console.log('\nDry run. Re-run with --apply to delete.'); process.exit(0); }

const targets = before.filter((r) => !KEEP.has(r.t));
const nonUsers = targets.filter((r) => r.t !== 'users');
const stmts = [...nonUsers, ...targets.filter((r) => r.t === 'users')]
  .map(({ t, c }) => `delete from public."${t}" where "${c}"::text like ${like};`);
sql(`begin;\n${stmts.join('\n')}\ncommit;`);

const after = count().filter((r) => !KEEP.has(r.t));
console.log('\nleft after delete (excluding kept):', after.length ? after : 'none');

if (uids.length) {
  const r = await getAuth().deleteUsers(uids);
  const still = await getAuth().getUsers(uids.map((uid) => ({ uid })));
  console.log(`firebase: deleted ${r.successCount}, failed ${r.failureCount}, remaining ${still.users.length}`);
}
process.exitCode = after.length ? 1 : 0;
