/**
 * Production Lidarr client.
 *
 * Replaces the temporary settings adapter from Phase 2b. Designed around
 * Lidarr's well-known operational quirks:
 *
 *  - URL bases vary: users paste `http://lidarr:8686`, `http://lidarr:8686/`,
 *    or even `http://lidarr:8686/api/v1`. We normalize to one shape.
 *  - The metadata server (skyhook → MusicBrainz) is flaky. Lidarr returns
 *    HTTP 200 with `{"message":"Failed to query MusicBrainz..."}` instead of
 *    the expected array. We classify these as
 *    `LidarrMetadataUnavailableError` so Phase 4b can fail-soft.
 *  - The `/artist/lookup` and `/album/lookup` endpoints work better when
 *    given `lidarr:<mbid>` than the bare MBID — but sometimes only the bare
 *    MBID returns a hit. We try both, in that order.
 *  - Adding an album requires the artist to exist locally. addAlbum() will
 *    auto-add the artist with `monitor:'none'` if needed.
 *
 * The class accepts an options bag so tests can shrink timeouts and the
 * artist-list cache TTL.
 */

import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosResponse,
} from 'axios';

import {
  LidarrAlbumNotFoundError,
  LidarrAlreadyExistsError,
  LidarrArtistNotFoundError,
  LidarrAuthError,
  LidarrError,
  LidarrMetadataUnavailableError,
  LidarrUnreachableError,
} from '../../lib/errors';
import { getLogger } from '../../lib/logger';
import type {
  AddAlbumOptions,
  AddArtistOptions,
  LidarrAddAlbumResult,
  LidarrAlbum,
  LidarrArtist,
  LidarrArtistDownloadStatus,
  LidarrDownloadStatus,
  LidarrMetadataProfile,
  LidarrQualityProfile,
  LidarrRootFolder,
  LidarrSystemStatus,
} from '../../types/lidarr';

import type { Logger } from 'pino';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_ARTIST_LIST_CACHE_TTL_MS = 5 * 60 * 1000;
const METADATA_DOWN_HINT = /metadata|skyhook|musicbrainz|failed to query/i;
const ALREADY_EXISTS_HINT =
  /already exists|already been added|exists in database|configured for an existing/i;

export interface LidarrClientOptions {
  url: string;
  apiKey: string;
  /** Default 15s. */
  timeoutMs?: number;
  /** Default 5min. */
  artistListCacheTtlMs?: number;
  /** Inject a child logger (tests). */
  logger?: Logger;
}

/**
 * Normalize a user-supplied base URL: strip trailing slashes and append
 * `/api/v1` if missing (case-insensitive).
 */
export function normalizeLidarrBaseUrl(url: string): string {
  let trimmed = url.trim().replace(/\/+$/, '');
  if (!/\/api\/v1$/i.test(trimmed)) {
    trimmed = `${trimmed}/api/v1`;
  }
  return trimmed;
}

// ---- raw Lidarr response shapes (private) ---------------------------------

interface RawArtist {
  id?: number;
  artistName?: string;
  foreignArtistId?: string;
  monitored?: boolean;
  rootFolderPath?: string;
  qualityProfileId?: number;
  metadataProfileId?: number;
}

interface RawAlbum {
  id?: number;
  title?: string;
  foreignAlbumId?: string;
  artistId?: number;
  monitored?: boolean;
  anyReleaseOk?: boolean;
  artist?: RawArtist;
  statistics?: {
    trackFileCount?: number;
    trackCount?: number;
  };
}

interface RawAlbumLookupItem {
  album?: RawAlbum;
  // Lidarr's /album/lookup sometimes flattens album fields directly.
  id?: number;
  title?: string;
  foreignAlbumId?: string;
  artistId?: number;
  monitored?: boolean;
  anyReleaseOk?: boolean;
  artist?: RawArtist;
}

interface ErrorBody {
  message?: string;
  errors?: unknown;
}

// ---- mappers --------------------------------------------------------------

