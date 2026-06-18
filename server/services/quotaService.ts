/**
 * quotaService — optional per-user request quotas.
 *
 * Two independent axes, both opt-in:
 *   - active: max simultaneous PENDING + PROCESSING requests for the user.
 *   - weekly: max NEW requests created in the rolling trailing 7 days.
 *
 * Resolution order per user / per axis:
 *   1. user override (`User.quotaActiveLimit` / `quotaWeeklyLimit`) if set,
 *   2. else the global default (`Settings.defaultQuota*`),
 *   3. else unlimited (null at both levels).
 *
 * Admins are exempt entirely — the enforcement entry point short-circuits
 * before touching the DB. The check runs at the request-create boundary,
 * BEFORE any Lidarr call, so an over-quota user never mutates Lidarr.
 *
 * Idempotent re-requests (an existing non-FAILED row for the same
 * (userId, mbid, type)) are short-circuited by requestService before the
 * quota check, so re-requesting something you already requested never
 * counts against the quota a second time.
 */

import { prisma } from '../db/prisma';
import { QuotaExceededError } from '../lib/errors';
import { settingsService } from './settingsService';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export interface ResolvedQuota {
  /** Effective active-request limit, or null for unlimited. */
  activeLimit: number | null;
  /** Effective weekly-request limit, or null for unlimited. */
  weeklyLimit: number | null;
}

/**
 * Resolve the effective quota for a user, applying the override → default →
 * unlimited precedence for each axis independently.
 */
export async function resolveQuotaForUser(
  user: { quotaActiveLimit: number | null; quotaWeeklyLimit: number | null }
): Promise<ResolvedQuota> {
  const settings = await settingsService.getSettings();
  return {
    activeLimit:
      user.quotaActiveLimit ?? settings.defaultQuotaActiveLimit ?? null,
    weeklyLimit:
      user.quotaWeeklyLimit ?? settings.defaultQuotaWeeklyLimit ?? null,
  };
}

/**
 * Enforce the request quota for the given user. No-op for admins and for
 * users whose effective limits are both unlimited. Throws
 * `QuotaExceededError` (HTTP 429) with a friendly message when a limit would
 * be exceeded by one more request.
 */
export async function assertWithinQuota(
  userId: number,
  isAdmin: boolean
): Promise<void> {
  if (isAdmin) return;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { quotaActiveLimit: true, quotaWeeklyLimit: true },
  });
  // If the user vanished we have nothing to enforce; let the downstream flow
  // surface whatever error is appropriate.
  if (!user) return;

  const { activeLimit, weeklyLimit } = await resolveQuotaForUser(user);
  if (activeLimit == null && weeklyLimit == null) return;

  if (activeLimit != null) {
    const activeCount = await prisma.musicRequest.count({
      where: { userId, status: { in: ['PENDING', 'PROCESSING'] } },
    });
    if (activeCount >= activeLimit) {
      throw new QuotaExceededError(
        `You have reached your limit of ${activeLimit} active ` +
          `request${activeLimit === 1 ? '' : 's'}. Wait for some to complete ` +
          'or ask an admin to raise your quota.'
      );
    }
  }

  if (weeklyLimit != null) {
    const since = new Date(Date.now() - WEEK_MS);
    const weeklyCount = await prisma.musicRequest.count({
      where: { userId, createdAt: { gte: since } },
    });
    if (weeklyCount >= weeklyLimit) {
      throw new QuotaExceededError(
        `You have reached your limit of ${weeklyLimit} new ` +
          `request${weeklyLimit === 1 ? '' : 's'} per week. Try again later ` +
          'or ask an admin to raise your quota.'
      );
    }
  }
}
