/**
 * ListenBrainz client.
 *
 * Powers the Top Albums / Top Artists rows on Discover. ListenBrainz sitewide
 * stats are anonymous (https://listenbrainz.readthedocs.io/) — no API key,
 * just a polite User-Agent. That is why this client has no `apiKeyProvider`
 * the way the old Last.fm client did, and no "not configured" error state:
 * Discover is zero-config out of the box.
 *
 * Two endpoints in use:
 *   GET /1/stats/sitewide/release-groups  → top albums by listens in a window
 *   GET /1/stats/sitewide/artists         → top artists by listens in a window
 *
 * Cover art comes for free via the `caa_id` / `caa_release_mbid` fields the
 * release-groups endpoint returns; we never need a separate Cover Art Archive
 * round-trip on the happy path.
 *
 * Errors: every upstream failure (network, non-2xx, malformed body) surfaces
 * as `ListenBrainzUnreachableError`. The Discover route's per-section
 * `settle()` swallows that to `[]` so a flaky upstream cannot blank the page.
 */

import https from 'https';

import axios, { type AxiosError, type AxiosInstance } from 'axios';
import { LRUCache } from 'lru-cache';

import { getLogger } from '../../lib/logger';
import type { DiscoverAlbum, DiscoverArtist } from '../../types/discover';
import { ListenBrainzUnreachableError } from './errors';

const DEFAULT_BASE_URL = 'https://api.listenbrainz.org';
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h
const DEFAULT_MAX_ENTRIES = 64;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RANGE: ListenBrainzRange = 'month';
const CAA_BASE = 'https://coverartarchive.org/release';

const log = getLogger('listenbrainz');

// ListenBrainz time windows. Documented set; we expose only the ones that
// make sense for a "Discover" surface. `month` is the default — `week` is
// jumpier and `all_time` is dominated by historic catalogue.
export type ListenBrainzRange =
  | 'this_week'
  | 'this_month'
  | 'this_year'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year';

// ---- raw API shapes -------------------------------------------------------

interface RawReleaseGroup {
  release_group_name?: string;
  release_group_mbid?: string;
  artist_name?: string;
  artist_mbids?: string[];
  listen_count?: number;
  caa_id?: number;
  caa_release_mbid?: string;
}

interface RawArtist {
  artist_name?: string;
  artist_mbid?: string;
  listen_count?: number;
}

interface ReleaseGroupsResponse {
  payload?: {
    release_groups?: RawReleaseGroup[];
  };
}

interface ArtistsResponse {
  payload?: {
    artists?: RawArtist[];
  };
}

// ---- helpers --------------------------------------------------------------

function emptyToUndef(s: string | undefined): string | undefined {
  if (!s) return undefined;
  return s.trim().length === 0 ? undefined : s;
}

function caaUrl(rgRow: RawReleaseGroup): string | undefined {
  // The CAA ID + release MBID combination yields a stable thumbnail URL. We
  // pick `250` as a reasonable card size; the page's <Image> component handles
  // the device-pixel resize from there.
  if (!rgRow.caa_id || !rgRow.caa_release_mbid) return undefined;
  return `${CAA_BASE}/${rgRow.caa_release_mbid}/${rgRow.caa_id}-250.jpg`;
}

function normaliseReleaseGroup(raw: RawReleaseGroup): DiscoverAlbum {
  return {
    mbid: emptyToUndef(raw.release_group_mbid),
    name: raw.release_group_name ?? '',
    artist: raw.artist_name ?? '',
    artistMbid: emptyToUndef(raw.artist_mbids?.[0]),
    imageUrl: caaUrl(raw),
    playcount:
      typeof raw.listen_count === 'number' && Number.isFinite(raw.listen_count)
        ? raw.listen_count
        : undefined,
  };
}

function normaliseArtist(raw: RawArtist): DiscoverArtist {
  return {
    mbid: emptyToUndef(raw.artist_mbid),
    name: raw.artist_name ?? '',
    playcount:
      typeof raw.listen_count === 'number' && Number.isFinite(raw.listen_count)
        ? raw.listen_count
        : undefined,
  };
}

