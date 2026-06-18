/**
 * /api/album/:mbid and /api/artist/:mbid — full detail views.
 *
 * Both routes:
 *   - Require an authenticated session and a completed setup wizard.
 *   - Forward MusicBrainz errors to the central error handler (404, 502,
 *     503 — translated by class).
 *   - Enrich the response with this user's `requestStatus` so the UI can
 *     render the correct "Request" / "Pending" / "Available" affordance.
 *
 * Album detail additionally carries `artistRequestStatus` so the UI can
 * tell the user "you've already requested the entire artist's catalog —
 * this album will arrive automatically".
 *
 * Artist detail walks the discography and:
 *   - Looks up cover art per release-group in parallel.
 *   - Caps at the first 50 entries to avoid hammering CAA on huge
 *     catalogues; entries past 50 still appear in the response, just
 *     without `coverArtUrl`. The frontend can lazy-load the rest later.
 *   - Looks up per-album request status across the whole list (cheap —
 *     single SQLite query).
 */

import { Router } from 'express';
import { z } from 'zod';

import { musicbrainz } from '../api/musicbrainz';
import { UnauthorizedError, ValidationError } from '../lib/errors';
import { requireAuth, requireSetupComplete } from '../middleware/auth';
import {
  getLibraryStatusBatch,
  libraryStatusKey,
} from '../services/libraryLookupService';
import {
  getRequestStatus,
  getRequestStatusBatch,
  requestStatusKey,
} from '../services/requestLookupService';
import {
  getSimilarAlbums,
  getSimilarArtists,
} from '../services/similarService';
import type { DiscoverAlbum, DiscoverArtist } from '../types/discover';
import type {
  AlbumDetail,
  ArtistDetail,
  DiscoverAlbumWithStatus,
  DiscoverArtistWithStatus,
  ReleaseGroupWithStatus,
  RequestStatusInfo,
  SimilarAlbumsPayload,
  SimilarArtistsPayload,
} from '../../src/types/api';

/** Maximum number of release-groups to fetch cover art for, per artist. */
export const ARTIST_COVER_ART_CAP = 50;

const NOT_REQUESTED: RequestStatusInfo = { exists: false };

const mbidParamSchema = z.object({
  mbid: z.string().min(1, 'mbid is required').max(64),
});

/**
 * Attach per-user request status + in-library flags to similar-recommendation
 * cards. Mirrors the Discover route's enrichment: only rows carrying an mbid
 * are looked up; rows without one keep `requestStatus` / `inLibrary` undefined
 * and the frontend falls back to a search CTA. Runs one batched DB lookup for
 * the whole list.
 */
async function enrichSimilarItems(
  userId: number,
  albums: DiscoverAlbum[],
  artists: DiscoverArtist[]
): Promise<{
  albums: DiscoverAlbumWithStatus[];
  artists: DiscoverArtistWithStatus[];
}> {
  const lookupItems: Array<{ mbid: string; type: 'ALBUM' | 'ARTIST' }> = [];
  for (const a of albums) {
    if (a.mbid) lookupItems.push({ mbid: a.mbid, type: 'ALBUM' });
  }
  for (const a of artists) {
    if (a.mbid) lookupItems.push({ mbid: a.mbid, type: 'ARTIST' });
  }

  const [statuses, library] = await Promise.all([
    getRequestStatusBatch(userId, lookupItems),
    getLibraryStatusBatch(lookupItems),
  ]);

  const enrichedAlbums = albums.map((a): DiscoverAlbumWithStatus => {
    if (!a.mbid) return { ...a };
    return {
      ...a,
      requestStatus:
        statuses.get(requestStatusKey('ALBUM', a.mbid)) ?? NOT_REQUESTED,
      inLibrary: library.get(libraryStatusKey('ALBUM', a.mbid)) ?? false,
    };
  });
  const enrichedArtists = artists.map((a): DiscoverArtistWithStatus => {
    if (!a.mbid) return { ...a };
    return {
      ...a,
      requestStatus:
        statuses.get(requestStatusKey('ARTIST', a.mbid)) ?? NOT_REQUESTED,
      inLibrary: library.get(libraryStatusKey('ARTIST', a.mbid)) ?? false,
    };
  });

  return { albums: enrichedAlbums, artists: enrichedArtists };
}

export const albumRouter = Router();
albumRouter.use(requireAuth);
albumRouter.use(requireSetupComplete);

