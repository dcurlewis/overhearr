/**
 * similarService — "More like this" (album) and "Similar artists" (artist)
 * recommendations for the detail pages.
 *
 * Source strategy mirrors the issue's recommendation: **ListenBrainz primary,
 * MusicBrainz fallback**.
 *
 *   - Similar artists: ListenBrainz Labs collaborative-filtering
 *     (`listenbrainz.getSimilarArtists`) is the primary source. If it degrades
 *     (network / non-2xx / empty), we fall back to MusicBrainz artist-artist
 *     relationships (`musicbrainz.getRelatedArtists`).
 *   - Similar albums ("more like this"): there is no first-class album-to-album
 *     similarity feed on either upstream, so we derive it from the album's
 *     *artist* — take that artist's similar artists, then surface one
 *     representative recent album per similar artist (with cover art). This
 *     keeps every card a real, requestable release-group.
 *
 * Per-source graceful degradation: any upstream failure degrades to `[]` and is
 * logged, never bubbled. The route layer adds request-status / in-library
 * enrichment on top (same as Discover).
 *
 * Caching: the underlying clients already LRU-cache aggressively (ListenBrainz
 * 1h, MusicBrainz detail 1h), which is exactly the "recommendations don't change
 * minute-to-minute" property the issue asks for. We deliberately do NOT add a
 * second cache layer here — that would just double the staleness window and the
 * memory churn for no benefit. Integration tests must therefore clear the
 * client caches in `afterEach` (see CLAUDE.md).
 */

import { listenbrainz } from '../api/listenbrainz';
import { musicbrainz } from '../api/musicbrainz';
import { getLogger } from '../lib/logger';
import type { DiscoverAlbum, DiscoverArtist } from '../types/discover';

const log = getLogger('similar');

/** Default number of similar-artist cards to surface. */
const DEFAULT_ARTIST_LIMIT = 12;
/** Default number of "more like this" album cards to surface. */
const DEFAULT_ALBUM_LIMIT = 9;
/**
 * How many similar artists to consider when deriving album recommendations.
 * We over-fetch slightly because some artists yield no usable album (no
 * Album-typed release-group), and dedupe/cap to the album limit afterwards.
 */
const ALBUM_SOURCE_ARTIST_FANOUT = 12;

/**
 * Similar artists for one artist MBID. ListenBrainz primary, MusicBrainz
 * relationships fallback. Returns un-enriched cards; the route adds status.
 */
export async function getSimilarArtists(
  artistMbid: string,
  limit = DEFAULT_ARTIST_LIMIT
): Promise<DiscoverArtist[]> {
  const primary = await settle(
    () => listenbrainz.getSimilarArtists(artistMbid, { count: limit }),
    'listenbrainz.similarArtists'
  );
  if (primary.length > 0) return primary.slice(0, limit);

  // Fallback: MusicBrainz artist relationships. Returns `Artist` (mbid/name/
  // sortName); map to the source-neutral DiscoverArtist card shape.
  const fallback = await settle(
    () => musicbrainz.getRelatedArtists(artistMbid, { limit }),
    'musicbrainz.relatedArtists'
  );
  return fallback
    .map((a) => ({ mbid: a.mbid, name: a.name }))
    .slice(0, limit);
}

/**
 * "More like this" albums for one album. We resolve the album's artist, take
 * that artist's similar artists, then surface one representative album per
 * similar artist (most recent Album-typed release-group, with cover art).
 *
 * `albumMbid` may be a release or release-group MBID — `musicbrainz.getAlbum`
 * already normalises both.
 */
export async function getSimilarAlbums(
  albumMbid: string,
  limit = DEFAULT_ALBUM_LIMIT
): Promise<DiscoverAlbum[]> {
  // Resolve the seed album so we know its artist and can exclude the seed's
  // own release-group from the results.
  const album = await settle(
    () => musicbrainz.getAlbum(albumMbid).then((a) => [a]),
    'musicbrainz.getAlbum(seed)'
  );
  const seed = album[0];
  if (!seed?.artistMbid) return [];

  const similarArtists = await getSimilarArtists(
    seed.artistMbid,
    ALBUM_SOURCE_ARTIST_FANOUT
  );
  if (similarArtists.length === 0) return [];

  // For each similar artist, pick a representative album. Run in parallel;
  // per-artist failures degrade to "skip this artist".
  const picks = await Promise.all(
    similarArtists
      .filter((a): a is DiscoverArtist & { mbid: string } => Boolean(a.mbid))
      .map((a) => pickRepresentativeAlbum(a.mbid, a.name))
  );

  const out: DiscoverAlbum[] = [];
  const seenRg = new Set<string>([seed.releaseGroupMbid]);
  for (const pick of picks) {
    if (!pick?.mbid) continue;
    if (seenRg.has(pick.mbid)) continue;
    seenRg.add(pick.mbid);
    out.push(pick);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * The newest Album-typed release-group for an artist, as a DiscoverAlbum card
 * with cover art. Returns undefined when the artist has no usable album.
 */
async function pickRepresentativeAlbum(
  artistMbid: string,
  artistName: string
): Promise<DiscoverAlbum | undefined> {
  const details = await settle(
    () => musicbrainz.getArtist(artistMbid).then((d) => [d]),
    'musicbrainz.getArtist(similar)'
  );
  const artist = details[0];
  if (!artist) return undefined;

  // getArtist already filters to Album-typed RGs and sorts newest-first.
  const rg = artist.releaseGroups[0];
  if (!rg) return undefined;

  const cover = await musicbrainz.getReleaseGroupCoverArt(rg.mbid);
  const card: DiscoverAlbum = {
    mbid: rg.mbid,
    name: rg.title,
    artist: artist.name || artistName,
    artistMbid: artist.mbid,
  };
  if (cover.frontUrl ?? cover.thumbnailUrl) {
    card.imageUrl = cover.frontUrl ?? cover.thumbnailUrl;
  }
  if (rg.firstReleaseDate) card.firstReleaseDate = rg.firstReleaseDate;
  return card;
}

/**
 * Run an async source, degrading any thrown error to an empty array (logged).
 * Mirrors the Discover route's `settle()` but at the service layer so both the
 * album and artist surfaces share one definition.
 */
async function settle<T>(
  run: () => Promise<T[]>,
  label: string
): Promise<T[]> {
  try {
    return await run();
  } catch (err) {
    log.warn({ err, source: label }, 'similar: source failed; degrading to empty');
    return [];
  }
}