// ---- client ---------------------------------------------------------------

export interface ListenBrainzClientOptions {
  baseUrl?: string;
  cacheTtlMs?: number;
  cacheMax?: number;
  timeoutMs?: number;
  /** Override the User-Agent (mainly for tests). */
  userAgent?: string;
}

export class ListenBrainzClient {
  private readonly axios: AxiosInstance;
  private readonly cache: LRUCache<string, object>;

  constructor(opts: ListenBrainzClientOptions = {}) {
    // IPv4-only HTTPS agent. ListenBrainz hosts behind a CDN that has the same
    // long-standing dual-stack flakiness as MusicBrainz on some networks (some
    // POPs route badly over v6 and time out). Curl and the test fakes always
    // resolve to v4, but Node's default dual-stack lookup hits whichever AAAA
    // record DNS hands back. Pinning to v4 makes prod behavior match what we
    // tested.
    const httpsAgent = new https.Agent({
      family: 4,
      keepAlive: true,
      rejectUnauthorized: true,
    });
    this.axios = axios.create({
      baseURL: opts.baseUrl ?? DEFAULT_BASE_URL,
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      httpsAgent,
      headers: {
        Accept: 'application/json',
        ...(opts.userAgent ? { 'User-Agent': opts.userAgent } : {}),
      },
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

  async getTopReleaseGroups(
    options: { range?: ListenBrainzRange; count?: number } = {}
  ): Promise<DiscoverAlbum[]> {
    const range = options.range ?? DEFAULT_RANGE;
    const count = options.count ?? 24;
    return this.cached(`getTopReleaseGroups:${range}:${count}`, async () => {
      const data = await this.call<ReleaseGroupsResponse>(
        '/1/stats/sitewide/release-groups',
        { range, count: String(count) }
      );
      const list = data.payload?.release_groups ?? [];
      return list.map(normaliseReleaseGroup).filter((a) => a.name.length > 0);
    });
  }

  async getTopArtists(
    options: { range?: ListenBrainzRange; count?: number } = {}
  ): Promise<DiscoverArtist[]> {
    const range = options.range ?? DEFAULT_RANGE;
    const count = options.count ?? 24;
    return this.cached(`getTopArtists:${range}:${count}`, async () => {
      const data = await this.call<ArtistsResponse>(
        '/1/stats/sitewide/artists',
        { range, count: String(count) }
      );
      const list = data.payload?.artists ?? [];
      return list.map(normaliseArtist).filter((a) => a.name.length > 0);
    });
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

  private async call<T>(
    pathSegment: string,
    params: Record<string, string>
  ): Promise<T> {
    try {
      const res = await this.axios.get<T>(pathSegment, { params });
      // ListenBrainz returns 200 with a JSON envelope on success; non-2xx
      // means trouble. axios default validateStatus already throws on 4xx/5xx,
      // but we belt-and-brace here in case that's overridden upstream.
      if (res.status < 200 || res.status >= 300) {
        throw new ListenBrainzUnreachableError(
          `ListenBrainz returned ${res.status} for ${pathSegment}`
        );
      }
      return res.data;
    } catch (err) {
      if (err instanceof ListenBrainzUnreachableError) throw err;
      const ax = err as AxiosError;
      log.warn(
        { err: ax.message, code: ax.code, path: pathSegment },
        'listenbrainz request failed'
      );
      throw new ListenBrainzUnreachableError(
        `ListenBrainz request failed: ${ax.message ?? 'network error'}`
      );
    }
  }
}

// ---- singleton ------------------------------------------------------------

const PACKAGE_NAME_FOR_UA = 'Overhearr';
// Match the MusicBrainz client's UA convention; ListenBrainz asks for an
// identifying UA on every call.
function defaultUserAgent(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pkg = require('../../../package.json') as { version?: string };
  return `${PACKAGE_NAME_FOR_UA}/${pkg.version ?? '0.0.0'} ( https://github.com/dcurlewis/overhearr )`;
}

export const listenbrainz = new ListenBrainzClient({
  userAgent: defaultUserAgent(),
});
