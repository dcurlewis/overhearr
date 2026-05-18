import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { env } from '../config/env';

/**
 * AES-256-GCM at-rest encryption for small secrets (the Lidarr API key).
 *
 * Format: `v1:<base64( iv(12) || ciphertext || authTag(16) )>`. The `v1:`
 * prefix gives us a versioning hook for future key-rotation flows; today
 * it is the only accepted version.
 *
 * The ENCRYPTION_KEY is validated at env-load time as 64 hex characters
 * (32 bytes). Decoding here is safe.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LEN = 12; // GCM standard
const TAG_LEN = 16;
const VERSION_PREFIX = 'v1:';

function getKey(): Buffer {
  return Buffer.from(env.ENCRYPTION_KEY, 'hex');
}

export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== 'string') {
    throw new TypeError('encryptSecret expects a string');
  }
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const blob = Buffer.concat([iv, ciphertext, authTag]);
  return `${VERSION_PREFIX}${blob.toString('base64')}`;
}

export function decryptSecret(ciphertext: string): string {
  if (typeof ciphertext !== 'string' || !ciphertext.startsWith(VERSION_PREFIX)) {
    throw new Error('failed to decrypt secret');
  }
  try {
    const blob = Buffer.from(ciphertext.slice(VERSION_PREFIX.length), 'base64');
    if (blob.length < IV_LEN + TAG_LEN) {
      throw new Error('payload too short');
    }
    const iv = blob.subarray(0, IV_LEN);
    const authTag = blob.subarray(blob.length - TAG_LEN);
    const data = blob.subarray(IV_LEN, blob.length - TAG_LEN);

    const key = getKey();
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]);
    return plain.toString('utf8');
  } catch {
    // Don't leak details — auth-tag failure, malformed base64, short payload
    // all collapse to the same opaque error.
    throw new Error('failed to decrypt secret');
  }
}

/**
 * Mask a value for safe display in API responses. Always returns the same
 * shape (`••••••••XXXX`) so the UI can show "key is set" without revealing
 * any meaningful prefix. For values shorter than 4 characters we still
 * return the bullets + whatever trails — this is fine because real API keys
 * are always long.
 */
export function redactSecret(value: string | null): string | null {
  if (value === null || value === undefined) return null;
  const last4 = value.length >= 4 ? value.slice(-4) : value;
  return '••••••••' + last4;
}
