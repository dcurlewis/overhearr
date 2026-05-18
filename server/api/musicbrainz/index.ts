/**
 * MusicBrainz client.
 *
 * Wraps the MusicBrainz Web Service v2 with:
 *   - A FIFO rate-limit queue (1 req/sec + jitter) to comply with policy.
 *   - LRU caches: 15min for searches, 1h for details.
 *   - IPv4-only HTTPS agent (workaround for long-standing IPv6 + MB issues
 *     where some POPs route badly over v6 and time out).
 *   - Typed errors that the central error handler maps to clean JSON.
 *
 * The class is a singleton (`musicbrainz`), but its constructor accepts an
 * options bag so tests can inject a small `minIntervalMs` and short TTLs.
 */

import https from 'https';

import axios, { type AxiosError, type AxiosInstance } from 'axios';
import { LRUCache } from 'lru-cache';

import {
  MusicBrainzNotFoundError,
  MusicBrainzRateLimitedError,
  MusicBrainzUnreachableError,
} from '../../lib/errors';
import { logger } from '../../lib/logger';
import { buildUserAgent } from '../../lib/packageVersion';
import { RateLimitQueue } from '../../lib/rateLimitQueue';
import type { DiscoverAlbum } from '../../types/discover';
import type {
  Album,
  Artist,
  ArtistDetails,
  MusicBrainzSearchResult,
  ReleaseGroup,
  ReleaseGroupPrimaryType,
  Track,
} from '../../types/musicbrainz';
import { CoverArtClient, type CoverArt } from './coverArt';

// --- Raw MB JSON shapes (kept private to this module) -----------------------

interface MBArtistCredit {
  name?: string;
  joinphrase?: string;
  artist?: { id: string; name?: string; 'sort-name'?: string };
}

interface MBReleaseGroupRef {
  id: string;
  title?: string;
  'primary-type'?: string;
  'secondary-types'?: string[];
  'first-release-date'?: string;
}

interface MBRelease {
  id: string;
  title: string;
  date?: string;
  status?: string;
  country?: string;
  'artist-credit'?: MBArtistCredit[];
  'release-group'?: MBReleaseGroupRef;
  media?: Array<{
    'track-count'?: number;
    tracks?: Array<{
      id?: string;
      position?: number;
      number?: string;
      title?: string;
      length?: number;
      recording?: { id?: string; title?: string; length?: number };
    }>;
  }>;
}

interface MBArtist {
  id: string;
  name: string;
  'sort-name'?: string;
  disambiguation?: string;
  country?: string;
  type?: string;
  'release-groups'?: MBReleaseGroupRef[];
}

type MBSearchEnvelope<K extends string, T> = {
  count?: number;
  offset?: number;
} & { [P in K]?: T[] };

type MBReleaseSearch = MBSearchEnvelope<'releases', MBRelease>;
type MBArtistSearch = MBSearchEnvelope<'artists', MBArtist>;

interface MBReleaseGroupSearchHit {
  id: string;
  title?: string;
  'primary-type'?: string;
  'first-release-date'?: string;
  'artist-credit'?: MBArtistCredit[];
}

type MBReleaseGroupSearch = MBSearchEnvelope<
  'release-groups',
  MBReleaseGroupSearchHit
>;

interface MBReleaseGroupLookup {
  id: string;
  title: string;
  'primary-type'?: string;
  releases?: Array<{
    id: string;
    title?: string;
    status?: string;
    date?: string;
  }>;
}

// --- Client -----------------------------------------------------------------

export interface MusicBrainzClientOptions {
  baseUrl?: string;
  coverArtBaseUrl?: string;
  /** Min interval between request *starts*. Default 1000ms. */
  minIntervalMs?: number;
  jitterMs?: number;
  searchCacheTtlMs?: number;
  detailCacheTtlMs?: number;
  searchCacheMax?: number;
  detailCacheMax?: number;
  timeoutMs?: number;
  /** Override the User-Agent (mainly useful for tests). */
  userAgent?: string;
  /** Inject a CoverArtClient (testing). */
  coverArtClient?: CoverArtClient;
}

