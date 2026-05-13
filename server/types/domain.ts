import type { User } from '@prisma/client';
import { z } from 'zod';

/**
 * Domain enums. Stored as strings in SQLite (Prisma's SQLite connector does
 * not support `enum`). The TS unions and Zod enums below are the source of
 * truth — they are validated at the service / route boundary.
 */

export const UserRole = { ADMIN: 'ADMIN', USER: 'USER' } as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];
export const UserRoleEnum = z.enum(['ADMIN', 'USER']);

export const RequestType = { ALBUM: 'ALBUM', ARTIST: 'ARTIST' } as const;
export type RequestType = (typeof RequestType)[keyof typeof RequestType];
export const RequestTypeEnum = z.enum(['ALBUM', 'ARTIST']);

export const RequestStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  AVAILABLE: 'AVAILABLE',
  FAILED: 'FAILED',
} as const;
export type RequestStatus = (typeof RequestStatus)[keyof typeof RequestStatus];
export const RequestStatusEnum = z.enum(['PENDING', 'PROCESSING', 'AVAILABLE', 'FAILED']);

/**
 * PublicUser — User without `passwordHash`. This is the only user shape that
 * should ever leave the server (responses, req.user, etc.).
 */
export type PublicUser = Omit<User, 'passwordHash'> & { role: UserRole };

export function toPublicUser(user: User): PublicUser {
  // Avoid relying on object rest to ensure the field is provably stripped.
  const { passwordHash: _passwordHash, ...rest } = user;
  return { ...rest, role: rest.role as UserRole };
}
