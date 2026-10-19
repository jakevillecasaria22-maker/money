// Encrypted local store. Every record is sealed with a random data key (DEK) before it touches
// IndexedDB. The DEK itself is stored only wrapped by a key derived from the user's PIN, so the
// data is unreadable without the PIN. Decrypted records live in memory only while unlocked.

import * as idb from './db.js';
import * as cx from './crypto.js';
import { emptyState, DEFAULT_SETTINGS } from './calc.js';

const COLLECTIONS = {
  incomeSource: 'incomeSources',
  income: 'income',
  bill: 'bills',
  billPayment: 'billPayments',
  expense: 'expenses',
  savings: 'savings',
  purchase: 'purchases',
};
const MAX_FAILURES = 5;

export let state = emptyState();
let dataKey = null;
let dekRaw = null;
const envs = new Map();
const listeners = new Set();

export const onChange = (fn) => listeners.add(fn);
const emit = (source) => listeners.forEach((fn) => fn(source));

export const hasVault = async () => !!(await idb.getMeta('vault'));
export const isUnlocked = () => !!dataKey;
export const getDekRaw = () => dekRaw;

// ------------------------------------------------------------------ vault

async function writeVault(pin) {
  const salt = cx.randomBytes(16);
  const kek = await cx.importAesKey(await cx.deriveBits(pin, salt));
  const wrapped = await cx.encryptBytes(kek, dekRaw, 'vault');
  await idb.setMeta('vault', { v: 1, salt: cx.b64u.encode(salt), iterations: cx.KDF_ITERATIONS, wrapped });
}

/** Creates the local vault. Pass an existing data key when joining a synced account. */
export async function createVault(pin, existingDek = null) {
  dekRaw = existingDek || cx.randomBytes(32);
  await writeVault(pin);
  dataKey = await cx.importAesKey(dekRaw);
  envs.clear();
  state = emptyState();
  await idb.delMeta('unlockFailures');
  emit('unlock');
}

async function unwrap(pin) {
  const v = await idb.getMeta('vault');
  if (!v) throw new Error('No data on this device');
  const fails = (await idb.getMeta('unlockFailures')) || { count: 0, until: 0 };
  const wait = Math.ceil((fails.until - Date.now()) / 1000);
  if (wait > 0) throw new Error(`Too many attempts. Try again in ${wait}s.`);
  const kek = await cx.importAesKey(await cx.deriveBits(pin, cx.b64u.decode(v.salt), v.iterations));
  try {
    const raw = await cx.decryptBytes(kek, v.wrapped, 'vault');
    await idb.delMeta('unlockFailures');
    return raw;
  } catch {
    const count = fails.count + 1;
    const lockSecs = count >= MAX_FAILURES ? 30 * 2 ** (count - MAX_FAILURES) : 0;
    await idb.setMeta('unlockFailures', { count, until: Date.now() + lockSecs * 1000 });
    throw new Error(lockSecs ? `Wrong PIN. Locked for ${lockSecs}s.` : 'Wrong PIN');
  }
}

export async function unlock(pin) {
  const raw = await unwrap(pin);
  dekRaw = raw;
  dataKey = await cx.importAesKey(raw);
  await loadAll();
  emit('unlock');
}

export async function verifyPin(pin) {
  await unwrap(pin);
  return true;
}

export async function changePin(oldPin, newPin) {
  await unwrap(oldPin);
  await writeVault(newPin);
}

export function lock() {
  dataKey = null;
  dekRaw = null;
  envs.clear();
  state = emptyState();
  emit('lock');
}

/** Replaces this device's (empty) vault with a shared data key from sync. Local records are
 *  cleared first because they were sealed with the old key. */
export async function replaceVault(pin, dek) {
  await unwrap(pin);
  await idb.clearRecords();
  await createVault(pin, dek);
}

/** Permanently removes every record and setting stored on this device. */
export async function eraseDevice() {
  lock();
  await idb.clearAll();
}

// ------------------------------------------------------------------ records

function place(s, rec) {
  if (rec.type === 'settings') s.settings = { ...DEFAULT_SETTINGS, ...rec, budgets: { ...(rec.budgets || {}) } };
  else if (COLLECTIONS[rec.type]) s[COLLECTIONS[rec.type]].push(rec);
}

async function loadAll() {
  const all = await idb.getAllRecords();
  const s = emptyState();
  envs.clear();
  const live = all.filter((e) => !e.deleted);
  all.forEach((e) => envs.set(e.id, e));
  const recs = await Promise.all(live.map((e) => cx.decryptJSON(dataKey, e, e.id).catch(() => null)));
  recs.filter(Boolean).forEach((r) => place(s, r));
  state = s;
}

function upsertState(rec) {
  if (rec.type === 'settings') { place(state, rec); return; }
  const list = state[COLLECTIONS[rec.type]];
  if (!list) return;
  const i = list.findIndex((x) => x.id === rec.id);
  if (i >= 0) list[i] = rec;
  else list.push(rec);
}

function removeFromState(id) {
  for (const c of Object.values(COLLECTIONS)) {
    const i = state[c].findIndex((x) => x.id === id);
    if (i >= 0) { state[c].splice(i, 1); return; }
  }
}

async function seal(rec, deleted) {
  const { iv, ct } = await cx.encryptJSON(dataKey, rec, rec.id);
  return { id: rec.id, updatedAt: rec.updatedAt, deleted, iv, ct, dirty: 1 };
}

function stamp(rec, now) {
  const prev = envs.get(rec.id);
  return Math.max(now, (prev?.updatedAt || 0) + 1);
}

