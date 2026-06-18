/**
 * Unit tests for quotaService — the request-quota resolution + enforcement.
 *
 * Drives the service directly against the per-file SQLite DB (see
 * tests/integration/setup-env.ts). Covers: under limit OK, at-limit 429
 * (active and weekly), admin exempt, user override beats global, and
 * null = unlimited at both levels.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../server/db/prisma';
import { QuotaExceededError } from '../../server/lib/errors';
import {
  assertWithinQuota,
  resolveQuotaForUser,
} from '../../server/services/quotaService';
import { settingsService } from '../../server/services/settingsService';

async function clearDb(): Promise<void> {
  await prisma.session.deleteMany();
  await prisma.musicRequest.deleteMany();
  await prisma.user.deleteMany();
  await prisma.settings.deleteMany();
  settingsService.invalidate();
}

async function makeUser(
  overrides: {
    role?: string;
    quotaActiveLimit?: number | null;
    quotaWeeklyLimit?: number | null;
  } = {}
): Promise<number> {
  const u = await prisma.user.create({
    data: {
      username: `u${Math.random().toString(36).slice(2, 8)}`,
      passwordHash: 'x',
      role: overrides.role ?? 'USER',
      quotaActiveLimit: overrides.quotaActiveLimit ?? null,
      quotaWeeklyLimit: overrides.quotaWeeklyLimit ?? null,
    },
  });
  return u.id;
}

async function setGlobalDefaults(input: {
  defaultQuotaActiveLimit?: number | null;
  defaultQuotaWeeklyLimit?: number | null;
}): Promise<void> {
  await settingsService.updateQuotaSettings(input);
}

/** Create N requests for a user with a given status / createdAt. */
async function seedRequests(
  userId: number,
  count: number,
  opts: { status?: string; createdAt?: Date } = {}
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await prisma.musicRequest.create({
      data: {
        userId,
        type: 'ALBUM',
        mbid: `mb-${userId}-${i}-${Math.random().toString(36).slice(2)}`,
        name: `Album ${i}`,
        status: opts.status ?? 'PROCESSING',
        ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      },
    });
  }
}

beforeEach(async () => {
  await clearDb();
});

afterEach(async () => {
  settingsService.invalidate();
});

describe('resolveQuotaForUser — precedence', () => {
  it('user override beats global default', async () => {
    await setGlobalDefaults({
      defaultQuotaActiveLimit: 5,
      defaultQuotaWeeklyLimit: 10,
    });
    const resolved = await resolveQuotaForUser({
      quotaActiveLimit: 2,
      quotaWeeklyLimit: null,
    });
    // Override wins on active; weekly falls back to the global default.
    expect(resolved.activeLimit).toBe(2);
    expect(resolved.weeklyLimit).toBe(10);
  });

  it('null at both levels = unlimited', async () => {
    const resolved = await resolveQuotaForUser({
      quotaActiveLimit: null,
      quotaWeeklyLimit: null,
    });
    expect(resolved.activeLimit).toBeNull();
    expect(resolved.weeklyLimit).toBeNull();
  });
});

describe('assertWithinQuota — active limit', () => {
  it('allows when under the active limit', async () => {
    const userId = await makeUser({ quotaActiveLimit: 3 });
    await seedRequests(userId, 2, { status: 'PROCESSING' });
    await expect(assertWithinQuota(userId, false)).resolves.toBeUndefined();
  });

  it('throws 429 when at the active limit', async () => {
    const userId = await makeUser({ quotaActiveLimit: 2 });
    await seedRequests(userId, 2, { status: 'PENDING' });
    await expect(assertWithinQuota(userId, false)).rejects.toBeInstanceOf(
      QuotaExceededError
    );
  });

  it('only PENDING + PROCESSING count toward the active limit', async () => {
    const userId = await makeUser({ quotaActiveLimit: 2 });
    // 2 terminal rows do not count.
    await seedRequests(userId, 1, { status: 'AVAILABLE' });
    await seedRequests(userId, 1, { status: 'FAILED' });
    await seedRequests(userId, 1, { status: 'PROCESSING' });
    await expect(assertWithinQuota(userId, false)).resolves.toBeUndefined();
  });
});

describe('assertWithinQuota — weekly limit', () => {
  it('throws 429 when at the weekly limit (recent rows)', async () => {
    const userId = await makeUser({ quotaWeeklyLimit: 2 });
    await seedRequests(userId, 2, { status: 'AVAILABLE' });
    await expect(assertWithinQuota(userId, false)).rejects.toBeInstanceOf(
      QuotaExceededError
    );
  });

  it('ignores requests older than 7 days for the weekly limit', async () => {
    const userId = await makeUser({ quotaWeeklyLimit: 2 });
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await seedRequests(userId, 3, {
      status: 'AVAILABLE',
      createdAt: eightDaysAgo,
    });
    // All 3 are stale → within the weekly window the count is 0.
    await expect(assertWithinQuota(userId, false)).resolves.toBeUndefined();
  });
});

describe('assertWithinQuota — exemptions & defaults', () => {
  it('admins are exempt even when over limit', async () => {
    const userId = await makeUser({ role: 'ADMIN', quotaActiveLimit: 1 });
    await seedRequests(userId, 5, { status: 'PROCESSING' });
    await expect(assertWithinQuota(userId, true)).resolves.toBeUndefined();
  });

  it('unlimited (no override, no default) never throws', async () => {
    const userId = await makeUser();
    await seedRequests(userId, 50, { status: 'PROCESSING' });
    await expect(assertWithinQuota(userId, false)).resolves.toBeUndefined();
  });

  it('falls back to the global default when no user override', async () => {
    await setGlobalDefaults({ defaultQuotaActiveLimit: 1 });
    const userId = await makeUser();
    await seedRequests(userId, 1, { status: 'PROCESSING' });
    await expect(assertWithinQuota(userId, false)).rejects.toBeInstanceOf(
      QuotaExceededError
    );
  });

  it('user override beats global default at enforcement time', async () => {
    // Global says 1, but the user override raises it to 5.
    await setGlobalDefaults({ defaultQuotaActiveLimit: 1 });
    const userId = await makeUser({ quotaActiveLimit: 5 });
    await seedRequests(userId, 3, { status: 'PROCESSING' });
    await expect(assertWithinQuota(userId, false)).resolves.toBeUndefined();
  });
});
