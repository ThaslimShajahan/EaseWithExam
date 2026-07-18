/**
 * Google Drive folder listing + file download for Content Intake's bulk import.
 *
 * Google's Drive API rejects file-listing calls made with a bare API key —
 * file access is permission-scoped per account, so it requires a real signed-in
 * user (OAuth), not just a key. This reuses the same Firebase Google Sign-In
 * already used for admin login, adding the drive.readonly scope on top, and
 * calls the Drive API directly from the browser with the resulting access
 * token. That also means it works for folders shared to a specific account
 * ("Shared with me"), not only ones shared as "Anyone with the link".
 */

import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '../firebase/config';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const PDF_MIME    = 'application/pdf';
const MAX_DEPTH   = 6; // safety cap against pathological folder nesting

let cachedToken = null; // in-memory only — re-prompt next session, never persisted

/** Prompts Google sign-in with Drive read-only access added, returns an access token. */
export async function getDriveAccessToken({ forceReauth = false } = {}) {
  if (cachedToken && !forceReauth) return cachedToken;
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/drive.readonly');
  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  if (!credential?.accessToken) throw new Error('Google did not return a Drive access token — try again.');
  cachedToken = credential.accessToken;
  return cachedToken;
}

function parseFolderId(input) {
  const m = input.match(/\/folders\/([a-zA-Z0-9_-]+)/) || input.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

async function driveFetch(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    const err = new Error('Drive access expired — scan again to re-authorize.');
    err.expired = true;
    throw err;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Drive API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function listChildren(folderId, token) {
  const fields = 'nextPageToken, files(id, name, mimeType)';
  const query  = `'${folderId}' in parents and trashed = false`;
  let files = [];
  let pageToken = '';
  do {
    const url =
      `https://www.googleapis.com/drive/v3/files` +
      `?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&pageSize=1000` +
      (pageToken ? `&pageToken=${pageToken}` : '');
    const data = await driveFetch(url, token);
    files = files.concat(data.files ?? []);
    pageToken = data.nextPageToken ?? '';
  } while (pageToken);
  return files;
}

async function walk(folderId, token, path, depth, out) {
  if (depth > MAX_DEPTH) return;
  const children = await listChildren(folderId, token);
  for (const f of children) {
    if (f.mimeType === FOLDER_MIME) {
      await walk(f.id, token, [...path, f.name], depth + 1, out);
    } else if (f.mimeType === PDF_MIME) {
      out.push({ id: f.id, name: f.name, path: path.join(' / ') });
    }
  }
}

/**
 * @param {string} folderUrl - a Google Drive folder link (…/drive/folders/…)
 * @returns {Promise<{ files: Array<{id,name,path}>, token: string }>}
 */
export async function listDriveFolderPdfs(folderUrl) {
  const folderId = parseFolderId(folderUrl);
  if (!folderId) throw new Error('Could not find a folder ID in that link — paste a Drive folder link (…/folders/…), not a file link.');

  let token = await getDriveAccessToken();
  const out = [];
  try {
    await walk(folderId, token, [], 0, out);
  } catch (e) {
    if (e.expired) {
      token = await getDriveAccessToken({ forceReauth: true });
      out.length = 0;
      await walk(folderId, token, [], 0, out);
    } else {
      throw e;
    }
  }

  if (!out.length) {
    throw new Error('No PDFs found in this folder (or its subfolders) — or your account doesn\'t have access to it.');
  }
  return { files: out, token };
}

/** Downloads a Drive file's raw bytes using an authenticated Drive API call. */
export async function fetchDriveFileBytes(fileId, token) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Could not download file (HTTP ${res.status})`);
  return res.arrayBuffer();
}
