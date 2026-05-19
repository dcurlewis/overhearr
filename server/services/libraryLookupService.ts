/**
 * libraryLookupService — answers "is this MBID already in our Lidarr
 * library?" using the local mirror populated by `librarySyncWorker`.
 *
 * Two axes:
 *   - ALBUM by release-group MBID — direct PK lookup on
 *     `LidarrLibraryAlbum.foreignAlbumId`. A `true` here means this exact
 *     release-group is owned, and is a strong signal: callers can use it
 *     to disable the album-level Request button without risk.
 *   - ARTIST by artist MBID — true if at least one row exists with that
 *     `foreignArtistId`. **This is intentionally a "any album" signal**,
 *     not "full discography owned" — useful for showing an "in library"
 *     badge on artist cards, but NOT a strong enough signal to disable
 *     the artist-wide Request button (the user may still want to add the
 *     full catalog they only own one album from).
 *
 * The mirror lags up to `LIBRARY_SYNC_INTERVAL_MS` (default 1h). A `false`
 * here means "we have no record of it as of the last sync", not a hard
 * proof of absence — the request flow keeps the same error-handling for
 * already-exists collisions (LidarrAlreadyExistsError) it had before.
 */

import { prisma } from '../db/prisma';
import type { RequestTypeValue } from '../../src/types/api';

interface BatchItem {
  mbid: string;
  type: RequestTypeValue;
}

function batchKey(type: RequestTypeValue, mbid: string): string {
  return `${type}:${mbid}`;
}

/**
 * Batched library check. Returns a Map keyed by `${type}:${mbid}` with
 * boolean values; missing keys imply `false`. Empty input → empty map.
 */
export async function getLibraryStatusBatch(
  items: BatchItem[]
): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();
  if (items.length === 0) return result;

  const albumMbids: string[] = [];
  const artistMbids: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const k = batchKey(it.type, it.mbid);
    if (seen.has(k)) continue;
    seen.add(k);
    result.set(k, false);
    if (it.type === 'ALBUM') albumMbids.push(it.mbid);
    else artistMbids.push(it.mbid);
  }

  if (albumMbids.length > 0) {
    const rows = await prisma.lidarrLibraryAlbum.findMany({
      where: { foreignAlbumId: { in: albumMbids } },
      select: { foreignAlbumId: true },
    });
    for (const row of rows) {
      result.set(batchKey('ALBUM', row.foreignAlbumId), true);
    }
  }

  if (artistMbids.length > 0) {
    // groupBy gives us "is there at least one album for this foreignArtistId"
    // in one query, which is cheaper than findMany + dedupe.
    const rows = await prisma.lidarrLibraryAlbum.groupBy({
      by: ['foreignArtistId'],
      where: { foreignArtistId: { in: artistMbids } },
    });
    for (const row of rows) {
      result.set(batchKey('ARTIST', row.foreignArtistId), true);
    }
  }

  return result;
}

export function libraryStatusKey(
  type: RequestTypeValue,
  mbid: string
): string {
  return batchKey(type, mbid);
}
