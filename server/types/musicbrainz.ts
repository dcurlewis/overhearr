/**
 * Domain types for the MusicBrainz client. These are deliberately small and
 * UI-friendly — the raw MB JSON shapes (with their hyphenated keys and
 * deeply-nested artist credits) live only inside the client, never leak out.
 *
 * `Album` represents a *specific release* (a single MBID), but it carries
 * `releaseGroupMbid` so callers can dedupe multiple pressings of the same
 * canonical "album". Search results are deduped by release-group on the
 * way out.
 */

export interface Artist {
  mbid: string;
  name: string;
  sortName: string;
  disambiguation?: string;
  country?: string;
  type?: string;
}

export type ReleaseGroupPrimaryType = 'Album' | 'Single' | 'EP' | 'Other';

export interface ReleaseGroup {
  mbid: string;
  title: string;
  primaryType?: ReleaseGroupPrimaryType;
  secondaryTypes?: string[];
  firstReleaseDate?: string;
}

export interface Track {
  position: number;
  title: string;
  lengthMs?: number;
  recordingMbid?: string;
}

export interface Album {
  /** MBID of the *release* (a specific pressing). */
  mbid: string;
  /** MBID of the *release-group* (the canonical "album" identifier). */
  releaseGroupMbid: string;
  title: string;
  artistName: string;
  artistMbid: string;
  firstReleaseDate?: string;
  tracks: Track[];
  coverArtUrl?: string;
  thumbnailUrl?: string;
}

export type ArtistDetails = Artist & {
  releaseGroups: ReleaseGroup[];
};

export interface MusicBrainzSearchResult<T> {
  items: T[];
  total: number;
}
