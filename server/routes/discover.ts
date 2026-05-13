/**
 * /api/discover — Last.fm-backed Discover landing page.
 *
 * Behaviour matrix:
 *   - Last.fm key not configured  → 200 with `{configured:false, ...empty arrays}`.
 *     The frontend renders an empty-state with a "Configure Last.fm" CTA.
 *     We deliberately do NOT bubble the 503 LASTFM_NOT_CONFIGURED here —
 *     "no key yet" is a normal first-run state, not a request failure.
 *   - Last.fm unreachable / invalid key → bubbles to the central error
 *     handler (502). The frontend shows an error toast and a retry.
 *
 * Request status enrichment is best-effort: only items that carry a
 * MusicBrainz id can be looked up. Items without an mbid get
 * `requestStatus: undefined` and the frontend falls back to a search-by-
 * name CTA.
 *
 * Cache-Control: `private, max-age=300` — the underlying client caches
 * Last.fm responses much longer (1h), but a small browser-side hint cuts
 * flicker on tab switches.
 */

import { Router } from 'express';

import { lastfm } from '../api/lastfm';
import { LastfmNotConfiguredError } from '../api/lastfm/errors';
import { UnauthorizedError } from '../lib/errors';
import { requireAuth, requireSetupComplete } from '../middleware/auth';
import { getRequestStatusBatch, requestStatusKey } from '../services/requestLookupService';
import type {
  DiscoverPayload,
  LastfmAlbumWithStatus,
  LastfmArtistWithStatus,
} from '../../src/types/api';

export const discoverRouter = Router();

discoverRouter.use(requireAuth);
discoverRouter.use(requireSetupComplete);

discoverRouter.get('/', async (req, res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError('Authentication required');
    const userId = req.user.id;

    let topAlbums = [] as Awaited<ReturnType<typeof lastfm.getDiscover>>['topAlbums'];
    let topArtists = [] as Awaited<ReturnType<typeof lastfm.getDiscover>>['topArtists'];
    let newReleases = [] as Awaited<ReturnType<typeof lastfm.getDiscover>>['newReleases'];
    let configured = true;

    try {
      const data = await lastfm.getDiscover();
      topAlbums = data.topAlbums;
      topArtists = data.topArtists;
      newReleases = data.newReleases;
    } catch (err) {
      if (err instanceof LastfmNotConfiguredError) {
        configured = false;
      } else {
        throw err;
      }
    }

    if (!configured) {
      const empty: DiscoverPayload = {
        configured: false,
        topAlbums: [],
        topArtists: [],
        newReleases: [],
      };
      res.set('Cache-Control', 'private, max-age=300');
      return res.json(empty);
    }

    // Build the lookup batch from rows that carry an mbid. Albums use the
    // release-group mbid (Last.fm's `mbid` field on top-album rows IS the
    // release-group id by convention).
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

    const enrichAlbum = (a: (typeof topAlbums)[number]): LastfmAlbumWithStatus => {
      if (!a.mbid) return { ...a };
      return {
        ...a,
        requestStatus: statuses.get(requestStatusKey('ALBUM', a.mbid)) ?? {
          exists: false,
        },
      };
    };
    const enrichArtist = (a: (typeof topArtists)[number]): LastfmArtistWithStatus => {
      if (!a.mbid) return { ...a };
      return {
        ...a,
        requestStatus: statuses.get(requestStatusKey('ARTIST', a.mbid)) ?? {
          exists: false,
        },
      };
    };

    const body: DiscoverPayload = {
      configured: true,
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
