/**
 * reconciliationWorker — periodic job that flips PROCESSING request rows to
 * AVAILABLE once Lidarr reports the underlying album (or artist) as fully
 * downloaded.
 *
 * Design notes:
 *   - Polls every `RECONCILIATION_INTERVAL_MS` (default 10 minutes). Skipped
 *     entirely when NODE_ENV=test — tests call `runReconciliationOnce()`
 *     directly so we don't pollute test runs with intervals.
 *   - Caps each tick at 200 PROCESSING rows. The realistic ceiling is far
 *     below that; this is a defensive bound to keep one stuck install from
 *     thrashing Lidarr.
 *   - Per-row errors are logged and swallowed so one flaky album response
 *     can't poison the whole pass.
 *   - For ALBUM rows: `getDownloadStatus(lidarrAlbumId)`. Complete →
 *     AVAILABLE.
 *   - For ARTIST rows: `getArtistDownloadStatus(lidarrArtistId)`. Complete
 *     when albumFileCount >= albumCount && albumCount > 0.
 *   - Returns a summary so the admin manual-trigger endpoint can show a
 *     brief progress confirmation.
 */

import { prisma } from '../db/prisma';
import { getLidarrClient } from '../api/lidarr/factory';
import { getLogger } from '../lib/logger';
import type { LidarrClient } from '../api/lidarr';

import type { Logger } from 'pino';

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
const MAX_ROWS_PER_TICK = 200;

export interface ReconciliationSummary {
  checked: number;
  promotedToAvailable: number;
  errors: number;
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

function readIntervalFromEnv(): number {
  const raw = process.env.RECONCILIATION_INTERVAL_MS;
  if (!raw) return DEFAULT_INTERVAL_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_INTERVAL_MS;
  return n;
}

interface StartOptions {
  intervalMs?: number;
  logger?: Logger;
}

/**
 * Start the periodic reconciliation loop. Idempotent: a second call while
 * the loop is running is a no-op. Skipped in NODE_ENV=test.
 */
export function startReconciliationLoop(opts: StartOptions = {}): void {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  if (intervalHandle) {
    return;
  }
  const intervalMs = opts.intervalMs ?? readIntervalFromEnv();
  const log = opts.logger ?? getLogger('reconciliation');
  log.info({ intervalMs }, 'reconciliation: starting loop');

  intervalHandle = setInterval(() => {
    runReconciliationOnce({ logger: log }).catch((err) => {
      log.error({ err }, 'reconciliation: tick failed');
    });
  }, intervalMs);
  // Don't keep the process alive solely for this timer.
  if (typeof intervalHandle.unref === 'function') intervalHandle.unref();
}

/** Stop the periodic loop (graceful shutdown). */
export function stopReconciliationLoop(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

interface RunOptions {
  logger?: Logger;
}

/**
 * Run a single reconciliation pass. Used by the periodic loop and by the
 * admin manual-trigger endpoint + tests.
 *
 * Returns a summary of work done; never throws (per-row errors are
 * swallowed and counted).
 */
export async function runReconciliationOnce(
  opts: RunOptions = {}
): Promise<ReconciliationSummary> {
  const log = opts.logger ?? getLogger('reconciliation');
  const summary: ReconciliationSummary = {
    checked: 0,
    promotedToAvailable: 0,
    errors: 0,
  };

  let lidarr: LidarrClient | null;
  try {
    lidarr = await getLidarrClient();
  } catch (err) {
    log.warn({ err }, 'reconciliation: getLidarrClient failed; skipping pass');
    return summary;
  }
  if (!lidarr) {
    return summary;
  }

  const rows = await prisma.musicRequest.findMany({
    where: { status: 'PROCESSING' },
    take: MAX_ROWS_PER_TICK,
    orderBy: { createdAt: 'asc' },
  });

  for (const row of rows) {
    summary.checked += 1;
    try {
      let complete = false;
      if (row.type === 'ALBUM') {
        if (row.lidarrAlbumId == null) {
          // No id to poll — leave it alone.
          continue;
        }
        const s = await lidarr.getDownloadStatus(row.lidarrAlbumId);
        complete = s.downloaded;
      } else if (row.type === 'ARTIST') {
        if (row.lidarrArtistId == null) {
          continue;
        }
        const s = await lidarr.getArtistDownloadStatus(row.lidarrArtistId);
        complete = s.complete;
      }

      if (complete) {
        await prisma.musicRequest.update({
          where: { id: row.id },
          data: { status: 'AVAILABLE', errorMessage: null },
        });
        summary.promotedToAvailable += 1;
      }
    } catch (err) {
      summary.errors += 1;
      log.warn(
        { err, rowId: row.id, type: row.type },
        'reconciliation: row check failed'
      );
    }
  }

  return summary;
}

/** Test-only escape hatch: tells whether the loop has an active interval. */
export function isReconciliationRunning(): boolean {
  return intervalHandle !== null;
}