function mapArtist(raw: RawArtist): LidarrArtist {
  return {
    id: raw.id ?? 0,
    artistName: raw.artistName ?? '',
    foreignArtistId: raw.foreignArtistId ?? '',
    monitored: raw.monitored ?? false,
    rootFolderPath: raw.rootFolderPath,
    qualityProfileId: raw.qualityProfileId,
    metadataProfileId: raw.metadataProfileId,
  };
}

function mapAlbum(raw: RawAlbum): LidarrAlbum {
  return {
    id: raw.id ?? 0,
    title: raw.title ?? '',
    foreignAlbumId: raw.foreignAlbumId ?? '',
    artistId: raw.artistId ?? raw.artist?.id ?? 0,
    monitored: raw.monitored ?? false,
    anyReleaseOk: raw.anyReleaseOk ?? false,
  };
}

// ---- client ---------------------------------------------------------------

export class LidarrClient {
  private readonly axios: AxiosInstance;
  private readonly log: Logger;
  private readonly artistListCacheTtlMs: number;

  // Brief cache of /artist (full library list) — used by status checks
  // (Phase 4b reconciliation) which would otherwise pummel Lidarr.
  private artistListCache: { at: number; data: LidarrArtist[] } | null = null;

  constructor(opts: LidarrClientOptions) {
    this.log = opts.logger ?? getLogger('lidarr');
    this.artistListCacheTtlMs =
      opts.artistListCacheTtlMs ?? DEFAULT_ARTIST_LIST_CACHE_TTL_MS;

    this.axios = axios.create({
      baseURL: normalizeLidarrBaseUrl(opts.url),
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      headers: {
        'X-Api-Key': opts.apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      // We classify status codes ourselves for richer errors.
      validateStatus: () => true,
    });
  }

  // --- Public API ----------------------------------------------------------

  async testConnection(): Promise<LidarrSystemStatus> {
    const data = await this.get<{
      version?: string;
      instanceName?: string;
      appData?: string;
    }>('/system/status');
    this.parseLidarrResponse(data, { expect: 'object' });
    return {
      version: data.version ?? '',
      instanceName: data.instanceName,
      appData: data.appData,
    };
  }

  async getRootFolders(): Promise<LidarrRootFolder[]> {
    const data = await this.get<LidarrRootFolder[]>('/rootfolder');
    this.parseLidarrResponse(data, { expect: 'array' });
    return data.map((r) => ({
      id: r.id,
      path: r.path,
      freeSpace: r.freeSpace,
      accessible: r.accessible,
    }));
  }

  async getQualityProfiles(): Promise<LidarrQualityProfile[]> {
    const data = await this.get<LidarrQualityProfile[]>('/qualityprofile');
    this.parseLidarrResponse(data, { expect: 'array' });
    return data.map((p) => ({ id: p.id, name: p.name }));
  }

  async getMetadataProfiles(): Promise<LidarrMetadataProfile[]> {
    const data = await this.get<LidarrMetadataProfile[]>('/metadataprofile');
    this.parseLidarrResponse(data, { expect: 'array' });
    return data.map((p) => ({ id: p.id, name: p.name }));
  }

  /**
   * Look up an artist via Lidarr's MusicBrainz proxy. Tries the
   * `lidarr:<mbid>` form first (most reliable in practice), falling back to
   * the bare MBID. Returns the first result whose foreignArtistId matches,
   * or null if nothing matches. Metadata-server errors propagate as
   * `LidarrMetadataUnavailableError`.
   */
  async lookupArtist(mbid: string): Promise<LidarrArtist | null> {
    const tryTerm = async (term: string): Promise<LidarrArtist[] | null> => {
      const data = await this.get<RawArtist[]>('/artist/lookup', {
        params: { term },
      });
      // If Lidarr's metadata server is down it returns an object with
      // `message` instead of an array; reclassify.
      this.parseLidarrResponse(data, { expect: 'array' });
      return data.map(mapArtist);
    };

    const prefixed = await tryTerm(`lidarr:${mbid}`);
    const prefHit = prefixed?.find((a) => a.foreignArtistId === mbid);
    if (prefHit) return prefHit;
    if (prefixed && prefixed.length > 0 && !prefHit) {
      // Got results but none matched — try the bare-mbid path too.
    }

    const bare = await tryTerm(mbid);
    const bareHit = bare?.find((a) => a.foreignArtistId === mbid);
    if (bareHit) return bareHit;

    return null;
  }

  /**
   * Look up an album by release-group MBID. Same fallback pattern as
   * lookupArtist. Returns null if neither lookup yields a match.
   */
  async lookupAlbum(mbid: string): Promise<LidarrAlbum | null> {
    const tryTerm = async (term: string): Promise<LidarrAlbum[] | null> => {
      const data = await this.get<RawAlbumLookupItem[]>('/album/lookup', {
        params: { term },
      });
      this.parseLidarrResponse(data, { expect: 'array' });
      const albums: LidarrAlbum[] = [];
      for (const item of data) {
        // Some endpoints flatten, others wrap in `album`.
        const a = item.album ?? (item as RawAlbum);
        if (a && a.foreignAlbumId) albums.push(mapAlbum(a));
      }
      return albums;
    };

    const prefixed = await tryTerm(`lidarr:${mbid}`);
    const prefHit = prefixed?.find((a) => a.foreignAlbumId === mbid);
    if (prefHit) return prefHit;

    const bare = await tryTerm(mbid);
    const bareHit = bare?.find((a) => a.foreignAlbumId === mbid);
    if (bareHit) return bareHit;

    return null;
  }

  /**
   * Look in Lidarr's own library for an artist by MBID. The list is cached
   * for `artistListCacheTtlMs` (default 5min). The cache is invalidated by
   * `addArtist` and `clearCaches`.
   */
  async getArtistByMbid(mbid: string): Promise<LidarrArtist | null> {
    const list = await this.getArtistList();
    return list.find((a) => a.foreignArtistId === mbid) ?? null;
  }

  /**
   * Look in Lidarr's library for an album by MBID. If `artistId` is known
   * we scope the request to that artist (cheaper); otherwise we fetch all
   * albums.
   */
  async getAlbumByMbid(
    mbid: string,
    artistId?: number
  ): Promise<LidarrAlbum | null> {
    const params = artistId ? { artistId } : {};
    const data = await this.get<RawAlbum[]>('/album', { params });
    this.parseLidarrResponse(data, { expect: 'array' });
    const hit = data.find((a) => a.foreignAlbumId === mbid);
    return hit ? mapAlbum(hit) : null;
  }

  /**
   * Add an artist to Lidarr's library. First does a `lookupArtist(mbid)` to
   * populate `artistName` and the other inferred fields the POST requires;
   * if that yields nothing, throws `LidarrArtistNotFoundError`. On a 400
   * containing "already exists", throws `LidarrAlreadyExistsError`.
   */
  async addArtist(opts: AddArtistOptions): Promise<LidarrArtist> {
    const found = await this.lookupArtist(opts.mbid);
    if (!found) {
      throw new LidarrArtistNotFoundError(
        `Lidarr could not resolve artist ${opts.mbid}`
      );
    }

    const body = {
      artistName: found.artistName,
      foreignArtistId: opts.mbid,
      monitored: true,
      rootFolderPath: opts.rootFolderPath,
      qualityProfileId: opts.qualityProfileId,
      metadataProfileId: opts.metadataProfileId,
      monitorNewItems: opts.monitor,
      addOptions: {
        monitor: opts.monitor,
        searchForMissingAlbums: opts.searchForMissingAlbums,
      },
    };

    const data = await this.post<RawArtist>('/artist', body);
    // Adding an artist invalidates our cached library list.
    this.artistListCache = null;
    return mapArtist(data);
  }

  /**
   * End-to-end "request this album" workflow:
   *   1. Ensure the artist exists in Lidarr's library (auto-add as
   *      monitor:'none' if missing — matching Overseerr UX where the album
   *      add implies fetching the parent artist record).
   *   2. Resolve the album via Lidarr's metadata lookup.
   *   3. POST it.
   * Returns the new album, the (existing or newly-added) artist, and
   * `artistAdded` so callers can surface "we also added this artist".
   */
  async addAlbum(opts: AddAlbumOptions): Promise<LidarrAddAlbumResult> {
    let artist = await this.getArtistByMbid(opts.artistMbid);
    let artistAdded = false;
    if (!artist) {
      artist = await this.addArtist({
        mbid: opts.artistMbid,
        rootFolderPath: opts.rootFolderPath,
        qualityProfileId: opts.qualityProfileId,
        metadataProfileId: opts.metadataProfileId,
        monitor: 'none',
        searchForMissingAlbums: false,
      });
      artistAdded = true;
    }

    const albumLookup = await this.lookupAlbum(opts.mbid);
    if (!albumLookup) {
      throw new LidarrAlbumNotFoundError(
        `Lidarr could not resolve album ${opts.mbid}`
      );
    }

    const body = {
      foreignAlbumId: opts.mbid,
      title: albumLookup.title,
      artistId: artist.id,
      monitored: true,
      anyReleaseOk: true,
      addOptions: {
        searchForNewAlbum: opts.searchForNewAlbum,
      },
    };

    const data = await this.post<RawAlbum>('/album', body);
    return { album: mapAlbum(data), artist, artistAdded };
  }

  /** Trigger Lidarr's "search for this artist" command. Used by Phase 4b retry flow. */
  async triggerArtistSearch(artistId: number): Promise<void> {
    await this.post('/command', { name: 'ArtistSearch', artistId });
  }

  /**
   * Snapshot album download progress. Album is "downloaded" when
   * `trackFileCount >= trackCount && trackCount > 0`.
   */
  async getDownloadStatus(albumId: number): Promise<LidarrDownloadStatus> {
    const data = await this.get<RawAlbum>(`/album/${albumId}`);
    this.parseLidarrResponse(data, { expect: 'object' });
    const trackFileCount = data.statistics?.trackFileCount ?? 0;
    const trackCount = data.statistics?.trackCount ?? 0;
    return {
      trackFileCount,
      trackCount,
      downloaded: trackCount > 0 && trackFileCount >= trackCount,
    };
  }

  /**
   * Snapshot artist-level download progress. Used by the Phase 4b
   * reconciliation worker for ARTIST requests. `complete` is true when at
   * least one album has been imported and `albumFileCount >= albumCount`.
   */
  async getArtistDownloadStatus(
    artistId: number
  ): Promise<LidarrArtistDownloadStatus> {
    interface RawArtistWithStats {
      id?: number;
      statistics?: { albumCount?: number; albumFileCount?: number };
    }
    const data = await this.get<RawArtistWithStats>(`/artist/${artistId}`);
    this.parseLidarrResponse(data, { expect: 'object' });
    const albumCount = data.statistics?.albumCount ?? 0;
    const albumFileCount = data.statistics?.albumFileCount ?? 0;
    return {
      albumCount,
      albumFileCount,
      complete: albumCount > 0 && albumFileCount >= albumCount,
    };
  }

  /** Test-only: drop in-memory caches. */
  clearCaches(): void {
    this.artistListCache = null;
  }

  // --- Internals -----------------------------------------------------------

  private async getArtistList(): Promise<LidarrArtist[]> {
    const cached = this.artistListCache;
    if (cached && Date.now() - cached.at < this.artistListCacheTtlMs) {
      return cached.data;
    }
    const data = await this.get<RawArtist[]>('/artist');
    this.parseLidarrResponse(data, { expect: 'array' });
    const mapped = data.map(mapArtist);
    this.artistListCache = { at: Date.now(), data: mapped };
    return mapped;
  }

  /**
   * Heuristic guard against Lidarr's "200 with error body" shape.
   *
   * - When the caller expects an array and gets an object with a `message`
   *   field, classify as metadata-down (the most common cause is an upstream
   *   skyhook/MusicBrainz fault).
   * - When the caller expects an object but the body has only an `errors`
   *   field at the root, also treat as metadata error.
   *
   * False positives are unlikely: Lidarr's normal payloads either are arrays
   * or are objects whose `message` field, when present, is part of richer
   * payload (and they don't return `{message}` alone for healthy responses).
   */
  private parseLidarrResponse(
    data: unknown,
    opts: { expect: 'array' | 'object' }
  ): void {
    if (opts.expect === 'array') {
      if (Array.isArray(data)) return;
      if (data && typeof data === 'object') {
        const body = data as ErrorBody;
        if (typeof body.message === 'string') {
          throw this.classifyBodyMessage(body.message);
        }
        if (body.errors !== undefined) {
          throw new LidarrMetadataUnavailableError(
            'Lidarr returned an error envelope where an array was expected'
          );
        }
      }
      throw new LidarrError('Lidarr returned an unexpected non-array response');
    }
    // expect === 'object'
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const body = data as ErrorBody;
      const keys = Object.keys(body);
      // Only-message bodies are an error envelope.
      if (
        typeof body.message === 'string' &&
        keys.length <= 2 &&
        keys.every((k) => k === 'message' || k === 'description')
      ) {
        throw this.classifyBodyMessage(body.message);
      }
      return;
    }
    throw new LidarrError('Lidarr returned an unexpected response');
  }

