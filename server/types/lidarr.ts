/**
 * Domain types exposed by the Lidarr client.
 *
 * These are intentionally narrower than Lidarr's full API surface — only the
 * fields the rest of Overhearr actually consumes are modeled. Anything else
 * is dropped at the client boundary so a Lidarr schema drift can't leak into
 * the request flow or UI.
 *
 * Lidarr uses MusicBrainz release-group MBIDs as `foreignAlbumId` (NOT
 * release MBIDs). Be careful: the rest of the app sometimes deals with
 * release MBIDs. Always pass release-group MBIDs into this client.
 */

export interface LidarrSystemStatus {
  version: string;
  instanceName?: string;
  appData?: string;
}

export interface LidarrRootFolder {
  id: number;
  path: string;
  freeSpace?: number;
  accessible?: boolean;
}

export interface LidarrQualityProfile {
  id: number;
  name: string;
}

export interface LidarrMetadataProfile {
  id: number;
  name: string;
}

export interface LidarrArtist {
  id: number;
  artistName: string;
  /** MusicBrainz artist MBID. */
  foreignArtistId: string;
  monitored: boolean;
  rootFolderPath?: string;
  qualityProfileId?: number;
  metadataProfileId?: number;
}

export interface LidarrAlbum {
  id: number;
  title: string;
  /** MusicBrainz release-group MBID (Lidarr uses RG ids as foreignAlbumId). */
  foreignAlbumId: string;
  artistId: number;
  monitored: boolean;
  anyReleaseOk: boolean;
}

/**
 * Minimal projection of an album-in-library row, used by the librarySync
 * worker. The fields below are everything the worker needs to decide
 * "in library" — we deliberately drop the rest of the album payload at
 * the client boundary so a Lidarr schema drift can't leak into the
 * sync writer.
 */
export interface LidarrLibraryAlbumSummary {
  lidarrAlbumId: number;
  /** MusicBrainz release-group MBID. */
  foreignAlbumId: string;
  lidarrArtistId: number;
  /** MusicBrainz artist MBID. */
  foreignArtistId: string;
}

export type LidarrMonitorOption =
  | 'all'
  | 'future'
  | 'missing'
  | 'existing'
  | 'first'
  | 'latest'
  | 'none';

export interface AddArtistOptions {
  /** MusicBrainz artist MBID. */
  mbid: string;
  rootFolderPath: string;
  qualityProfileId: number;
  metadataProfileId: number;
  /** Use 'all' for "request entire artist", 'none' for album-only adds. */
  monitor: LidarrMonitorOption;
  searchForMissingAlbums: boolean;
}

export interface AddAlbumOptions {
  /** MusicBrainz release-group MBID (the album). */
  mbid: string;
  /** MusicBrainz artist MBID; used to auto-add the artist if absent. */
  artistMbid: string;
  rootFolderPath: string;
  qualityProfileId: number;
  metadataProfileId: number;
  searchForNewAlbum: boolean;
}

export interface LidarrAddAlbumResult {
  album: LidarrAlbum;
  artist: LidarrArtist;
  /** True when the artist was newly added during the addAlbum workflow. */
  artistAdded: boolean;
}

export interface LidarrDownloadStatus {
  downloaded: boolean;
  trackFileCount: number;
  trackCount: number;
}

/**
 * Snapshot of artist-level download progress, used by the Phase 4b
 * reconciliation worker for ARTIST requests. `complete` is true when every
 * monitored album has at least one track file imported.
 */
export interface LidarrArtistDownloadStatus {
  albumCount: number;
  albumFileCount: number;
  complete: boolean;
}
