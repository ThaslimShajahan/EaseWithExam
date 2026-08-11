/* READ-ONLY: mint a superadmin ID token and exercise the five broken surfaces. */
import { getAuth } from './scripts/firebaseAdmin.mjs';
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env','utf8').split('\n')
  .filter(l=>l.includes('=')&&!l.trim().startsWith('#'))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const SUPER='2gPm50tCEme5sZebbB5YlQW6R012';

const custom = await getAuth().createCustomToken(SUPER);
const ex = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${env.VITE_FIREBASE_API_KEY}`,
  {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:custom,returnSecureToken:true})});
const idToken = (await ex.json()).idToken;
if(!idToken){ console.log('token exchange failed'); process.exit(1); }

const U=env.VITE_SUPABASE_URL, K=env.VITE_SUPABASE_ANON_KEY;
const H={apikey:K, Authorization:`Bearer ${idToken}`, 'Content-Type':'application/json'};

const size = (t) => { try { const j=JSON.parse(t); return Array.isArray(j)?j.length:(j&&typeof j==='object'?Object.keys(j).length:'-'); } catch { return '-'; } };

const surfaces = [
  ['Feature Flags',      'admin_get_feature_flags',      {p_caller:SUPER}],
  ['Content > Publish',  'admin_list_published_tests',   {p_caller:SUPER}],
  ['Categories',         'admin_list_exam_categories',   {p_caller:SUPER}],
  ['Email Templates',    'admin_list_email_templates',   {p_caller:SUPER}],
  ['Onboarding Options', 'admin_list_onboarding_options',{p_caller:SUPER}],
  ['Students (L2)',      'admin_list_users',             {p_caller:SUPER}],
  ['Student Lookup',     'admin_search_users',           {p_caller:SUPER,p_query:'a',p_limit:50}],
  ['Subscriptions',      'admin_list_subscriptions',     {p_caller:SUPER}],
];

console.log('AS SUPERADMIN (real Firebase ID token)\n');
let bad=0;
for (const [label, fn, body] of surfaces) {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`,{method:'POST',headers:H,body:JSON.stringify(body)});
  const t = await r.text();
  const ok = r.status === 200;
  if(!ok) bad++;
  console.log(`  ${ok?'OK  ':'FAIL'} ${String(r.status).padEnd(4)} ${label.padEnd(20)} ${fn.padEnd(30)} rows/keys=${ok?size(t):t.slice(0,60)}`);
}
console.log(bad ? `\n${bad} surface(s) still failing.` : '\nAll admin surfaces reachable for the superadmin.');
