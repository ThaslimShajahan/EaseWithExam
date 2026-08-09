/**
 * Reusable firebase-admin initializer for one-off local admin scripts
 * (scripts/*.mjs) — NOT imported by anything under src/, so it never enters
 * the Vite bundle and is unreachable from any live route. Never import this
 * from application code.
 *
 * Requires a Firebase service account key on disk, gitignored, referenced
 * via FIREBASE_SERVICE_ACCOUNT_PATH (defaults to the path Thaslim generated
 * this key at). Get one at:
 *   Firebase Console → Project Settings → Service Accounts → Generate new private key
 *
 * Usage:
 *   import { getAuth } from './firebaseAdmin.mjs';
 *   const auth = getAuth();
 *   const { users } = await auth.listUsers();
 */

import { readFileSync, existsSync } from 'fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';

const DEFAULT_KEY_PATH = 'secrets/edutech-app-acenzos-firebase-adminsdk-fbsvc-7f5c5626ed.json';

export function getAuth() {
  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || DEFAULT_KEY_PATH;

  if (!existsSync(keyPath)) {
    console.error(`[firebaseAdmin] Service account key not found at "${keyPath}".`);
    console.error('[firebaseAdmin] Generate one at: Firebase Console → Project Settings → Service Accounts → Generate new private key');
    process.exit(1);
  }

  if (getApps().length === 0) {
    const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
    initializeApp({ credential: cert(serviceAccount) });
  }

  return getAdminAuth();
}