const DEFAULT_BASE_URL = 'https://musicbrainz.org/ws/2';
const DEFAULT_MIN_INTERVAL = 1000;
const DEFAULT_JITTER = 100;
const DEFAULT_SEARCH_TTL = 15 * 60 * 1000;
const DEFAULT_DETAIL_TTL = 60 * 60 * 1000;
const DEFAULT_SEARCH_MAX = 200;
const DEFAULT_DETAIL_MAX = 500;
const DEFAULT_TIMEOUT = 15_000;

const log = logger.child({ name: 'musicbrainz' });

const DEFAULT_USER_AGENT = buildUserAgent(__dirname);

export class MusicBrainzClient {
  private readonly axios: AxiosInstance;
  private readonly queue: RateLimitQueue;
  private readonly searchCache: LRUCache<string, object>;
  private readonly detailCache: LRUCache<string, object>;
  private readonly coverArtClient: CoverArtClient;

  constructor(opts: MusicBrainzClientOptions = {}) {
    const baseURL = opts.baseUrl ?? DEFAULT_BASE_URL;
    const httpsAgent = new https.Agent({
      family: 4,
      keepAlive: true,
      rejectUnauthorized: true,
    });

    this.axios = axios.create({
      baseURL,
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT,
      httpsAgent,
      headers: {
        'User-Agent': opts.userAgent ?? DEFAULT_USER_AGENT,
        Accept: 'application/json',
      },
      // Let us classify 404 vs other errors ourselves.
      validateStatus: (s) => s >= 200 && s < 600,
    });

    this.queue = new RateLimitQueue({
      minIntervalMs: opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL,
      jitterMs: opts.jitterMs ?? DEFAULT_JITTER,
    });

    this.searchCache = new LRUCache({
      max: opts.searchCacheMax ?? DEFAULT_SEARCH_MAX,
      ttl: opts.searchCacheTtlMs ?? DEFAULT_SEARCH_TTL,
    });

    this.detailCache = new LRUCache({
      max: opts.detailCacheMax ?? DEFAULT_DETAIL_MAX,
      ttl: opts.detailCacheTtlMs ?? DEFAULT_DETAIL_TTL,
    });

    this.coverArtClient =
      opts.coverArtClient ??
      new CoverArtClient(
        opts.coverArtBaseUrl ? { baseUrl: opts.coverArtBaseUrl } : {}
      );
  }

  /** Test-only: forget memoised search and detail responses. */
  clearCache(): void {
    this.searchCache.clear();
    this.detailCache.clear();
  }

  // --- Public API ----------------------------------------------------------

  async searchAlbums(
    query: string,
    limit = 20
  ): Promise<MusicBrainzSearchResult<Album>> {
    const cacheKey = `searchAlbums:${limit}:${query}`;
    const cached = this.searchCache.get(cacheKey) as
      | MusicBrainzSearchResult<Album>
      | undefined;
    if (cached) return cached;

    const data = await this.request<MBReleaseSearch>('/release', {
      query,
      limit: limit * 3,
      fmt: 'json',
      inc: 'artist-credits+release-groups',
    });

    const releases = data.releases ?? [];
    const seen = new Map<string, MBRelease>();
    for (const r of releases) {
      const rgId = r['release-group']?.id;
      if (!rgId) continue;
      const existing = seen.get(rgId);
      if (!existing) {
        seen.set(rgId, r);
        continue;
      }
      // Prefer Official + Album over anything else.
      if (preferenceScore(r) > preferenceScore(existing)) {
        seen.set(rgId, r);
      }
    }

    const sliced = Array.from(seen.values()).slice(0, limit);

    // Look up cover art in parallel; failures are non-fatal.
    const covers = await Promise.all(
      sliced.map((r) => this.safeCoverArt(r.id))
    );

    const items: Album[] = sliced.map((r, i) => mapAlbum(r, covers[i] ?? {}));
    const result: MusicBrainzSearchResult<Album> = {
      items,
      total: data.count ?? items.length,
    };
    this.searchCache.set(cacheKey, result);
    return result;
  }