albumRouter.get('/:mbid', async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError('Authentication required');
    const userId = req.user.id;

    const parsed = mbidParamSchema.safeParse(req.params);
    if (!parsed.success) {
      throw new ValidationError('mbid is required');
    }
    const { mbid } = parsed.data;

    const album = await musicbrainz.getAlbum(mbid);

    // Look up album (by RG mbid) and artist together in one round-trip.
    const items: Array<{ mbid: string; type: 'ALBUM' | 'ARTIST' }> = [
      { mbid: album.releaseGroupMbid, type: 'ALBUM' },
    ];
    if (album.artistMbid) {
      items.push({ mbid: album.artistMbid, type: 'ARTIST' });
    }
    const [statuses, library] = await Promise.all([
      getRequestStatusBatch(userId, items),
      getLibraryStatusBatch(items),
    ]);

    const requestStatus =
      statuses.get(requestStatusKey('ALBUM', album.releaseGroupMbid)) ??
      NOT_REQUESTED;
    const artistRequestStatus = album.artistMbid
      ? statuses.get(requestStatusKey('ARTIST', album.artistMbid)) ??
        NOT_REQUESTED
      : NOT_REQUESTED;
    const inLibrary =
      library.get(libraryStatusKey('ALBUM', album.releaseGroupMbid)) ?? false;
    const artistInLibrary = album.artistMbid
      ? library.get(libraryStatusKey('ARTIST', album.artistMbid)) ?? false
      : false;

    const body: AlbumDetail = {
      ...album,
      requestStatus,
      artistRequestStatus,
      inLibrary,
      artistInLibrary,
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// "More like this" — albums similar to this one. ListenBrainz primary,
// MusicBrainz fallback, per-source graceful degrade (empty rows, never a 502).
// Cache-Control matches Discover: a short private window to cut flicker on top
// of the clients' own 1h LRU.
albumRouter.get('/:mbid/similar', async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError('Authentication required');
    const userId = req.user.id;

    const parsed = mbidParamSchema.safeParse(req.params);
    if (!parsed.success) {
      throw new ValidationError('mbid is required');
    }
    const { mbid } = parsed.data;

    const similar = await getSimilarAlbums(mbid);
    const { albums } = await enrichSimilarItems(userId, similar, []);

    const body: SimilarAlbumsPayload = { items: albums };
    res.set('Cache-Control', 'private, max-age=300');
    res.json(body);
  } catch (err) {
    next(err);
  }
});

export const artistRouter = Router();
artistRouter.use(requireAuth);
artistRouter.use(requireSetupComplete);

artistRouter.get('/:mbid', async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError('Authentication required');
    const userId = req.user.id;

    const parsed = mbidParamSchema.safeParse(req.params);
    if (!parsed.success) {
      throw new ValidationError('mbid is required');
    }
    const { mbid } = parsed.data;

    const artist = await musicbrainz.getArtist(mbid);
    const releaseGroups = artist.releaseGroups;

    // Cap cover-art fetches; everything else still gets a per-RG status.
    const coverTargets = releaseGroups.slice(0, ARTIST_COVER_ART_CAP);
    const coverPromise = Promise.all(
      coverTargets.map((rg) => musicbrainz.getReleaseGroupCoverArt(rg.mbid))
    );

    const lookupItems: Array<{ mbid: string; type: 'ALBUM' | 'ARTIST' }> = [
      { mbid: artist.mbid, type: 'ARTIST' },
      ...releaseGroups.map((rg) => ({ mbid: rg.mbid, type: 'ALBUM' as const })),
    ];
    const statusesPromise = getRequestStatusBatch(userId, lookupItems);
    const libraryPromise = getLibraryStatusBatch(lookupItems);

    const [covers, statuses, library] = await Promise.all([
      coverPromise,
      statusesPromise,
      libraryPromise,
    ]);

    const enriched: ReleaseGroupWithStatus[] = releaseGroups.map((rg, i) => {
      const out: ReleaseGroupWithStatus = {
        ...rg,
        requestStatus:
          statuses.get(requestStatusKey('ALBUM', rg.mbid)) ?? NOT_REQUESTED,
        inLibrary: library.get(libraryStatusKey('ALBUM', rg.mbid)) ?? false,
      };
      if (i < ARTIST_COVER_ART_CAP) {
        const cover = covers[i];
        if (cover?.frontUrl) out.coverArtUrl = cover.frontUrl;
        else if (cover?.thumbnailUrl) out.coverArtUrl = cover.thumbnailUrl;
      }
      return out;
    });

    const body: ArtistDetail = {
      mbid: artist.mbid,
      name: artist.name,
      sortName: artist.sortName,
      ...(artist.disambiguation !== undefined
        ? { disambiguation: artist.disambiguation }
        : {}),
      ...(artist.country !== undefined ? { country: artist.country } : {}),
      ...(artist.type !== undefined ? { type: artist.type } : {}),
      requestStatus:
        statuses.get(requestStatusKey('ARTIST', artist.mbid)) ?? NOT_REQUESTED,
      inLibrary: library.get(libraryStatusKey('ARTIST', artist.mbid)) ?? false,
      releaseGroups: enriched,
    };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// "Similar artists" — artists similar to this one. ListenBrainz primary,
// MusicBrainz relationships fallback, per-source graceful degrade.
artistRouter.get('/:mbid/similar', async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError('Authentication required');
    const userId = req.user.id;

    const parsed = mbidParamSchema.safeParse(req.params);
    if (!parsed.success) {
      throw new ValidationError('mbid is required');
    }
    const { mbid } = parsed.data;

    const similar = await getSimilarArtists(mbid);
    const { artists } = await enrichSimilarItems(userId, [], similar);

    const body: SimilarArtistsPayload = { items: artists };
    res.set('Cache-Control', 'private, max-age=300');
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// Re-export `getRequestStatus` so consumers that already import this module
// don't need a second import for the helper.
export { getRequestStatus };
