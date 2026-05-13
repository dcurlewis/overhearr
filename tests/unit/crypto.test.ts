import { describe, expect, it } from 'vitest';

import {
  decryptSecret,
  encryptSecret,
  redactSecret,
} from '../../server/lib/crypto';

describe('crypto: encryptSecret / decryptSecret', () => {
  it('round-trips a non-trivial secret', () => {
    const plain = 'lidarr-api-key-1234567890abcdef';
    const enc = encryptSecret(plain);
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc).not.toContain(plain);
    expect(decryptSecret(enc)).toBe(plain);
  });

  it('produces a different ciphertext on each call (random IV)', () => {
    const a = encryptSecret('same-input');
    const b = encryptSecret('same-input');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe('same-input');
    expect(decryptSecret(b)).toBe('same-input');
  });

  it('handles the empty string', () => {
    const enc = encryptSecret('');
    expect(decryptSecret(enc)).toBe('');
  });

  it('rejects tampered ciphertext with a clean message', () => {
    const enc = encryptSecret('top-secret');
    // Flip a byte in the base64 portion.
    const body = enc.slice(3);
    const buf = Buffer.from(body, 'base64');
    const lastIdx = buf.length - 1;
    buf[lastIdx] = (buf[lastIdx] ?? 0) ^ 0xff;
    const tampered = `v1:${buf.toString('base64')}`;
    expect(() => decryptSecret(tampered)).toThrow('failed to decrypt secret');
  });

  it('rejects payloads without the v1 prefix', () => {
    expect(() => decryptSecret('not-versioned')).toThrow('failed to decrypt secret');
  });

  it('rejects truncated payloads', () => {
    expect(() => decryptSecret('v1:' + Buffer.from('short').toString('base64'))).toThrow(
      'failed to decrypt secret'
    );
  });
});

describe('crypto: redactSecret', () => {
  it('returns null for null input', () => {
    expect(redactSecret(null)).toBeNull();
  });

  it('masks all but the last 4 characters', () => {
    expect(redactSecret('abcdef1234567890f8e9')).toBe('••••••••f8e9');
  });

  it('handles short inputs gracefully (still bullets, original tail)', () => {
    expect(redactSecret('xy')).toBe('••••••••xy');
  });
});