  async getAlbum(mbid: string): Promise<Album> {
    const cacheKey = `getAlbum:${mbid}`;
    const cached = this.detailCache.get(cacheKey) as Album | undefined;
    if (cached) return cached;

    let release: MBRelease | undefined;
    try {
      release = await this.request<MBRelease>(`/release/${mbid}`, {
        inc: 'recordings+artist-credits+release-groups+labels',
        fmt: 'json',
      });
    } catch (err) {
      if (!(err instanceof MusicBrainzNotFoundError)) throw err;
      // fallthrough to release-group fallback
    }

    if (!release) {
      // Try as a release-group id; pick the best release inside.
      let rg: MBReleaseGroupLookup;
      try {
        rg = await this.request<MBReleaseGroupLookup>(
          `/release-group/${mbid}`,
          { inc: 'releases+artist-credits', fmt: 'json' }
        );
      } catch (err) {
        if (err instanceof MusicBrainzNotFoundError) {
          throw new MusicBrainzNotFoundError(
            `MusicBrainz release/release-group not found: ${mbid}`
          );
        }
        throw err;
      }
      const best = pickBestRelease(rg.releases ?? []);
      if (!best) {
        throw new MusicBrainzNotFoundError(
          `MusicBrainz release-group has no releases: ${mbid}`
        );
      }
      release = await this.request<MBRelease>(`/release/${best.id}`, {
        inc: 'recordings+artist-credits+release-groups+labels',
        fmt: 'json',
      });
    }

    const cover = await this.safeCoverArt(release.id);
    const album = mapAlbum(release, cover);
    this.detailCache.set(cacheKey, album);
    return album;
  }

  async searchArtists(
    query: string,
    limit = 20
  ): Promise<MusicBrainzSearchResult<Artist>> {
    const cacheKey = `searchArtists:${limit}:${query}`;
    const cached = this.searchCache.get(cacheKey) as
      | MusicBrainzSearchResult<Artist>
      | undefined;
    if (cached) return cached;

    const data = await this.request<MBArtistSearch>('/artist', {
      query,
      limit,
      fmt: 'json',
    });

    const items = (data.artists ?? []).map(mapArtist);
    const result: MusicBrainzSearchResult<Artist> = {
      items,
      total: data.count ?? items.length,
    };
    this.searchCache.set(cacheKey, result);
    return result;
  }

  async getArtist(mbid: string): Promise<ArtistDetails> {
    const cacheKey = `getArtist:${mbid}`;
    const cached = this.detailCache.get(cacheKey) as
      | ArtistDetails
      | undefined;
    if (cached) return cached;

    const data = await this.request<MBArtist>(`/artist/${mbid}`, {
      inc: 'release-groups',
      fmt: 'json',
    });

    const releaseGroups = (data['release-groups'] ?? [])
      .filter((rg) => rg['primary-type'] === 'Album')
      .map(mapReleaseGroup)
      .sort((a, b) => {
        const da = a.firstReleaseDate ?? '';
        const db = b.firstReleaseDate ?? '';
        return db.localeCompare(da);
      });

    const result: ArtistDetails = {
      ...mapArtist(data),
      releaseGroups,
    };
    this.detailCache.set(cacheKey, result);
    return result;
  }