  private classifyBodyMessage(message: string): Error {
    if (METADATA_DOWN_HINT.test(message)) {
      return new LidarrMetadataUnavailableError(message);
    }
    if (ALREADY_EXISTS_HINT.test(message)) {
      return new LidarrAlreadyExistsError(message);
    }
    return new LidarrMetadataUnavailableError(message);
  }

  private async get<T>(
    path: string,
    config?: { params?: Record<string, unknown> }
  ): Promise<T> {
    return this.run<T>(() => this.axios.get<T>(path, config), path);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.run<T>(() => this.axios.post<T>(path, body), path);
  }

  private async run<T>(
    fn: () => Promise<AxiosResponse<T>>,
    path: string
  ): Promise<T> {
    let res: AxiosResponse<T>;
    try {
      res = await fn();
    } catch (err) {
      throw this.classifyAxiosError(err, path);
    }
    if (res.status >= 200 && res.status < 300) {
      return res.data;
    }
    throw this.classifyHttpStatus(res.status, res.data, path);
  }

  private classifyAxiosError(err: unknown, path: string): Error {
    if (axios.isAxiosError(err)) {
      const ax = err as AxiosError;
      const code = ax.code;
      if (
        code === 'ECONNREFUSED' ||
        code === 'ETIMEDOUT' ||
        code === 'ECONNABORTED' ||
        code === 'ENOTFOUND' ||
        code === 'EAI_AGAIN' ||
        !ax.response
      ) {
        const reason =
          code === 'ECONNABORTED' || code === 'ETIMEDOUT'
            ? 'timeout'
            : ax.message;
        return new LidarrUnreachableError(`Lidarr is unreachable: ${reason}`);
      }
      return this.classifyHttpStatus(ax.response.status, ax.response.data, path);
    }
    this.log.warn({ err, path }, 'lidarr: unknown error');
    return new LidarrError(err instanceof Error ? err.message : 'Unknown error');
  }

