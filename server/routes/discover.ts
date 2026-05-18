/**
 * /api/discover — Discover landing page.
 *
 * Sources (both anonymous, zero-config):
 *   - ListenBrainz `/1/stats/sitewide/release-groups` → topAlbums
 *   - ListenBrainz `/1/stats/sitewide/artists`        → topArtists
 *   - MusicBrainz  release-group search (last 1 month) → newReleases
 *
 * Per-section graceful degradation: if any one upstream blips, that section
 * becomes `[]` and the rest of the page still renders. We never bubble a
 * 502 from one row failing.
 *
 * Request status enrichment is best-effort — only items carrying an mbid
 * can be looked up. Items without an mbid get `requestStatus: undefined`
 * and the frontend falls back to a search-by-name CTA.
 *
 * Cache-Control: `private, max-age=300`. The underlying clients cache for
 * an hour; this just cuts flicker on tab switches.
 */

import { Router } from 'express';

import { listenbrainz } from '../api/listenbrainz';
import { musicbrainz } from '../api/musicbrainz';
import { UnauthorizedError } from '../lib/errors';
import { getLogger } from '../lib/logger';
import { requireAuth, requireSetupComplete } from '../middleware/auth';
import {
  getRequestStatusBatch,
  requestStatusKey,
} from '../services/requestLookupService';
import type { DiscoverAlbum, DiscoverArtist } from '../types/discover';
import type {
  DiscoverAlbumWithStatus,
  DiscoverArtistWithStatus,
  DiscoverPayload,
} from '../../src/types/api';

const log = getLogger('discover');
const ROW_LIMIT = 24;
const NEW_RELEASES_MONTHS_BACK = 1;

export const discoverRouter = Router();

discoverRouter.use(requireAuth);
discoverRouter.use(requireSetupComplete);

async function settle<T>(p: Promise<T[]>, label: string): Promise<T[]> {
  try {
    return await p;
  } catch (err) {
    log.warn({ err, section: label }, 'discover: section failed; degrading to empty');
    return [];
  }
}

discoverRouter.get('/', async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError('Authentication required');
    const userId = req.user.id;

    const [topAlbums, topArtists, newReleases] = await Promise.all([
      settle<DiscoverAlbum>(
        listenbrainz.getTopReleaseGroups({ count: ROW_LIMIT }),
        'topAlbums'
      ),
      settle<DiscoverArtist>(
        listenbrainz.getTopArtists({ count: ROW_LIMIT }),
        'topArtists'
      ),
      settle<DiscoverAlbum>(
        musicbrainz.getRecentReleaseGroups({
          monthsBack: NEW_RELEASES_MONTHS_BACK,
          limit: ROW_LIMIT,
        }),
        'newReleases'
      ),
    ]);

    // Build the lookup batch from rows that carry an mbid.
    const lookupItems: Array<{ mbid: string; type: 'ALBUM' | 'ARTIST' }> = [];
    for (const a of topAlbums) {
      if (a.mbid) lookupItems.push({ mbid: a.mbid, type: 'ALBUM' });
    }
    for (const a of newReleases) {
      if (a.mbid) lookupItems.push({ mbid: a.mbid, type: 'ALBUM' });
    }
    for (const a of topArtists) {
      if (a.mbid) lookupItems.push({ mbid: a.mbid, type: 'ARTIST' });
    }
    const statuses = await getRequestStatusBatch(userId, lookupItems);

    const enrichAlbum = (a: DiscoverAlbum): DiscoverAlbumWithStatus => {
      if (!a.mbid) return { ...a };
      return {
        ...a,
        requestStatus: statuses.get(requestStatusKey('ALBUM', a.mbid)) ?? {
          exists: false,
        },
      };
    };
    const enrichArtist = (a: DiscoverArtist): DiscoverArtistWithStatus => {
      if (!a.mbid) return { ...a };
      return {
        ...a,
        requestStatus: statuses.get(requestStatusKey('ARTIST', a.mbid)) ?? {
          exists: false,
        },
      };
    };

    const body: DiscoverPayload = {
      topAlbums: topAlbums.map(enrichAlbum),
      topArtists: topArtists.map(enrichArtist),
      newReleases: newReleases.map(enrichAlbum),
    };
    res.set('Cache-Control', 'private, max-age=300');
    return res.json(body);
  } catch (err) {
    return next(err);
  }
});

export default discoverRouter;
