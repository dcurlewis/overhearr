import bcrypt from 'bcrypt';

import { prisma } from '../db/prisma';
import { UnauthorizedError, ValidationError } from '../lib/errors';
import { toPublicUser, type PublicUser } from '../types/domain';

const BCRYPT_COST = 12;

/**
 * Username normalization.
 *
 * SQLite via Prisma is case-sensitive and Prisma does NOT support
 * `mode: 'insensitive'` on the SQLite connector. Rather than reach for
 * collations or lower(...) raw SQL, we canonicalize the username at every
 * write and read path: trimmed + lowercased. This guarantees uniqueness
 * holds in a case-insensitive sense and keeps lookups simple.
 */
export function normalizeUsername(name: string): string {
  return name.trim().toLowerCase();
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

/**
 * Validates password strength: ≥10 chars, must contain a letter and a digit.
 * Modern guidance (NIST SP 800-63B) favors length over complexity, so we
 * deliberately omit special-character requirements.
 *
 * Throws ValidationError on failure.
 */
export function validatePasswordStrength(password: string): void {
  if (typeof password !== 'string') {
    throw new ValidationError('Password is required');
  }
  if (password.length < 10) {
    throw new ValidationError('Password must be at least 10 characters long');
  }
  if (!/[A-Za-z]/.test(password)) {
    throw new ValidationError('Password must contain at least one letter');
  }
  if (!/[0-9]/.test(password)) {
    throw new ValidationError('Password must contain at least one digit');
  }
}

export async function findUserByUsername(username: string) {
  const normalized = normalizeUsername(username);
  return prisma.user.findUnique({ where: { username: normalized } });
}

/**
 * Verifies credentials. Returns a PublicUser on success.
 *
 * Inactive users are rejected with the same generic UnauthorizedError as
 * bad-password attempts, to avoid user-enumeration leaks.
 */
export async function authenticate(
  username: string,
  password: string
): Promise<PublicUser> {
  const user = await findUserByUsername(username);
  // Always run bcrypt to keep timing roughly equivalent for missing users.
  const dummyHash = '$2b$12$invalidsaltinvalidsaltinvalidsaltinvalidsaltinva';
  const ok = await verifyPassword(password, user?.passwordHash ?? dummyHash);
  if (!user || !ok || !user.isActive) {
    throw new UnauthorizedError('Invalid username or password');
  }
  return toPublicUser(user);
}
