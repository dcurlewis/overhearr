/**
 * Last.fm API client.
 *
 * Powers the Discover landing page (top albums, top artists, geo-based
 * "new releases" approximation). Designed to degrade gracefully:
 *
 *   - Key not configured            → throws `LastfmNotConfiguredError` (503).
 *                                     Frontend interprets this as "show empty
 *                                     state with Configure CTA".
 *   - Single Discover section fails → that section becomes `[]`, the others
 *                                     still render. We never blow up the page
 *                                     because one chart endpoint flaked.
 *
 * The API key is fetched lazily via an `apiKeyProvider` callback every time
 * a method runs. Caching the key in the client would mean stale state after
 * an admin updates Settings — `settingsService` has its own in-memory cache
 * and we defer to it as the single source of truth.
 *
 * Last.fm error responses come back with HTTP 200 and an in-body `error`
 * code (yes, really). We must inspect the body before treating a 200 as
 * success.
 */

import axios, { type AxiosError, type AxiosInstance } from 'axios';
import { LRUCache } from 'lru-cache';

import { settingsService } from '../../services/settingsService';
import type {
  DiscoverData,
  LastfmAlbum,
  LastfmArtist,
} from '../../types/lastfm';
import { logger } from '../../lib/logger';
import {
  LastfmInvalidKeyError,
  LastfmNotConfiguredError,
  LastfmUnreachableError,
} from './errors';

const DEFAULT_BASE_URL = 'https://ws.audioscrobbler.com/2.0/';
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h
const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_GEO_COUNTRY = 'United States';
const LASTFM_INVALID_KEY_CODE = 10;

// ---- raw Last.fm shapes ---------------------------------------------------
// Only the fields we actually consume; everything else is intentionally typed
// as `unknown`-equivalent (optional + loosely typed) so a Last.fm schema drift
// is a `mbid: undefined` on a single card instead of a runtime crash.

interface RawImage {
  '#text'?: string;
  size?: 'small' | 'medium' | 'large' | 'extralarge' | 'mega' | string;
}

interface RawAlbum {
  mbid?: string;
  name?: string;
  artist?: string | { name?: string; mbid?: string; '#text'?: string };
  image?: RawImage[];
  playcount?: string | number;
  listeners?: string | number;
}

interface RawArtist {
  mbid?: string;
  name?: string;
  image?: RawImage[];
  playcount?: string | number;
  listeners?: string | number;
}

interface ChartTopAlbumsResponse {
  topalbums?: { album?: RawAlbum[] };
  error?: number;
  message?: string;
}

interface ChartTopArtistsResponse {
  artists?: { artist?: RawArtist[] };
  error?: number;
  message?: string;
}

interface GeoTopAlbumsResponse {
  topalbums?: { album?: RawAlbum[] };
  error?: number;
  message?: string;
}

// ---- helpers --------------------------------------------------------------

function pickImage(images?: RawImage[]): string | undefined {
  if (!images || images.length === 0) return undefined;
  const order = ['mega', 'extralarge', 'large', 'medium', 'small'];
  for (const size of order) {
    const hit = images.find((i) => i.size === size && i['#text']);
    if (hit && hit['#text']) return hit['#text'];
  }
  // Fallback: any non-empty url at all.
  const any = images.find((i) => i['#text']);
  return any?.['#text'] || undefined;
}

function toNumber(v: string | number | undefined): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function emptyToUndef(s: string | undefined): string | undefined {
  if (!s) return undefined;
  return s.trim().length === 0 ? undefined : s;
}

function normaliseAlbum(raw: RawAlbum): LastfmAlbum {
  let artistName = '';
  let artistMbid: string | undefined;
  if (typeof raw.artist === 'string') {
    artistName = raw.artist;
  } else if (raw.artist && typeof raw.artist === 'object') {
    artistName = raw.artist.name ?? raw.artist['#text'] ?? '';
    artistMbid = emptyToUndef(raw.artist.mbid);
  }
  return {
    mbid: emptyToUndef(raw.mbid),
    name: raw.name ?? '',
    artist: artistName,
    artistMbid,
    imageUrl: pickImage(raw.image),
    playcount: toNumber(raw.playcount),
    listeners: toNumber(raw.listeners),
  };
}

function normaliseArtist(raw: RawArtist): LastfmArtist {
  return {
    mbid: emptyToUndef(raw.mbid),
    name: raw.name ?? '',
    imageUrl: pickImage(raw.image),
    playcount: toNumber(raw.playcount),
    listeners: toNumber(raw.listeners),
  };
}

// ---- client ---------------------------------------------------------------

export interface LastfmClientOptions {
  apiKeyProvider: () => Promise<string | null>;
  baseUrl?: string;
  cacheTtlMs?: number;
  cacheMax?: number;
  timeoutMs?: number;
}

