/**
 * Domain types for the Last.fm client. These are the "clean" shapes the rest
 * of Overhearr consumes — Last.fm's raw JSON is a tag-soup of stringly-typed
 * fields and is normalised inside `server/api/lastfm/index.ts`.
 *
 * `mbid` is carried through verbatim when present so the frontend can deep-link
 * to MusicBrainz-backed detail pages. Many Last.fm rows have no mbid; cards
 * fall back to a search-by-name CTA in that case.
 */

export interface LastfmAlbum {
  /** MusicBrainz release-group id; not always present in Last.fm responses. */
  mbid?: string;
  name: string;
  artist: string;
  artistMbid?: string;
  /** Largest available image URL ("extralarge", falling back through sizes). */
  imageUrl?: string;
  playcount?: number;
  listeners?: number;
}

export interface LastfmArtist {
  mbid?: string;
  name: string;
  imageUrl?: string;
  playcount?: number;
  listeners?: number;
}

/**
 * Aggregate payload powering the Discover landing page. `newReleases` is
 * approximated via `geo.gettopalbums` since Last.fm has no first-party "new
 * releases" feed; v1 hardcodes "United States" and Phase 5b will let the user
 * pick a country.
 */
export interface DiscoverData {
  topAlbums: LastfmAlbum[];
  topArtists: LastfmArtist[];
  newReleases: LastfmAlbum[];
}
