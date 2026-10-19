// Tiny promise wrapper around IndexedDB. Two stores:
//   records  encrypted record envelopes {id, updatedAt, deleted, iv, ct, dirty}
//   meta     small app state {key, value} (vault, sync config, reminder digest...)

const DB_NAME = 'money-tracker';
const DB_VERSION = 1;
let dbPromise = null;

export function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Close other Money Tracker tabs and try again.'));
    });
  }
  return dbPromise;
}

async function run(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    const ret = fn(store);
    if (ret && 'onsuccess' in ret) ret.onsuccess = () => { result = ret.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted'));
  });
}

export async function getMeta(key) {
  const row = await run('meta', 'readonly', (s) => s.get(key));
  return row?.value;
}
export const setMeta = (key, value) => run('meta', 'readwrite', (s) => { s.put({ key, value }); });
export const delMeta = (key) => run('meta', 'readwrite', (s) => { s.delete(key); });

export const getAllRecords = () => run('records', 'readonly', (s) => s.getAll());

/** Writes many envelopes in a single transaction (all or nothing). */
export const putRecords = (envs) => run('records', 'readwrite', (s) => { for (const e of envs) s.put(e); });

export const clearRecords = () => run('records', 'readwrite', (s) => { s.clear(); });

export async function clearAll() {
  await run('records', 'readwrite', (s) => { s.clear(); });
  await run('meta', 'readwrite', (s) => { s.clear(); });
}
