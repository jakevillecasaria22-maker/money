// Optional sync with the Money Tracker server. Records travel and rest on the server already
// encrypted with the data key, which the server never sees. A sync passphrase derives both the
// server login token and the key that wraps the data key for other devices.

import * as store from './store.js';
import * as idb from './db.js';
import * as cx from './crypto.js';

const API = 'api/';
let status = { state: 'off', lastSync: null, message: '' };
const listeners = new Set();
let running = null;
let timer = null;

export const onStatus = (fn) => listeners.add(fn);
export const getStatus = () => status;
function setStatus(next) {
  status = { ...status, ...next };
  listeners.forEach((fn) => fn(status));
}

class SyncError extends Error {
  constructor(message, { offline = false, status: code = 0 } = {}) { super(message); this.offline = offline; this.status = code; }
}

async function call(path, body, token) {
  let res;
  try {
    res = await fetch(API + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    throw new SyncError('Cannot reach the sync server.', { offline: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new SyncError(data.error || `Server error (${res.status})`, { status: res.status });
  return data;
}

/** Server details, or null when the app is hosted without the sync server. */
export async function serverInfo() {
  try {
    const info = await call('info');
    return info?.app === 'money-tracker' ? info : null;
  } catch {
    return null;
  }
}

async function secretsFor(passphrase, info) {
  const bits = await cx.deriveBits(passphrase, cx.b64u.decode(info.salt), info.iterations, 512);
  return { token: cx.b64u.encode(bits.slice(0, 32)), kek: await cx.importAesKey(bits.slice(32)) };
}

async function saveConfig(token) {
  const sealedToken = await cx.encryptBytes(await cx.importAesKey(store.getDekRaw()), new TextEncoder().encode(token), 'sync-token');
  await idb.setMeta('sync', { token: sealedToken, lastRev: 0, connectedAt: Date.now() });
}

async function loadConfig() {
  const cfg = await idb.getMeta('sync');
  if (!cfg || !store.isUnlocked()) return null;
  const token = new TextDecoder().decode(await cx.decryptBytes(await cx.importAesKey(store.getDekRaw()), cfg.token, 'sync-token'));
  return { ...cfg, token };
}

export const isConfigured = async () => !!(await idb.getMeta('sync'));

/** First device: uploads this device's data key wrapped by the passphrase, then pushes everything. */
export async function createSync(passphrase, setupCode) {
  const info = await serverInfo();
  if (!info) throw new Error('The sync server is not available at this address.');
  const { token, kek } = await secretsFor(passphrase, info);
  const wrapped = await cx.encryptBytes(kek, store.getDekRaw(), 'sync-dek');
  await call('vault/register', { token, wrapped, ...(setupCode ? { setupCode } : {}) });
  await saveConfig(token);
  return syncNow();
}

/** Fetches the shared data key with the sync passphrase (used to set up another device). */
export async function fetchSharedKey(passphrase) {
  const info = await serverInfo();
  if (!info) throw new Error('The sync server is not available at this address.');
  if (!info.vault) throw new Error('Sync has not been set up on this server yet. Set it up from your first device.');
  const { token, kek } = await secretsFor(passphrase, info);
  let wrapped;
  try {
    ({ wrapped } = await call('vault/key', {}, token));
  } catch (e) {
    throw new Error(e.status === 401 ? 'Wrong sync passphrase.' : e.message);
  }
  return { dek: await cx.decryptBytes(kek, wrapped, 'sync-dek'), token };
}

/** Saves sync credentials for a device that just adopted the shared key, then syncs. */
export async function connectWithToken(token) {
  await saveConfig(token);
  return syncNow();
}

/** Second device (fresh): create the local vault with the shared key, then pull everything. */
export async function joinSync(passphrase, pin) {
  const { dek, token } = await fetchSharedKey(passphrase);
  await store.createVault(pin, dek);
  return connectWithToken(token);
}

export async function disconnect() {
  await idb.delMeta('sync');
  setStatus({ state: 'off', message: '' });
}

export function syncNow() {
  if (!running) running = run().finally(() => { running = null; });
  return running;
}

async function run() {
  const cfg = await loadConfig();
  if (!cfg) { setStatus({ state: 'off' }); return; }
  if (!navigator.onLine) { setStatus({ state: 'offline', message: 'Offline. Changes are saved on this device and will sync later.' }); return; }
  setStatus({ state: 'syncing', message: '' });
  try {
    let since = cfg.lastRev || 0;
    for (let round = 0; round < 100; round++) {
      const changes = store.dirtyEnvelopes(500);
      const res = await call('sync', { since, changes }, cfg.token);
      const applied = new Set(res.applied);
      await store.markClean(changes.filter((c) => applied.has(c.id)));
      await store.applyRemote([...res.rejected, ...res.records]);
      since = res.rev;
      await idb.setMeta('sync', { ...(await idb.getMeta('sync')), lastRev: since });
      if (!res.more && !store.hasDirty()) break;
    }
    setStatus({ state: 'idle', lastSync: Date.now(), message: '' });
  } catch (e) {
    setStatus(e.offline
      ? { state: 'offline', message: 'Offline. Changes are saved on this device and will sync later.' }
      : { state: 'error', message: e.status === 401 ? 'Sync login rejected. Reconnect sync in Settings.' : e.message });
  }
}

/** Debounced sync after local edits. */
export function scheduleSync(delay = 1500) {
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow(); }, delay);
}

export async function authToken() {
  return (await loadConfig())?.token ?? null;
}

export async function pushRequest(path, body) {
  const token = await authToken();
  if (!token) throw new Error('Sync is not connected');
  return call(path, body, token);
}
