/**
 * /api/search — combined album + artist search backed by MusicBrainz.
 *
 * The frontend uses this for the global search bar on every page. Results
 * are enriched per-user with `requestStatus` so cards can render the
 * "Already requested" affordance without a second round-trip.
 *
 * Auth + setup-complete are required: the search experience is part of
 * the post-setup app surface, and we never want a half-configured install
 * to expose this.
 */

import { Router } from 'express';
import { z } from 'zod';

import { musicbrainz } from '../api/musicbrainz';
import { UnauthorizedError, ValidationError } from '../lib/errors';
import { requireAuth, requireSetupComplete } from '../middleware/auth';
import { getRequestStatusBatch, requestStatusKey } from '../services/requestLookupService';
import type {
  AlbumSearchHit,
  ArtistSearchHit,
  RequestStatusInfo,
  SearchResponse,
} from '../../src/types/api';

export const searchRouter = Router();

searchRouter.use(requireAuth);
searchRouter.use(requireSetupComplete);

const searchQuerySchema = z.object({
  q: z
    .string()
    .min(1, 'q is required')
    .max(200, 'q must be at most 200 characters'),
  type: z.enum(['all', 'album', 'artist']).default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const NOT_REQUESTED: RequestStatusInfo = { exists: false };

searchRouter.get('/', async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError('Authentication required');
    const userId = req.user.id;

    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? 'Invalid query parameters'
      );
    }
    const { q, type, limit } = parsed.data;

    const wantAlbums = type === 'all' || type === 'album';
    const wantArtists = type === 'all' || type === 'artist';

    const [albumsRes, artistsRes] = await Promise.all([
      wantAlbums ? musicbrainz.searchAlbums(q, limit) : Promise.resolve(null),
      wantArtists ? musicbrainz.searchArtists(q, limit) : Promise.resolve(null),
    ]);

    const albums = albumsRes?.items ?? [];
    const artists = artistsRes?.items ?? [];

    // Single batched DB lookup for both axes.
    const lookupItems: Array<{ mbid: string; type: 'ALBUM' | 'ARTIST' }> = [];
    for (const a of albums) {
      if (a.releaseGroupMbid) {
        lookupItems.push({ mbid: a.releaseGroupMbid, type: 'ALBUM' });
      }
    }
    for (const a of artists) {
      if (a.mbid) lookupItems.push({ mbid: a.mbid, type: 'ARTIST' });
    }
    const statuses = await getRequestStatusBatch(userId, lookupItems);

    const albumHits: AlbumSearchHit[] = albums.map((a) => ({
      ...a,
      requestStatus:
        statuses.get(requestStatusKey('ALBUM', a.releaseGroupMbid)) ??
        NOT_REQUESTED,
    }));
    const artistHits: ArtistSearchHit[] = artists.map((a) => ({
      ...a,
      requestStatus:
        statuses.get(requestStatusKey('ARTIST', a.mbid)) ?? NOT_REQUESTED,
    }));

    const body: SearchResponse = { albums: albumHits, artists: artistHits };
    res.json(body);
  } catch (err) {
    next(err);
  }
});

export default searchRouter;
