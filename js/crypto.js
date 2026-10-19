// WebCrypto helpers. Records are sealed with AES-256-GCM; keys come from PBKDF2-SHA256.

const te = new TextEncoder();
const td = new TextDecoder();

export const KDF_ITERATIONS = 600000;

export const b64u = {
  encode(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = '';
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(str) {
    const s = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '==='.slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};

export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export async function deriveBits(secret, salt, iterations = KDF_ITERATIONS, bits = 256) {
  const base = await crypto.subtle.importKey('raw', te.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, bits));
}

export const importAesKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

function gcm(iv, aad) {
  const p = { name: 'AES-GCM', iv };
  if (aad) p.additionalData = te.encode(aad);
  return p;
}

/** aad binds the ciphertext to a context (e.g. the record id) so it can't be swapped. */
export async function encryptBytes(key, bytes, aad) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(gcm(iv, aad), key, bytes);
  return { iv: b64u.encode(iv), ct: b64u.encode(ct) };
}

export async function decryptBytes(key, { iv, ct }, aad) {
  return new Uint8Array(await crypto.subtle.decrypt(gcm(b64u.decode(iv), aad), key, b64u.decode(ct)));
}

export const encryptJSON = (key, obj, aad) => encryptBytes(key, te.encode(JSON.stringify(obj)), aad);
export const decryptJSON = async (key, sealed, aad) => JSON.parse(td.decode(await decryptBytes(key, sealed, aad)));

/** Password-protected blob (used for backup files). */
export async function sealWithPassword(password, obj, aad) {
  const salt = randomBytes(16);
  const key = await importAesKey(await deriveBits(password, salt));
  return { kdf: { name: 'PBKDF2-SHA256', salt: b64u.encode(salt), iterations: KDF_ITERATIONS }, ...(await encryptJSON(key, obj, aad)) };
}

export async function openWithPassword(password, blob, aad) {
  const key = await importAesKey(await deriveBits(password, b64u.decode(blob.kdf.salt), blob.kdf.iterations));
  return decryptJSON(key, blob, aad);
}