  /**
   * Recently released albums (release-groups), newest first.
   *
   * MusicBrainz `/release-group` search sorts by Lucene relevance, not by
   * `firstreleasedate`. To approximate "most recent N albums" we:
   *   1. Query a date window (`monthsBack` calendar months ending today).
   *   2. Over-fetch (`limit * 4`, capped at MB's per-page max of 100).
   *   3. Sort in-memory by `firstReleaseDate` desc.
   *   4. Slice to `limit`.
   *
   * Cover art is looked up per release-group via the existing CAA helper;
   * failures degrade to no-cover (cover art is never load-bearing).
   */
  async getRecentReleaseGroups(
    options: { monthsBack?: number; limit?: number } = {}
  ): Promise<DiscoverAlbum[]> {
    const monthsBack = options.monthsBack ?? 1;
    const limit = options.limit ?? 24;

    const cacheKey = `getRecentReleaseGroups:${monthsBack}:${limit}`;
    const cached = this.searchCache.get(cacheKey) as DiscoverAlbum[] | undefined;
    if (cached) return cached;

    const today = new Date();
    const start = new Date(today);
    start.setMonth(start.getMonth() - monthsBack);
    const fmt = (d: Date): string => d.toISOString().slice(0, 10);
    const from = fmt(start);
    const to = fmt(today);

    // Lucene query: only Albums released within the window. The query is
    // URL-encoded by axios; spaces and brackets are fine as literal chars.
    const query = `primarytype:Album AND firstreleasedate:[${from} TO ${to}]`;
    const fetchSize = Math.min(limit * 4, 100);

    const data = await this.request<MBReleaseGroupSearch>('/release-group', {
      query,
      limit: fetchSize,
      fmt: 'json',
    });

    const hits = data['release-groups'] ?? [];

    // Sort newest first; entries without a date sink to the bottom.
    const sorted = [...hits].sort((a, b) => {
      const ad = a['first-release-date'] ?? '';
      const bd = b['first-release-date'] ?? '';
      if (!ad && !bd) return 0;
      if (!ad) return 1;
      if (!bd) return -1;
      return bd.localeCompare(ad);
    });

    const sliced = sorted.slice(0, limit);

    // Look up cover art in parallel; failures (404/5xx/network) come back as
    // an empty `{}` from `getReleaseGroupCoverArt` so a missing cover never
    // blanks the row.
    const covers = await Promise.all(
      sliced.map((h) => this.getReleaseGroupCoverArt(h.id))
    );

    const items: DiscoverAlbum[] = sliced.map((h, i) => {
      const credit = h['artist-credit']?.[0];
      const artistName =
        credit?.artist?.name ?? credit?.name ?? 'Unknown Artist';
      const artistMbid = credit?.artist?.id;
      const cover = covers[i] ?? {};
      const album: DiscoverAlbum = {
        mbid: h.id,
        name: h.title ?? '',
        artist: artistName,
      };
      if (artistMbid) album.artistMbid = artistMbid;
      if (cover.thumbnailUrl ?? cover.frontUrl) {
        album.imageUrl = cover.thumbnailUrl ?? cover.frontUrl;
      }
      if (h['first-release-date']) {
        album.firstReleaseDate = h['first-release-date'];
      }
      return album;
    });

    this.searchCache.set(cacheKey, items);
    return items;
  }

  // --- Internal ------------------------------------------------------------

  private async request<T>(
    pathSegment: string,
    params: Record<string, string | number | undefined>
  ): Promise<T> {
    return this.queue.enqueue(async () => {
      try {
        const res = await this.axios.get<T>(pathSegment, { params });
        if (res.status === 404) {
          throw new MusicBrainzNotFoundError(
            `MusicBrainz 404: ${pathSegment}`
          );
        }
        if (res.status === 503) {
          throw new MusicBrainzRateLimitedError();
        }
        if (res.status >= 400) {
          throw new MusicBrainzUnreachableError(
            `MusicBrainz error ${res.status}: ${pathSegment}`
          );
        }
        return res.data;
      } catch (err) {
        if (
          err instanceof MusicBrainzNotFoundError ||
          err instanceof MusicBrainzRateLimitedError ||
          err instanceof MusicBrainzUnreachableError
        ) {
          throw err;
        }
        if (axios.isAxiosError(err)) {
          const ax = err as AxiosError;
          const status = ax.response?.status;
          if (status === 404) throw new MusicBrainzNotFoundError();
          if (status === 503) throw new MusicBrainzRateLimitedError();
          log.warn(
            { err: ax.message, code: ax.code, status, path: pathSegment },
            'musicbrainz request failed'
          );
          throw new MusicBrainzUnreachableError(
            `MusicBrainz unreachable: ${ax.message}`
          );
        }
        throw new MusicBrainzUnreachableError(
          err instanceof Error ? err.message : 'unknown error'
        );
      }
    });
  }

