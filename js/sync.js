// Encrypted cloud sync with Supabase (Auth + one row per user in table `vault`).
// The server only ever receives: the password-wrapped data key (meta) and the AES-GCM
// encrypted data blob. It can't read either. Login uses a one-way derived secret.
import { CONFIG } from './config.js';
import { vault } from './vault.js';
import { mergeData, COLLECTIONS } from './model.js';

const canon = (d) => JSON.stringify([...COLLECTIONS.map((c) => [...(d[c] || [])].sort((a, b) => (a.id < b.id ? -1 : 1))), d.su || 0, Object.keys(d.tomb || {}).sort()]);

const URL_ = (CONFIG.supabaseUrl || '').replace(/\/$/, '');
const KEY = CONFIG.supabaseAnonKey || '';

let S = null; // { email, uid, access_token, refresh_token, expires_at, rev, lastSync }
let busy = null;
let dirty = false;
export const markDirty = () => { dirty = true; };
const listeners = new Set();
export const syncState = { status: 'off', error: '', get session() { return S; } };
function set(status, error = '') { syncState.status = status; syncState.error = error; listeners.forEach((f) => f(syncState)); }
export const onSync = (f) => listeners.add(f);

export const syncAvailable = () => !!(URL_ && KEY);
export const syncOn = () => !!S;

async function api(path, { method = 'GET', body, token, headers = {} } = {}) {
  let r;
  try {
    r = await fetch(URL_ + path, {
      method,
      headers: { apikey: KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch { const e = new Error('No internet connection'); e.offline = true; throw e; }
  const txt = await r.text();
  const json = txt ? JSON.parse(txt) : null;
  if (!r.ok) {
    const msg = json?.msg || json?.message || json?.error_description || json?.error || `Server error ${r.status}`;
    const e = new Error(msg); e.status = r.status; e.code = json?.error_code || json?.code; throw e;
  }
  return json;
}

function adoptSession(j, email) {
  S = { ...(S || {}), email, uid: j.user.id, access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in - 60) * 1000 };
}
async function saveSession() { await vault.setSecret('sync', S); }

async function signIn(email, secret) {
  const j = await api('/auth/v1/token?grant_type=password', { method: 'POST', body: { email, password: secret } });
  adoptSession(j, email);
}
async function signUp(email, secret) {
  const j = await api('/auth/v1/signup', { method: 'POST', body: { email, password: secret } });
  if (!j.access_token) throw new Error('Supabase asked to confirm the email. Turn off "Confirm email" in Supabase (Authentication → Email) or confirm it from your inbox, then try again.');
  adoptSession(j, email);
}
async function token() {
  if (!S) throw new Error('Not connected');
  if (Date.now() < S.expires_at) return S.access_token;
  const j = await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: S.refresh_token } });
  adoptSession(j, S.email);
  await saveSession();
  return S.access_token;
}

async function getRow() {
  const rows = await api('/rest/v1/vault?select=meta,data,rev,updated_at', { token: await token() });
  return rows[0] || null;
}
async function insertRow(D) {
  const rows = await api('/rest/v1/vault', {
    method: 'POST', token: await token(), headers: { Prefer: 'return=representation' },
    body: { meta: vault.cloudMeta(), data: await vault.encrypt(D), rev: 1 },
  });
  S.rev = rows[0].rev;
}
// Optimistic concurrency: only update if nobody else changed the row since our last sync.
async function updateRow(D, rev) {
  const rows = await api(`/rest/v1/vault?user_id=eq.${S.uid}&rev=eq.${rev}`, {
    method: 'PATCH', token: await token(), headers: { Prefer: 'return=representation' },
    body: { meta: vault.cloudMeta(), data: await vault.encrypt(D), rev: rev + 1, updated_at: new Date().toISOString() },
  });
  if (!rows.length) return false;
  S.rev = rows[0].rev;
  return true;
}

// ---------- Public API ----------

// Called after unlocking: restore the saved session (if sync was set up on this device).
export async function resume() {
  if (!syncAvailable()) return;
  S = await vault.getSecret('sync');
  set(S ? 'idle' : 'off');
}

// Turn on sync from a device that already has data.
export async function connect(email, password, getD, setD) {
  const secret = await vault.authSecret(email, password);
  try { await signIn(email, secret); }
  catch (e) {
    if (!(e.status === 400 || e.status === 401 || e.code === 'invalid_credentials')) throw e;
    try { await signUp(email, secret); }
    catch (e2) { throw /already|registered|exists/i.test(e2.message) ? new Error('Wrong email or password for this cloud account.') : e2; }
  }
  const row = await getRow();
  if (row) {
    let remote;
    try { remote = await vault.decrypt(row.data); }
    catch { S = null; throw new Error('This cloud account already holds data from another app setup. To use it here, choose "Delete all data on this device", then "Sign in with my cloud account" on the welcome screen.'); }
    setD(mergeData(getD(), remote));
    S.rev = row.rev;
    await updateRow(getD(), row.rev);
  } else {
    await insertRow(getD());
  }
  S.lastSync = Date.now();
  await saveSession();
  set('idle');
}

// New device: download the encrypted vault and unlock it with the app username + password.
export async function restoreFromCloud(email, username, password) {
  const secret = await vault.authSecret(email, password);
  await signIn(email, secret);
  const row = await getRow();
  if (!row) { S = null; throw new Error('No cloud data found for this account yet.'); }
  await vault.adoptCloudMeta(row.meta);
  try { await vault.unlockPassword(username, password); }
  catch (e) { await vault.wipe(); S = null; throw e; }
  const data = await vault.decrypt(row.data);
  await vault.save(data);
  S.rev = row.rev; S.lastSync = Date.now();
  await saveSession();
  set('idle');
  return data;
}

// Pull remote changes, merge, push local changes. Safe to call often.
export function sync(getD, setD) {
  if (!S) return Promise.resolve();
  if (busy) return busy;
  busy = (async () => {
    set('syncing');
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const row = await getRow();
        if (!row) { await insertRow(getD()); break; }
        let needPush = dirty;
        if (row.rev !== S.rev) {
          const remote = await vault.decrypt(row.data);
          const merged = mergeData(getD(), remote);
          setD(merged);
          needPush = needPush || canon(merged) !== canon(remote);
          if (!needPush) S.rev = row.rev;
        }
        if (!needPush) break;
        dirty = false;
        if (await updateRow(getD(), row.rev)) break; // someone else wrote in between: retry
        dirty = true;
      }
      S.lastSync = Date.now();
      await saveSession();
      set('idle');
    } catch (e) {
      if (e.status === 401 || e.status === 403) set('error', 'Cloud sign-in expired. Turn sync off and on again in Settings.');
      else set(e.offline ? 'offline' : 'error', e.message);
    } finally { busy = null; }
  })();
  return busy;
}

// Keep the cloud login working after the app password changes.
export async function passwordChanged(newPassword, getD, setD) {
  if (!S) return;
  const secret = await vault.authSecret(S.email, newPassword);
  await api('/auth/v1/user', { method: 'PUT', token: await token(), body: { password: secret } });
  dirty = true;
  await sync(getD, setD);
}

export async function disconnect() {
  try { if (S) await api('/auth/v1/logout', { method: 'POST', token: await token() }); } catch { /* ignore */ }
  S = null;
  await vault.setSecret('sync', null);
  set('off');
}

export function lockReset() { S = null; set('off'); }
