// Encrypted local vault.
// - A random 256-bit data key (DEK) encrypts all app data with AES-GCM.
// - The DEK is wrapped by a key derived from username+password (PBKDF2-SHA256, 600k rounds).
// - Optionally the DEK is also wrapped by a key derived from a passkey's PRF output
//   (fingerprint / Face ID), so biometrics can unlock without the password.
// Nothing readable is ever written to disk; the DEK only lives in memory while unlocked.

const DB_NAME = 'hm-vault';
const STORE = 'kv';
const PBKDF2_ITER = 600000;
const enc = new TextEncoder();
const dec = new TextDecoder();

const b64 = {
  to: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))),
  from: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
};
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kvGet(key) {
  const db = await idb();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE).objectStore(STORE).get(key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kvSet(key, val) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function kvClear() {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

async function pwKek(username, password, salt, iter = PBKDF2_ITER) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const fullSalt = new Uint8Array([...salt, ...enc.encode('|' + username.trim().toLowerCase())]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fullSalt, iterations: iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}
async function prfKek(prfOutput) {
  const base = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('hm-passkey-v1'), info: enc.encode('dek-wrap') },
    base, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
}
async function wrap(dek, kek) {
  const iv = rand(12);
  const ct = await crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-GCM', iv });
  return { iv: b64.to(iv), ct: b64.to(ct) };
}
async function unwrap(w, kek) {
  return crypto.subtle.unwrapKey('raw', b64.from(w.ct), kek, { name: 'AES-GCM', iv: b64.from(w.iv) },
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']);
}
async function encryptJSON(obj, key) {
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: b64.to(iv), ct: b64.to(ct) };
}
async function decryptJSON(blob, key) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.from(blob.iv) }, key, b64.from(blob.ct));
  return JSON.parse(dec.decode(pt));
}

let DEK = null;
let meta = null;

export const vault = {
  async load() { meta = await kvGet('meta'); return meta; },
  get meta() { return meta; },
  get unlocked() { return !!DEK; },

  async create(username, password, initialData) {
    DEK = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const salt = rand(16);
    const kek = await pwKek(username, password, salt);
    meta = { v: 1, username: username.trim(), salt: b64.to(salt), iter: PBKDF2_ITER, pw: await wrap(DEK, kek), passkey: null, created: Date.now() };
    await kvSet('meta', meta);
    await this.save(initialData);
  },

  async unlockPassword(username, password) {
    if (!meta) throw new Error('No account on this device');
    if (username.trim().toLowerCase() !== meta.username.toLowerCase()) throw new Error('Wrong username or password');
    const kek = await pwKek(username, password, b64.from(meta.salt), meta.iter);
    try { DEK = await unwrap(meta.pw, kek); } catch { throw new Error('Wrong username or password'); }
    return this.read();
  },

  async changePassword(oldPw, newPw) {
    const oldKek = await pwKek(meta.username, oldPw, b64.from(meta.salt), meta.iter);
    try { await unwrap(meta.pw, oldKek); } catch { throw new Error('Current password is wrong'); }
    const salt = rand(16);
    const kek = await pwKek(meta.username, newPw, salt);
    meta = { ...meta, salt: b64.to(salt), iter: PBKDF2_ITER, pw: await wrap(DEK, kek) };
    await kvSet('meta', meta);
  },

  // ---------- Passkey / fingerprint ----------
  async passkeySupported() {
    if (!window.PublicKeyCredential || !navigator.credentials) return false;
    try { return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch { return false; }
  },

  async enablePasskey() {
    const prfSalt = rand(32);
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: rand(32),
        rp: { name: 'Personal Assistant' },
        user: { id: rand(16), name: meta.username, displayName: meta.username },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        timeout: 60000,
        extensions: { prf: { eval: { first: prfSalt } } },
      },
    });
    const ext = cred.getClientExtensionResults();
    if (!ext.prf || ext.prf.enabled === false) throw new Error('This device\'s fingerprint/Face ID can\'t protect encrypted data (PRF not supported). Use your password instead.');
    let out = ext.prf.results?.first;
    if (!out) out = await this._prfGet(cred.rawId, prfSalt); // some platforms only return PRF on get()
    const kek = await prfKek(out);
    meta = { ...meta, passkey: { id: b64.to(cred.rawId), salt: b64.to(prfSalt), w: await wrap(DEK, kek) } };
    await kvSet('meta', meta);
  },

  async _prfGet(rawId, prfSalt) {
    const a = await navigator.credentials.get({
      publicKey: {
        challenge: rand(32),
        allowCredentials: [{ type: 'public-key', id: rawId }],
        userVerification: 'required',
        timeout: 60000,
        extensions: { prf: { eval: { first: prfSalt } } },
      },
    });
    const out = a.getClientExtensionResults().prf?.results?.first;
    if (!out) throw new Error('Fingerprint unlock is not supported on this browser.');
    return out;
  },

  async unlockPasskey() {
    const pk = meta?.passkey;
    if (!pk) throw new Error('Fingerprint unlock is not set up');
    const out = await this._prfGet(b64.from(pk.id), b64.from(pk.salt));
    try { DEK = await unwrap(pk.w, await prfKek(out)); } catch { throw new Error('Fingerprint unlock failed'); }
    return this.read();
  },

  async disablePasskey() {
    meta = { ...meta, passkey: null };
    await kvSet('meta', meta);
  },

  // ---------- Data ----------
  async read() {
    const blob = await kvGet('data');
    return blob ? decryptJSON(blob, DEK) : null;
  },
  async save(data) {
    if (!DEK) throw new Error('Locked');
    await kvSet('data', await encryptJSON(data, DEK));
  },
  lock() { DEK = null; },
  async wipe() { DEK = null; meta = null; await kvClear(); },

  // ---------- Backups (encrypted with a separate backup password) ----------
  async exportBackup(data, password) {
    const salt = rand(16);
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return { app: 'health-money', v: 1, salt: b64.to(salt), iter: PBKDF2_ITER, data: await encryptJSON(data, key), at: new Date().toISOString() };
  },
  async importBackup(file, password) {
    if (file.app !== 'health-money') throw new Error('This is not a backup from this app');
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64.from(file.salt), iterations: file.iter },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    try { return await decryptJSON(file.data, key); } catch { throw new Error('Wrong backup password'); }
  },
};
