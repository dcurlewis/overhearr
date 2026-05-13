import { describe, expect, it } from 'vitest';

import { ValidationError } from '../../server/lib/errors';
import {
  hashPassword,
  normalizeUsername,
  validatePasswordStrength,
  verifyPassword,
} from '../../server/services/authService';

describe('authService', () => {
  describe('normalizeUsername', () => {
    it('trims and lowercases', () => {
      expect(normalizeUsername('  AdMin  ')).toBe('admin');
    });
  });

  describe('validatePasswordStrength', () => {
    it('accepts a strong password', () => {
      expect(() => validatePasswordStrength('CorrectHorse1')).not.toThrow();
    });
    it('rejects too-short', () => {
      expect(() => validatePasswordStrength('a1')).toThrow(ValidationError);
    });
    it('rejects no-letter', () => {
      expect(() => validatePasswordStrength('1234567890')).toThrow(ValidationError);
    });
    it('rejects no-digit', () => {
      expect(() => validatePasswordStrength('abcdefghijk')).toThrow(ValidationError);
    });
    it('rejects non-string', () => {
      expect(() => validatePasswordStrength(undefined as unknown as string)).toThrow(
        ValidationError
      );
    });
  });

  describe('hashPassword + verifyPassword', () => {
    it('round-trips a password', async () => {
      const hash = await hashPassword('CorrectHorse1');
      expect(hash).not.toContain('CorrectHorse1');
      expect(await verifyPassword('CorrectHorse1', hash)).toBe(true);
      expect(await verifyPassword('wrong-password', hash)).toBe(false);
    });

    it('returns false for empty hash', async () => {
      expect(await verifyPassword('anything', '')).toBe(false);
    });
  });
});
