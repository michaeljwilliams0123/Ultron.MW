const encoder = new TextEncoder();
const decoder = new TextDecoder();

function fromBase64(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}

function toBase64(bytes) {
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw);
}

export async function vaultKey(config) {
  const raw = fromBase64(await config.get('ULTRON_VAULT_KEY'));
  if (raw.length !== 32) throw Error('vault-key-invalid');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function seal(value, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  return toBase64(Uint8Array.from([...iv, ...ciphertext]));
}

export async function open(blob, key) {
  const packed = fromBase64(blob);
  if (packed.length < 29) throw Error('vault-blob-invalid');
  const iv = packed.slice(0, 12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, packed.slice(12));
  return JSON.parse(decoder.decode(plaintext));
}

export function vaultFor(db, key) {
  return {
    async set(name, value) {
      await db.query(`INSERT INTO owner_vault(k, blob) VALUES($1, $2)
        ON CONFLICT(k) DO UPDATE SET blob = EXCLUDED.blob, updated_at = now()`,
        [name, await seal(value, key)]);
    },
    async get(name) {
      const row = (await db.query('SELECT blob FROM owner_vault WHERE k = $1', [name])).rows[0];
      return row ? open(row.blob, key) : null;
    },
    async list(prefix) {
      return (await db.query('SELECT k FROM owner_vault WHERE k LIKE $1 ORDER BY k', [prefix + '%'])).rows.map(row => row.k);
    },
    async del(name) {
      await db.query('DELETE FROM owner_vault WHERE k = $1', [name]);
    }
  };
}
