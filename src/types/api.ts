/**
 * Shared API contract types.
 *
 * Lives in `src/` (not `server/`) so that both the Next.js Pages Router
 * frontend and the Express backend can import the same shapes with a single
 * canonical path. The `@/types/api` import works from frontend code;
 * backend route handlers import via the relative path `../../src/types/api`.
 *
 * Domain types (`Album`, `Artist`, `ArtistDetails`, `DiscoverAlbum`, …) are
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
  DiscoverAlbum,
  DiscoverArtist,
  DiscoverData,
} from '../../server/types/discover';
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
  DiscoverAlbum,
  DiscoverArtist,
  DiscoverData,
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

export type DiscoverAlbumWithStatus = DiscoverAlbum & {
  /** Only present when the row carries a usable mbid. */
  requestStatus?: RequestStatusInfo;
};

export type DiscoverArtistWithStatus = DiscoverArtist & {
  requestStatus?: RequestStatusInfo;
};

/**
 * Discover payload. Sourced from ListenBrainz (charts) and MusicBrainz
 * (recent releases) — both are zero-config public APIs, so Discover always
 * has data on a fresh install. Per-section upstream failures degrade to an
 * empty array rather than blanking the whole page.
 */
export interface DiscoverPayload {
  topAlbums: DiscoverAlbumWithStatus[];
  topArtists: DiscoverArtistWithStatus[];
  newReleases: DiscoverAlbumWithStatus[];
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