  private async safeCoverArt(releaseMbid: string): Promise<CoverArt> {
    try {
      return await this.coverArtClient.getCoverArt(releaseMbid);
    } catch {
      return {};
    }
  }

  /**
   * Look up cover art by release-group MBID. CAA's `/release-group/<mbid>`
   * endpoint returns the best release's cover automatically, so this is
   * preferred over picking-then-fetching when you only have an RG id (e.g.
   * for the artist discography view). Failures degrade to `{}` like
   * `safeCoverArt` — cover art is never load-bearing.
   */
  async getReleaseGroupCoverArt(releaseGroupMbid: string): Promise<CoverArt> {
    try {
      return await this.coverArtClient.getReleaseGroupCoverArt(releaseGroupMbid);
    } catch {
      return {};
    }
  }
}

export type { CoverArt } from './coverArt';

// --- Mappers ---------------------------------------------------------------

function preferenceScore(r: MBRelease): number {
  let s = 0;
  if (r.status === 'Official') s += 2;
  if (r['release-group']?.['primary-type'] === 'Album') s += 1;
  return s;
}

function pickBestRelease(
  releases: NonNullable<MBReleaseGroupLookup['releases']>
): { id: string } | undefined {
  if (releases.length === 0) return undefined;
  const sorted = [...releases].sort((a, b) => {
    const aOff = a.status === 'Official' ? 1 : 0;
    const bOff = b.status === 'Official' ? 1 : 0;
    if (aOff !== bOff) return bOff - aOff;
    const ad = a.date ?? '9999';
    const bd = b.date ?? '9999';
    return ad.localeCompare(bd);
  });
  return sorted[0];
}

function mapArtist(a: MBArtist): Artist {
  const out: Artist = {
    mbid: a.id,
    name: a.name,
    sortName: a['sort-name'] ?? a.name,
  };
  if (a.disambiguation) out.disambiguation = a.disambiguation;
  if (a.country) out.country = a.country;
  if (a.type) out.type = a.type;
  return out;
}

function mapReleaseGroup(rg: MBReleaseGroupRef): ReleaseGroup {
  const primary = normalizePrimaryType(rg['primary-type']);
  const out: ReleaseGroup = {
    mbid: rg.id,
    title: rg.title ?? '',
  };
  if (primary) out.primaryType = primary;
  if (rg['secondary-types'] && rg['secondary-types'].length > 0) {
    out.secondaryTypes = rg['secondary-types'];
  }
  if (rg['first-release-date']) {
    out.firstReleaseDate = rg['first-release-date'];
  }
  return out;
}

function normalizePrimaryType(
  t: string | undefined
): ReleaseGroupPrimaryType | undefined {
  if (!t) return undefined;
  if (t === 'Album' || t === 'Single' || t === 'EP') return t;
  return 'Other';
}

function mapAlbum(r: MBRelease, cover: CoverArt): Album {
  const credit = r['artist-credit']?.[0];
  const artistName = credit?.artist?.name ?? credit?.name ?? 'Unknown Artist';
  const artistMbid = credit?.artist?.id ?? '';
  const tracks: Track[] = [];
  const media = r.media ?? [];
  let positionCounter = 0;
  for (const m of media) {
    for (const t of m.tracks ?? []) {
      positionCounter += 1;
      const length = t.length ?? t.recording?.length;
      const track: Track = {
        position: t.position ?? positionCounter,
        title: t.title ?? t.recording?.title ?? '',
      };
      if (typeof length === 'number') track.lengthMs = length;
      if (t.recording?.id) track.recordingMbid = t.recording.id;
      tracks.push(track);
    }
  }

  const album: Album = {
    mbid: r.id,
    releaseGroupMbid: r['release-group']?.id ?? r.id,
    title: r.title,
    artistName,
    artistMbid,
    tracks,
  };
  const date = r.date ?? r['release-group']?.['first-release-date'];
  if (date) album.firstReleaseDate = date;
  if (cover.frontUrl) album.coverArtUrl = cover.frontUrl;
  if (cover.thumbnailUrl) album.thumbnailUrl = cover.thumbnailUrl;
  return album;
}

export const musicbrainz = new MusicBrainzClient();