  private classifyHttpStatus(
    status: number,
    data: unknown,
    path: string
  ): Error {
    const body = (data && typeof data === 'object' ? (data as ErrorBody) : {}) as ErrorBody;
    const message = typeof body.message === 'string' ? body.message : '';

    if (status === 401 || status === 403) {
      return new LidarrAuthError(
        message || 'Lidarr rejected the API key (auth failed)'
      );
    }
    if (status === 400 && ALREADY_EXISTS_HINT.test(message)) {
      return new LidarrAlreadyExistsError(message);
    }
    if (status === 400 && METADATA_DOWN_HINT.test(message)) {
      return new LidarrMetadataUnavailableError(message);
    }
    if (status === 404) {
      // Caller-specific NotFound chosen by /artist or /album path prefix.
      if (path.includes('/album')) {
        return new LidarrAlbumNotFoundError(message || `Lidarr 404 at ${path}`);
      }
      if (path.includes('/artist')) {
        return new LidarrArtistNotFoundError(message || `Lidarr 404 at ${path}`);
      }
      return new LidarrError(`Lidarr 404 at ${path}`);
    }
    if (status >= 500 && message && METADATA_DOWN_HINT.test(message)) {
      return new LidarrMetadataUnavailableError(message);
    }
    return new LidarrError(
      message ? `Lidarr HTTP ${status}: ${message}` : `Lidarr HTTP ${status}`
    );
  }
}
