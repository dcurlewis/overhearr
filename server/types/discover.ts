/**
 * Domain types for the Discover landing page. Source-neutral on purpose:
 * v1 was Last.fm-only; v2 mixes ListenBrainz (charts) and MusicBrainz
 * (recent releases). The frontend cards consume these shapes regardless of
 * which upstream produced them.
 *
 * `mbid` is carried verbatim when present so cards can deep-link to the
 * MusicBrainz-backed detail pages. Items without an mbid render with a
 * search-by-name CTA.
 */

export interface DiscoverAlbum {
  /** MusicBrainz release-group id; not always present. */
  mbid?: string;
  name: string;
  artist: string;
  artistMbid?: string;
  imageUrl?: string;
  /** Provider's popularity signal (listens, plays, listeners). Display-only. */
  playcount?: number;
  listeners?: number;
  /** ISO yyyy-mm-dd. Set on "new releases" rows; absent on chart rows. */
  firstReleaseDate?: string;
}

export interface DiscoverArtist {
  mbid?: string;
  name: string;
  imageUrl?: string;
  playcount?: number;
  listeners?: number;
}

export interface DiscoverData {
  topAlbums: DiscoverAlbum[];
  topArtists: DiscoverArtist[];
  newReleases: DiscoverAlbum[];
}
