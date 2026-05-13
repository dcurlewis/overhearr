/**
 * Shared API contract types.
 *
 * Lives in `src/` (not `server/`) so that both the Next.js Pages Router
 * frontend (Phase 5+) and the Express backend can import the same shapes
 * with a single canonical path. The `@/types/api` import works from
 * frontend code; backend route handlers import via the relative path
 * `../../src/types/api`.
 *
 * Domain types (`Album`, `Artist`, `ArtistDetails`, `LastfmAlbum`, …) are
 * authored in `server/types/*` because they describe what the upstream
 * clients return. We re-export them here so frontend code never has to
 * reach into `server/`.
 */

import type {
  Album,
  Artist,
  ArtistDetails,
  ReleaseGroup,
  Track,
  MusicBrainzSearchResult,
  ReleaseGroupPrimaryType,
} from '../../server/types/musicbrainz';
import type {
  DiscoverData,
  LastfmAlbum,
  LastfmArtist,
} from '../../server/types/lastfm';
import type { PublicUser, UserRole } from '../../server/types/domain';

// Re-export underlying types so `@/types/api` is a single import surface.
export type {
  Album,
  Artist,
  ArtistDetails,
  ReleaseGroup,
  Track,
  MusicBrainzSearchResult,
  ReleaseGroupPrimaryType,
  DiscoverData,
  LastfmAlbum,
  LastfmArtist,
  PublicUser,
  UserRole,
};

// ---- Setup status ---------------------------------------------------------

export interface SetupStatusResponse {
  setupCompleted: boolean;
  hasAdmin: boolean;
}

// ---- Enums (mirroring server/types/domain.ts) -----------------------------

/** Mirrors `server/types/domain.ts#RequestType`. */
export type RequestTypeValue = 'ALBUM' | 'ARTIST';

/** Mirrors `server/types/domain.ts#RequestStatus`. */
export type RequestStatusValue =
  | 'PENDING'
  | 'PROCESSING'
  | 'AVAILABLE'
  | 'FAILED';

// ---- Per-user request status enrichment -----------------------------------

/**
 * Tells the UI whether *this user* has an outstanding request for a given
 * MBID. The "most recent" row wins (a retry of a FAILED request just bumps
 * the same row's status, but if multiple rows ever exist we surface the
 * latest).
 *
 * `createdAt` is serialised as an ISO 8601 string so it survives JSON
 * round-trips on the wire — the frontend re-parses to Date if needed.
 */
export type RequestStatusInfo =
  | { exists: false }
  | {
      exists: true;
      id: number;
      status: RequestStatusValue;
      type: RequestTypeValue;
      createdAt: string;
    };

// ---- Search response shapes -----------------------------------------------

export type AlbumSearchHit = Album & {
  requestStatus: RequestStatusInfo;
};

export type ArtistSearchHit = Artist & {
  requestStatus: RequestStatusInfo;
};

export interface SearchResponse {
  albums: AlbumSearchHit[];
  artists: ArtistSearchHit[];
}

// ---- Detail response shapes -----------------------------------------------

/**
 * Album detail. Carries both the album-level request status AND the
 * artist-level status so the UI can warn "the entire artist is already on
 * its way" without an extra round-trip.
 */
export type AlbumDetail = Album & {
  requestStatus: RequestStatusInfo;
  artistRequestStatus: RequestStatusInfo;
};

export type ReleaseGroupWithStatus = ReleaseGroup & {
  requestStatus: RequestStatusInfo;
  coverArtUrl?: string;
};

export type ArtistDetail = Omit<ArtistDetails, 'releaseGroups'> & {
  requestStatus: RequestStatusInfo;
  releaseGroups: ReleaseGroupWithStatus[];
};

// ---- Discover --------------------------------------------------------------

export type LastfmAlbumWithStatus = LastfmAlbum & {
  /** Only present when the row carries a usable mbid. */
  requestStatus?: RequestStatusInfo;
};

export type LastfmArtistWithStatus = LastfmArtist & {
  requestStatus?: RequestStatusInfo;
};

/**
 * Discover payload. When `configured` is `false` (Last.fm key not set in
 * Settings), the three list arrays are guaranteed empty — the frontend
 * renders an empty-state with a "Configure Last.fm" CTA. We deliberately
 * return 200 + configured:false rather than 503 because "no key yet" is a
 * normal first-run state, not an error.
 */
export interface DiscoverPayload {
  configured: boolean;
  topAlbums: LastfmAlbumWithStatus[];
  topArtists: LastfmArtistWithStatus[];
  newReleases: LastfmAlbumWithStatus[];
}

// ---- Music request rows ----------------------------------------------------

/**
 * Wire-level shape of a `MusicRequest` row. Date columns are serialized to
 * ISO 8601 strings so JSON round-trips are lossless. The frontend may parse
 * back to Date if it needs to format relative timestamps.
 */
export interface MusicRequestRow {
  id: number;
  userId: number;
  type: RequestTypeValue;
  mbid: string;
  name: string;
  artistName: string | null;
  coverArtUrl: string | null;
  releaseDate: string | null;
  status: RequestStatusValue;
  lidarrAlbumId: number | null;
  lidarrArtistId: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequestListResponse {
  requests: MusicRequestRow[];
  total: number;
}
