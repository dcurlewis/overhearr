/**
 * requestService — orchestrates the album/artist request flow that drives
 * Phase 4b's most business-critical surface.
 *
 * Responsibilities:
 *   - Call Lidarr to add an artist or album.
 *   - Persist a `MusicRequest` row whose status reflects whatever happened
 *     (PROCESSING on success, PENDING for soft-fail/skyhook flake/album-search
 *     fallback, FAILED for everything else).
 *   - Idempotency: keyed on `(userId, mbid, type)` via a Prisma upsert
 *     (the schema-level unique constraint is the source of truth).
 *   - Retry: re-runs the create flow on FAILED rows, mutating the same row.
 *
 * Lidarr is a flaky upstream — we run all Lidarr calls FIRST, classify the
 * outcome into one of (PROCESSING / PENDING / FAILED) plus an error message,
 * then upsert with the final state. There is no transactional guard around
 * the Lidarr+DB pair: if the DB upsert fails after a successful Lidarr add,
 * the next user retry will hit `LidarrAlreadyExistsError` which we treat
 * the same as success, so the system reconverges.
 */

import type { Prisma } from '@prisma/client';

import { prisma } from '../db/prisma';
import {
  AppError,
  ForbiddenError,
  LidarrAlbumNotFoundError,
  LidarrAlreadyExistsError,
  LidarrAuthError,
  LidarrError,
  LidarrMetadataUnavailableError,
  LidarrNotConfiguredError,
  LidarrUnreachableError,
  MusicBrainzNotFoundError,
  RequestNotFoundError,
  ValidationError,
} from '../lib/errors';
import { getLogger } from '../lib/logger';
import { getLidarrClient } from '../api/lidarr/factory';
import type { LidarrClient } from '../api/lidarr';
import { musicbrainz } from '../api/musicbrainz';
import { assertWithinQuota } from './quotaService';
import { settingsService } from './settingsService';
import type {
  MusicRequestRow,
  RequestStatusValue,
  RequestTypeValue,
  RequestListResponse,
} from '../../src/types/api';

const log = getLogger('requestService');

const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 25;

// ---- DTO mapping ----------------------------------------------------------

type MusicRequestModel = Prisma.MusicRequestGetPayload<Record<string, never>>;

