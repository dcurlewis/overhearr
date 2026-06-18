/**
 * ListenBrainz client.
 *
 * Powers the Top Albums / Top Artists rows on Discover. ListenBrainz sitewide
 * stats are anonymous (https://listenbrainz.readthedocs.io/) — no API key,
 * just a polite User-Agent. That is why this client has no `apiKeyProvider`
 * the way the old Last.fm client did, and no "not configured" error state:
 * Discover is zero-config out of the box.
 *
 * Endpoints in use:
 *   GET /1/stats/sitewide/release-groups  → top albums by listens in a window
 *   GET /1/stats/sitewide/artists         → top artists by listens in a window
 *   GET <labs>/similar-artists/json       → similar artists for one mbid
 *
 * The similar-artists endpoint lives on the ListenBrainz Labs host
 * (`https://labs.api.listenbrainz.org`), not the main API host, so it has its
 * own configurable base URL (`labsBaseUrl`). It is collaborative-filtering
 * derived and is the primary source for the "Similar artists" / "More like
 * this" rows; the Music route falls back to MusicBrainz relationships when it
 * degrades.
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
import { buildUserAgent } from '../../lib/packageVersion';
import type { DiscoverAlbum, DiscoverArtist } from '../../types/discover';
import { ListenBrainzUnreachableError } from './errors';

const DEFAULT_BASE_URL = 'https://api.listenbrainz.org';
const DEFAULT_LABS_BASE_URL = 'https://labs.api.listenbrainz.org';
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1h
const DEFAULT_MAX_ENTRIES = 64;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RANGE: ListenBrainzRange = 'month';
const CAA_BASE = 'https://coverartarchive.org/release';

// Stable algorithm string for the Labs similar-artists dataset. Documented at
// https://labs.api.listenbrainz.org/similar-artists — this is the recommended
// general-purpose model. Pinned here so a server-side default change can't
// silently alter results.
const SIMILAR_ARTISTS_ALGORITHM =
  'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30';

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

// The Labs similar-artists endpoint returns a bare JSON array of rows. Field
// names have drifted across dataset versions, so we read both the current
// (`artist_mbid` / `name`) and older (`comment`) spellings defensively. Some
// deployments wrap the array in a one-element tuple `[ {...}, [rows] ]`; the
// parser tolerates either by scanning for the first array of objects.
interface RawSimilarArtist {
  artist_mbid?: string;
  name?: string;
  comment?: string;
  score?: number;
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

function normaliseSimilarArtist(
  raw: RawSimilarArtist
): DiscoverArtist | undefined {
  const mbid = emptyToUndef(raw.artist_mbid);
  const name = (raw.name ?? raw.comment ?? '').trim();
  // A similar-artist card is useless without an mbid to deep-link to — the
  // whole point is the "request this artist" affordance, which needs the id.
  if (!mbid || name.length === 0) return undefined;
  return { mbid, name };
}

/**
 * The similar-artists payload is normally a bare array. Some dataset versions
 * wrap it as `[ {...metadata}, [ ...rows ] ]`, so we accept either: a top-level
 * array of artist objects, or the first nested array of objects we can find.
 */
function extractSimilarRows(data: unknown): RawSimilarArtist[] {
  if (Array.isArray(data)) {
    if (data.every((el) => el !== null && typeof el === 'object' && !Array.isArray(el))) {
      return data as RawSimilarArtist[];
    }
    for (const el of data) {
      if (
        Array.isArray(el) &&
        el.every((x) => x !== null && typeof x === 'object')
      ) {
        return el as RawSimilarArtist[];
      }
    }
  }
  return [];
}

// ---- client ---------------------------------------------------------------

export interface ListenBrainzClientOptions {
  baseUrl?: string;
  /** Base URL of the ListenBrainz Labs host (similar-artists). */
  labsBaseUrl?: string;
  cacheTtlMs?: number;
  cacheMax?: number;
  timeoutMs?: number;
  /** Override the User-Agent (mainly for tests). */
  userAgent?: string;
}

export class ListenBrainzClient {
  private readonly axios: AxiosInstance;
  private readonly labsAxios: AxiosInstance;
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
    const headers = {
      Accept: 'application/json',
      ...(opts.userAgent ? { 'User-Agent': opts.userAgent } : {}),
    };
    this.axios = axios.create({
      baseURL: opts.baseUrl ?? DEFAULT_BASE_URL,
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      httpsAgent,
      headers,
    });
    // The Labs host is a separate origin (different base URL) but shares the
    // same IPv4 pinning, timeout, and UA policy.
    this.labsAxios = axios.create({
      baseURL: opts.labsBaseUrl ?? DEFAULT_LABS_BASE_URL,
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      httpsAgent,
      headers,
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

  /**
   * Collaborative-filtering "similar artists" for a single artist MBID. Rows
   * without a usable mbid+name are dropped (the cards can't deep-link without
   * an id). Returns up to `count` rows, ordered as the dataset returns them
   * (most-similar first). Upstream failures throw `ListenBrainzUnreachableError`
   * so the Music route's per-source settle() can degrade to MusicBrainz.
   */
  async getSimilarArtists(
    artistMbid: string,
    options: { count?: number } = {}
  ): Promise<DiscoverArtist[]> {
    const count = options.count ?? 18;
    return this.cached(`getSimilarArtists:${artistMbid}:${count}`, async () => {
      const data = await this.callLabs<unknown>('/similar-artists/json', {
        artist_mbids: artistMbid,
        algorithm: SIMILAR_ARTISTS_ALGORITHM,
      });
      const rows = extractSimilarRows(data);
      const out: DiscoverArtist[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        const artist = normaliseSimilarArtist(row);
        if (!artist || !artist.mbid) continue;
        // The seed artist occasionally appears in its own similar list; drop it.
        if (artist.mbid === artistMbid) continue;
        if (seen.has(artist.mbid)) continue;
        seen.add(artist.mbid);
        out.push(artist);
        if (out.length >= count) break;
      }
      return out;
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
    return this.requestOn(this.axios, pathSegment, params);
  }

  private async callLabs<T>(
    pathSegment: string,
    params: Record<string, string>
  ): Promise<T> {
    return this.requestOn(this.labsAxios, pathSegment, params);
  }

  private async requestOn<T>(
    instance: AxiosInstance,
    pathSegment: string,
    params: Record<string, string>
  ): Promise<T> {
    try {
      const res = await instance.get<T>(pathSegment, { params });
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

// ListenBrainz asks for an identifying UA on every call. `buildUserAgent`
// reads `package.json` lazily and tolerates the dist/runtime layouts.
export const listenbrainz = new ListenBrainzClient({
  userAgent: buildUserAgent(__dirname),
});