export class LastfmClient {
  private readonly apiKeyProvider: () => Promise<string | null>;
  private readonly axios: AxiosInstance;
  private readonly cache: LRUCache<string, object>;

  constructor(opts: LastfmClientOptions) {
    this.apiKeyProvider = opts.apiKeyProvider;
    this.axios = axios.create({
      baseURL: opts.baseUrl ?? DEFAULT_BASE_URL,
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      headers: { Accept: 'application/json' },
    });
    this.cache = new LRUCache<string, object>({
      max: opts.cacheMax ?? DEFAULT_MAX_ENTRIES,
      ttl: opts.cacheTtlMs ?? DEFAULT_TTL_MS,
    });
  }

  /** Test-only: forget cached responses. */
  clearCache(): void {
    this.cache.clear();
  }

  // ---- public methods -----------------------------------------------------

  async getTopAlbums(limit = 24): Promise<LastfmAlbum[]> {
    return this.cached(`getTopAlbums:${limit}`, async () => {
      const data = await this.call<ChartTopAlbumsResponse>('chart.gettopalbums', {
        limit: String(limit),
      });
      const list = data.topalbums?.album ?? [];
      return list.map(normaliseAlbum);
    });
  }

  async getTopArtists(limit = 24): Promise<LastfmArtist[]> {
    return this.cached(`getTopArtists:${limit}`, async () => {
      const data = await this.call<ChartTopArtistsResponse>('chart.gettopartists', {
        limit: String(limit),
      });
      const list = data.artists?.artist ?? [];
      return list.map(normaliseArtist);
    });
  }

  async getGeoTopAlbums(
    country: string = DEFAULT_GEO_COUNTRY,
    limit = 24
  ): Promise<LastfmAlbum[]> {
    return this.cached(`getGeoTopAlbums:${country}:${limit}`, async () => {
      const data = await this.call<GeoTopAlbumsResponse>('geo.gettopalbums', {
        country,
        limit: String(limit),
      });
      const list = data.topalbums?.album ?? [];
      return list.map(normaliseAlbum);
    });
  }

  /**
   * Aggregate Discover payload. The configured-check still throws (rendering
   * a single, unambiguous "Configure CTA" empty state) but per-section
   * upstream failures are swallowed to `[]` so a flaky chart endpoint can't
   * blank the entire page.
   */
  async getDiscover(): Promise<DiscoverData> {
    // Fail fast if unconfigured — no point firing three requests.
    const key = await this.apiKeyProvider();
    if (!key) throw new LastfmNotConfiguredError();

    const settle = async <T>(p: Promise<T[]>, label: string): Promise<T[]> => {
      try {
        return await p;
      } catch (err) {
        if (err instanceof LastfmNotConfiguredError) throw err;
        logger.warn(
          { err, section: label },
          'lastfm: discover section failed; degrading to empty'
        );
        return [];
      }
    };

    const [topAlbums, topArtists, newReleases] = await Promise.all([
      settle(this.getTopAlbums(), 'topAlbums'),
      settle(this.getTopArtists(), 'topArtists'),
      settle(this.getGeoTopAlbums(), 'newReleases'),
    ]);
    return { topAlbums, topArtists, newReleases };
  }

  // ---- internals ----------------------------------------------------------

  private async cached<T extends object>(
    key: string,
    run: () => Promise<T>
  ): Promise<T> {
    const hit = this.cache.get(key) as T | undefined;
    if (hit !== undefined) return hit;
    const result = await run();
    this.cache.set(key, result);
    return result;
  }

  private async call<T extends { error?: number; message?: string }>(
    method: string,
    params: Record<string, string>
  ): Promise<T> {
    const apiKey = await this.apiKeyProvider();
    if (!apiKey) throw new LastfmNotConfiguredError();

    let res;
    try {
      res = await this.axios.get<T>('', {
        params: {
          method,
          api_key: apiKey,
          format: 'json',
          ...params,
        },
      });
    } catch (err) {
      const ax = err as AxiosError;
      throw new LastfmUnreachableError(
        `Last.fm request failed: ${ax.message ?? 'network error'}`
      );
    }

    const data = res.data;
    if (data && typeof data.error === 'number') {
      if (data.error === LASTFM_INVALID_KEY_CODE) {
        throw new LastfmInvalidKeyError(data.message ?? 'Invalid API key');
      }
      throw new LastfmUnreachableError(
        `Last.fm error ${data.error}: ${data.message ?? 'unknown'}`
      );
    }
    return data;
  }
}

// ---- singleton ------------------------------------------------------------

/**
 * App-wide Last.fm client. The `apiKeyProvider` reads the latest decrypted
 * key from settings on every call so admin updates take effect immediately.
 */
export const lastfm = new LastfmClient({
  apiKeyProvider: () => settingsService.getDecryptedLastfmKey(),
});