export function toMusicRequestRow(row: MusicRequestModel): MusicRequestRow {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type as RequestTypeValue,
    mbid: row.mbid,
    name: row.name,
    artistName: row.artistName ?? null,
    coverArtUrl: row.coverArtUrl ?? null,
    releaseDate: row.releaseDate ? row.releaseDate.toISOString() : null,
    status: row.status as RequestStatusValue,
    lidarrAlbumId: row.lidarrAlbumId ?? null,
    lidarrArtistId: row.lidarrArtistId ?? null,
    errorMessage: row.errorMessage ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---- Internal: result of running a Lidarr add attempt --------------------

interface LidarrAttemptResult {
  status: RequestStatusValue;
  lidarrAlbumId?: number;
  lidarrArtistId?: number;
  errorMessage?: string;
}

// ---- Album request --------------------------------------------------------

export async function createAlbumRequest(
  userId: number,
  mbid: string,
  isAdmin = false
): Promise<MusicRequestRow> {
  // 1. Idempotency short-circuit for non-terminal rows. Re-requesting an
  //    in-flight row does not count against the quota, so this runs first.
  const existing = await prisma.musicRequest.findUnique({
    where: { userId_mbid_type: { userId, mbid, type: 'ALBUM' } },
  });
  if (existing && existing.status !== 'FAILED') {
    return toMusicRequestRow(existing);
  }

  // 2. Quota check — BEFORE any Lidarr call. No-op for admins / unlimited.
  await assertWithinQuota(userId, isAdmin);

  return executeAlbumRequest(userId, mbid);
}

/**
 * Like `createAlbumRequest` but skips the idempotency short-circuit. Used by
 * the retry path so a PENDING row (which would otherwise be returned as-is)
 * can be re-run.
 */
async function executeAlbumRequest(
  userId: number,
  mbid: string
): Promise<MusicRequestRow> {
  // 2. Pull MusicBrainz metadata for the row's display fields.
  let albumName = 'Unknown album';
  let artistName: string | null = null;
  let artistMbid = '';
  let coverArtUrl: string | null = null;
  let releaseDate: Date | null = null;
  try {
    const album = await musicbrainz.getAlbum(mbid);
    albumName = album.title || albumName;
    artistName = album.artistName || null;
    artistMbid = album.artistMbid || '';
    coverArtUrl = album.coverArtUrl ?? null;
    if (album.firstReleaseDate) {
      const d = new Date(album.firstReleaseDate);
      if (!isNaN(d.getTime())) releaseDate = d;
    }
  } catch (err) {
    if (err instanceof MusicBrainzNotFoundError) {
      throw new ValidationError(`Album ${mbid} not found in MusicBrainz`);
    }
    throw err;
  }
  if (!artistMbid) {
    throw new ValidationError(
      'MusicBrainz did not return an artist mbid for this album'
    );
  }

  // 3. Lidarr config / client.
  const lidarr = await getLidarrClient();
  if (!lidarr) {
    throw new LidarrNotConfiguredError();
  }
  const cfg = await settingsService.getDecryptedLidarrConfig();
  if (!cfg) {
    throw new LidarrNotConfiguredError();
  }

  // 4. Run the Lidarr add and classify outcome.
  const attempt = await runAddAlbum(lidarr, {
    mbid,
    artistMbid,
    rootFolderPath: cfg.rootFolderPath,
    qualityProfileId: cfg.qualityProfileId,
    metadataProfileId: cfg.metadataProfileId,
  });

  // 5. Upsert with the final status.
  const row = await upsertRequest({
    userId,
    type: 'ALBUM',
    mbid,
    name: albumName,
    artistName,
    coverArtUrl,
    releaseDate,
    attempt,
  });
  return toMusicRequestRow(row);
}

async function runAddAlbum(
  lidarr: LidarrClient,
  args: {
    mbid: string;
    artistMbid: string;
    rootFolderPath: string;
    qualityProfileId: number;
    metadataProfileId: number;
  }
): Promise<LidarrAttemptResult> {
  try {
    const result = await lidarr.addAlbum({
      mbid: args.mbid,
      artistMbid: args.artistMbid,
      rootFolderPath: args.rootFolderPath,
      qualityProfileId: args.qualityProfileId,
      metadataProfileId: args.metadataProfileId,
      searchForNewAlbum: true,
    });
    return {
      status: 'PROCESSING',
      lidarrAlbumId: result.album.id,
      lidarrArtistId: result.artist.id,
    };
  } catch (err) {
    if (err instanceof LidarrAlreadyExistsError) {
      // Try to look up the existing album to capture its id.
      try {
        const artist = await lidarr.getArtistByMbid(args.artistMbid);
        const album = await lidarr.getAlbumByMbid(args.mbid, artist?.id);
        return {
          status: 'PROCESSING',
          lidarrAlbumId: album?.id,
          lidarrArtistId: artist?.id,
        };
      } catch (lookupErr) {
        log.warn(
          { err: lookupErr, mbid: args.mbid },
          'requestService: post-already-exists lookup failed; treating as PROCESSING anyway'
        );
        return { status: 'PROCESSING' };
      }
    }
    if (err instanceof LidarrAlbumNotFoundError) {
      // Smart-fallback (absorbed WIP behaviour): we couldn't add the album
      // from Lidarr's metadata but the artist is now in the library — kick
      // off an artist-wide search and ask the user to check back later.
      try {
        const artist = await lidarr.getArtistByMbid(args.artistMbid);
        if (artist) {
          await lidarr.triggerArtistSearch(artist.id);
          return {
            status: 'PENDING',
            lidarrArtistId: artist.id,
            errorMessage:
              'Lidarr could not resolve this album in its metadata catalog. We asked Lidarr to search the artist instead — check back later.',
          };
        }
      } catch (fallbackErr) {
        log.warn(
          { err: fallbackErr, mbid: args.mbid },
          'requestService: artist-search fallback failed'
        );
      }
      return {
        status: 'PENDING',
        errorMessage:
          'Lidarr could not resolve this album in its metadata catalog. Try again later.',
      };
    }
    if (err instanceof LidarrMetadataUnavailableError) {
      return {
        status: 'PENDING',
        errorMessage:
          err.message ||
          'Lidarr metadata server is currently unavailable. Try again later.',
      };
    }
    if (err instanceof LidarrUnreachableError) {
      return {
        status: 'FAILED',
        errorMessage: err.message || 'Lidarr is unreachable.',
      };
    }
    if (err instanceof LidarrAuthError) {
      return {
        status: 'FAILED',
        errorMessage:
          err.message || 'Lidarr rejected the configured API key.',
      };
    }
    if (err instanceof LidarrError) {
      return { status: 'FAILED', errorMessage: err.message };
    }
    if (err instanceof AppError) {
      return { status: 'FAILED', errorMessage: err.message };
    }
    log.error({ err, mbid: args.mbid }, 'requestService: unexpected addAlbum error');
    return {
      status: 'FAILED',
      errorMessage:
        err instanceof Error ? err.message : 'Unexpected error from Lidarr',
    };
  }
}

// ---- Artist request -------------------------------------------------------

export async function createArtistRequest(
  userId: number,
  mbid: string,
  isAdmin = false
): Promise<MusicRequestRow> {
  const existing = await prisma.musicRequest.findUnique({
    where: { userId_mbid_type: { userId, mbid, type: 'ARTIST' } },
  });
  if (existing && existing.status !== 'FAILED') {
    return toMusicRequestRow(existing);
  }
  // Quota check — BEFORE any Lidarr call. No-op for admins / unlimited.
  await assertWithinQuota(userId, isAdmin);
  return executeArtistRequest(userId, mbid);
}

/** Idempotency-bypassing variant for the retry path. */
async function executeArtistRequest(
  userId: number,
  mbid: string
): Promise<MusicRequestRow> {
  let artistName = 'Unknown artist';
  try {
    const artist = await musicbrainz.getArtist(mbid);
    artistName = artist.name || artistName;
  } catch (err) {
    if (err instanceof MusicBrainzNotFoundError) {
      throw new ValidationError(`Artist ${mbid} not found in MusicBrainz`);
    }
    throw err;
  }

  const lidarr = await getLidarrClient();
  if (!lidarr) {
    throw new LidarrNotConfiguredError();
  }
  const cfg = await settingsService.getDecryptedLidarrConfig();
  if (!cfg) {
    throw new LidarrNotConfiguredError();
  }

  const attempt = await runAddArtist(lidarr, {
    mbid,
    rootFolderPath: cfg.rootFolderPath,
    qualityProfileId: cfg.qualityProfileId,
    metadataProfileId: cfg.metadataProfileId,
  });

  const row = await upsertRequest({
    userId,
    type: 'ARTIST',
    mbid,
    name: artistName,
    artistName,
    coverArtUrl: null,
    releaseDate: null,
    attempt,
  });
  return toMusicRequestRow(row);
}

async function runAddArtist(
  lidarr: LidarrClient,
  args: {
    mbid: string;
    rootFolderPath: string;
    qualityProfileId: number;
    metadataProfileId: number;
  }
): Promise<LidarrAttemptResult> {
  try {
    // If artist is already in Lidarr's library: skip add, kick off a search,
    // record PROCESSING.
    const existing = await lidarr.getArtistByMbid(args.mbid);
    if (existing) {
      try {
        await lidarr.triggerArtistSearch(existing.id);
      } catch (searchErr) {
        log.warn(
          { err: searchErr, mbid: args.mbid },
          'requestService: triggerArtistSearch on existing artist failed'
        );
      }
      return {
        status: 'PROCESSING',
        lidarrArtistId: existing.id,
      };
    }

    const added = await lidarr.addArtist({
      mbid: args.mbid,
      rootFolderPath: args.rootFolderPath,
      qualityProfileId: args.qualityProfileId,
      metadataProfileId: args.metadataProfileId,
      monitor: 'all',
      searchForMissingAlbums: true,
    });
    return {
      status: 'PROCESSING',
      lidarrArtistId: added.id,
    };
  } catch (err) {
    if (err instanceof LidarrAlreadyExistsError) {
      try {
        const found = await lidarr.getArtistByMbid(args.mbid);
        if (found) {
          try {
            await lidarr.triggerArtistSearch(found.id);
          } catch {
            // best-effort
          }
          return { status: 'PROCESSING', lidarrArtistId: found.id };
        }
      } catch (lookupErr) {
        log.warn(
          { err: lookupErr, mbid: args.mbid },
          'requestService: post-already-exists artist lookup failed'
        );
      }
      return { status: 'PROCESSING' };
    }
    if (err instanceof LidarrMetadataUnavailableError) {
      return {
        status: 'PENDING',
        errorMessage:
          err.message ||
          'Lidarr metadata server is currently unavailable. Try again later.',
      };
    }
    if (err instanceof LidarrUnreachableError) {
      return {
        status: 'FAILED',
        errorMessage: err.message || 'Lidarr is unreachable.',
      };
    }
    if (err instanceof LidarrAuthError) {
      return {
        status: 'FAILED',
        errorMessage:
          err.message || 'Lidarr rejected the configured API key.',
      };
    }
    if (err instanceof LidarrError) {
      return { status: 'FAILED', errorMessage: err.message };
    }
    if (err instanceof AppError) {
      return { status: 'FAILED', errorMessage: err.message };
    }
    log.error({ err, mbid: args.mbid }, 'requestService: unexpected addArtist error');
    return {
      status: 'FAILED',
      errorMessage:
        err instanceof Error ? err.message : 'Unexpected error from Lidarr',
    };
  }
}

// ---- Upsert ---------------------------------------------------------------

interface UpsertArgs {
  userId: number;
  type: RequestTypeValue;
  mbid: string;
  name: string;
  artistName: string | null;
  coverArtUrl: string | null;
  releaseDate: Date | null;
  attempt: LidarrAttemptResult;
}

async function upsertRequest(args: UpsertArgs): Promise<MusicRequestModel> {
  const data = {
    name: args.name,
    artistName: args.artistName,
    coverArtUrl: args.coverArtUrl,
    releaseDate: args.releaseDate,
    status: args.attempt.status,
    lidarrAlbumId: args.attempt.lidarrAlbumId ?? null,
    lidarrArtistId: args.attempt.lidarrArtistId ?? null,
    errorMessage: args.attempt.errorMessage ?? null,
  };
  return prisma.musicRequest.upsert({
    where: {
      userId_mbid_type: {
        userId: args.userId,
        mbid: args.mbid,
        type: args.type,
      },
    },
    create: {
      userId: args.userId,
      type: args.type,
      mbid: args.mbid,
      ...data,
    },
    update: data,
  });
}

// ---- Retry ---------------------------------------------------------------

export async function retryRequest(
  userId: number,
  isAdmin: boolean,
  requestId: number
): Promise<MusicRequestRow> {
  const row = await prisma.musicRequest.findUnique({ where: { id: requestId } });
  if (!row) throw new RequestNotFoundError();
  if (row.userId !== userId && !isAdmin) {
    // Don't leak existence: behave like a 404 for non-owners.
    throw new RequestNotFoundError();
  }
  if (row.status !== 'FAILED' && row.status !== 'PENDING') {
    throw new ValidationError(
      `Cannot retry a request in status ${row.status}`
    );
  }
  if (row.type === 'ALBUM') {
    return executeAlbumRequest(row.userId, row.mbid);
  }
  return executeArtistRequest(row.userId, row.mbid);
}

// ---- List / Get / Delete --------------------------------------------------

export interface ListRequestsArgs {
  userId: number;
  isAdmin: boolean;
  scope: 'mine' | 'all';
  limit?: number;
  offset?: number;
  status?: RequestStatusValue;
  type?: RequestTypeValue;
}

export async function listRequests(
  args: ListRequestsArgs
): Promise<RequestListResponse> {
  if (args.scope === 'all' && !args.isAdmin) {
    throw new ForbiddenError('scope=all requires admin role');
  }
  const limit = Math.min(args.limit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
  const offset = args.offset ?? 0;

  const where: Prisma.MusicRequestWhereInput = {};
  if (args.scope === 'mine') where.userId = args.userId;
  if (args.status) where.status = args.status;
  if (args.type) where.type = args.type;

  const [rows, total] = await Promise.all([
    prisma.musicRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
    }),
    prisma.musicRequest.count({ where }),
  ]);

  return {
    requests: rows.map(toMusicRequestRow),
    total,
  };
}

export async function getRequest(
  requestId: number,
  requestingUserId: number,
  isAdmin: boolean
): Promise<MusicRequestRow> {
  const row = await prisma.musicRequest.findUnique({ where: { id: requestId } });
  if (!row) throw new RequestNotFoundError();
  if (row.userId !== requestingUserId && !isAdmin) {
    throw new RequestNotFoundError();
  }
  return toMusicRequestRow(row);
}

/**
 * Delete a request row. Owner or admin only. This intentionally does NOT
 * touch Lidarr — the album/artist remains in the user's Lidarr library; we
 * just stop tracking the request from Overhearr's side.
 */
export async function deleteRequest(
  requestId: number,
  requestingUserId: number,
  isAdmin: boolean
): Promise<void> {
  const row = await prisma.musicRequest.findUnique({ where: { id: requestId } });
  if (!row) throw new RequestNotFoundError();
  if (row.userId !== requestingUserId && !isAdmin) {
    throw new RequestNotFoundError();
  }
  await prisma.musicRequest.delete({ where: { id: requestId } });
}
