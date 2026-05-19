/**
 * librarySyncWorker — periodic mirror of Lidarr's `/album` library into the
 * local `LidarrLibraryAlbum` table.
 *
 * Why a worker, not a per-request lookup: `/api/v1/album` returns the entire
 * library (potentially thousands of rows on a homelab) and Lidarr is happy
 * to serve it but it's not free. A 1-hour cadence is plenty for the
 * "already in your library" badge — users tolerate up to an hour of lag
 * between adding an album directly in Lidarr and the badge updating in
 * Overhearr. Admins who want to force a refresh can hit the manual-trigger
 * endpoint (issue #5 deliberately keeps this separate from the existing
 * reconciliation worker — different cadence, different table, different
 * failure modes).
 *
 * Design parallels the reconciliation worker:
 *   - No-op when NODE_ENV=test; tests call `runLibrarySyncOnce()` directly.
 *   - Idempotent start; graceful stop.
 *   - All errors swallowed so a single bad pass can't poison the loop.
 *
 * Sync semantics: full snapshot replace. Each pass reads the full Lidarr
 * library, upserts every row, then deletes any local rows not present in
 * the snapshot. The table is small enough (low thousands of rows) that
 * doing this in one transaction is fine. We deliberately do NOT keep a
 * delta log — the table is a cache, not a source of truth.
 */

import { prisma } from '../db/prisma';
import { getLidarrClient } from '../api/lidarr/factory';
import { getLogger } from '../lib/logger';
import type { LidarrClient } from '../api/lidarr';

import type { Logger } from 'pino';

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export interface LibrarySyncSummary {
  /** Whether this pass actually ran (false when Lidarr is unconfigured). */
  ran: boolean;
  /** Rows pulled from Lidarr after dropping incomplete entries. */
  fetched: number;
  /** Rows inserted or updated locally. */
  upserted: number;
  /** Rows deleted locally because they no longer appear in Lidarr. */
  removed: number;
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

function readIntervalFromEnv(): number {
  const raw = process.env.LIBRARY_SYNC_INTERVAL_MS;
  if (!raw) return DEFAULT_INTERVAL_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_INTERVAL_MS;
  return n;
}

interface StartOptions {
  intervalMs?: number;
  logger?: Logger;
}

export function startLibrarySyncLoop(opts: StartOptions = {}): void {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  if (intervalHandle) {
    return;
  }
  const intervalMs = opts.intervalMs ?? readIntervalFromEnv();
  const log = opts.logger ?? getLogger('librarySync');
  log.info({ intervalMs }, 'librarySync: starting loop');

  // Kick off an immediate pass so a fresh restart doesn't wait an hour for
  // the first sync. The interval below keeps it fresh after that.
  void runLibrarySyncOnce({ logger: log });

  intervalHandle = setInterval(() => {
    runLibrarySyncOnce({ logger: log }).catch((err) => {
      log.error({ err }, 'librarySync: tick failed');
    });
  }, intervalMs);
  if (typeof intervalHandle.unref === 'function') intervalHandle.unref();
}

export function stopLibrarySyncLoop(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

interface RunOptions {
  logger?: Logger;
}

/**
 * Run a single library-sync pass. Used by the periodic loop, the admin
 * manual-trigger endpoint, and tests. Never throws — errors are logged
 * and the summary reports `ran: false` when the pass is skipped.
 */
export async function runLibrarySyncOnce(
  opts: RunOptions = {}
): Promise<LibrarySyncSummary> {
  const log = opts.logger ?? getLogger('librarySync');
  const empty: LibrarySyncSummary = {
    ran: false,
    fetched: 0,
    upserted: 0,
    removed: 0,
  };

  let lidarr: LidarrClient | null;
  try {
    lidarr = await getLidarrClient();
  } catch (err) {
    log.warn({ err }, 'librarySync: getLidarrClient failed; skipping pass');
    return empty;
  }
  if (!lidarr) {
    return empty;
  }

  let albums;
  try {
    albums = await lidarr.getAllLibraryAlbums();
  } catch (err) {
    log.warn({ err }, 'librarySync: pulling library from Lidarr failed');
    return empty;
  }

  // Upsert each row, then delete anything not in the snapshot. We don't
  // wrap in a single transaction because a partial failure leaving the
  // table half-updated is acceptable (the next pass will reconcile).
  let upserted = 0;
  const seenIds: string[] = [];
  for (const a of albums) {
    seenIds.push(a.foreignAlbumId);
    try {
      await prisma.lidarrLibraryAlbum.upsert({
        where: { foreignAlbumId: a.foreignAlbumId },
        create: {
          foreignAlbumId: a.foreignAlbumId,
          foreignArtistId: a.foreignArtistId,
          lidarrAlbumId: a.lidarrAlbumId,
          lidarrArtistId: a.lidarrArtistId,
        },
        update: {
          foreignArtistId: a.foreignArtistId,
          lidarrAlbumId: a.lidarrAlbumId,
          lidarrArtistId: a.lidarrArtistId,
          syncedAt: new Date(),
        },
      });
      upserted += 1;
    } catch (err) {
      log.warn(
        { err, foreignAlbumId: a.foreignAlbumId },
        'librarySync: row upsert failed'
      );
    }
  }

  let removed = 0;
  try {
    const res = await prisma.lidarrLibraryAlbum.deleteMany({
      where: seenIds.length > 0 ? { foreignAlbumId: { notIn: seenIds } } : {},
    });
    removed = res.count;
  } catch (err) {
    log.warn({ err }, 'librarySync: prune of stale rows failed');
  }

  log.info(
    { fetched: albums.length, upserted, removed },
    'librarySync: pass complete'
  );
  return { ran: true, fetched: albums.length, upserted, removed };
}

export function isLibrarySyncRunning(): boolean {
  return intervalHandle !== null;
}