/** Saves (creates or updates) records atomically. Returns the saved copies. */
export async function saveMany(recs) {
  if (!dataKey) throw new Error('Locked');
  const now = Date.now();
  const out = recs.map((r) => {
    const id = r.id || cx.uuid();
    return { ...r, id, createdAt: r.createdAt || now, updatedAt: stamp({ id }, now) };
  });
  const sealed = await Promise.all(out.map((r) => seal(r, false)));
  await idb.putRecords(sealed);
  sealed.forEach((e) => envs.set(e.id, e));
  out.forEach(upsertState);
  emit('local');
  return out;
}

export const save = async (rec) => (await saveMany([rec]))[0];

/** Deletes records by leaving an encrypted tombstone, so the deletion also syncs. */
export async function removeMany(recs) {
  if (!dataKey) throw new Error('Locked');
  const now = Date.now();
  const sealed = await Promise.all(recs.map((r) => seal({ id: r.id, type: r.type, deleted: true, updatedAt: stamp(r, now) }, true)));
  await idb.putRecords(sealed);
  sealed.forEach((e) => { envs.set(e.id, e); removeFromState(e.id); });
  emit('local');
}

export const remove = (rec) => removeMany([rec]);

export const saveSettings = (patch) => save({ ...state.settings, ...patch, id: 'settings', type: 'settings' });

export const recordCount = () => Object.values(COLLECTIONS).reduce((n, c) => n + state[c].length, 0);

// ------------------------------------------------------------------ sync support

/** Same rule as the server: newer updatedAt wins, ties go to the larger ciphertext. */
const isNewer = (a, b) => !b || (a.updatedAt !== b.updatedAt ? a.updatedAt > b.updatedAt : a.ct > b.ct);

export function dirtyEnvelopes(limit = 500) {
  const out = [];
  for (const e of envs.values()) {
    if (e.dirty) out.push({ id: e.id, updatedAt: e.updatedAt, deleted: e.deleted, iv: e.iv, ct: e.ct });
    if (out.length >= limit) break;
  }
  return out;
}

export const hasDirty = () => dirtyEnvelopes(1).length > 0;

export async function markClean(pushed) {
  const changed = [];
  for (const p of pushed) {
    const e = envs.get(p.id);
    if (e && e.dirty && e.updatedAt === p.updatedAt && e.ct === p.ct) { e.dirty = 0; changed.push(e); }
  }
  if (changed.length) await idb.putRecords(changed);
}

/** Merges envelopes from the server. Older or identical versions are ignored. */
export async function applyRemote(list) {
  const incoming = list.filter((r) => {
    const local = envs.get(r.id);
    return !(local && local.updatedAt === r.updatedAt && local.ct === r.ct) && isNewer(r, local);
  });
  if (!incoming.length) return 0;
  const toPut = incoming.map((r) => ({ id: r.id, updatedAt: r.updatedAt, deleted: !!r.deleted, iv: r.iv, ct: r.ct, dirty: 0 }));
  const recs = await Promise.all(toPut.map((e) => (e.deleted ? null : cx.decryptJSON(dataKey, e, e.id).catch(() => undefined))));
  const ok = toPut.filter((e, i) => recs[i] !== undefined);
  await idb.putRecords(ok);
  ok.forEach((e, i) => {
    envs.set(e.id, e);
    const rec = recs[toPut.indexOf(e)];
    if (e.deleted) removeFromState(e.id);
    else upsertState(rec);
  });
  emit('remote');
  return ok.length;
}

// ------------------------------------------------------------------ backup

const BACKUP_AAD = 'money-tracker-backup';

export async function exportBackup(password) {
  const records = [state.settings.updatedAt ? state.settings : null, ...Object.values(COLLECTIONS).flatMap((c) => state[c])].filter(Boolean);
  const counts = Object.fromEntries(Object.values(COLLECTIONS).map((c) => [c, state[c].length]));
  const sealed = await cx.sealWithPassword(password, { records }, BACKUP_AAD);
  return { app: 'money-tracker', kind: 'backup', format: 1, createdAt: new Date().toISOString(), counts, ...sealed };
}

export async function readBackup(file, password) {
  let blob;
  try { blob = JSON.parse(await file.text()); } catch { throw new Error('This is not a Money Tracker backup file.'); }
  if (blob?.app !== 'money-tracker' || blob.kind !== 'backup' || !blob.kdf) throw new Error('This is not a Money Tracker backup file.');
  try {
    const { records } = await cx.openWithPassword(password, blob, BACKUP_AAD);
    if (!Array.isArray(records)) throw new Error();
    return { records, createdAt: blob.createdAt };
  } catch {
    throw new Error('Wrong backup password, or the file is damaged.');
  }
}

/** Restores without deleting anything: records missing or deleted here come back; for records
 *  that exist in both places the more recently edited version is kept. Ids are preserved, so
 *  restoring the same backup twice never creates duplicates. */
export async function restoreRecords(records) {
  const now = Date.now();
  const toSave = [];
  const result = { added: 0, restored: 0, updated: 0, unchanged: 0 };
  for (const r of records) {
    if (!r || typeof r.id !== 'string' || !(r.type === 'settings' || COLLECTIONS[r.type])) continue;
    const local = envs.get(r.id);
    if (!local) { toSave.push({ ...r, updatedAt: stamp(r, now) }); result.added++; }
    else if (local.deleted) { toSave.push({ ...r, updatedAt: stamp(r, now) }); result.restored++; }
    else if ((r.updatedAt || 0) > local.updatedAt) { toSave.push(r); result.updated++; }
    else result.unchanged++;
  }
  const sealed = await Promise.all(toSave.map((r) => seal(r, false)));
  await idb.putRecords(sealed);
  sealed.forEach((e) => envs.set(e.id, e));
  toSave.forEach(upsertState);
  emit('local');
  return result;
}
