/**
 * Cover Art Archive (CAA) client.
 *
 * CAA is permissive (no rate limit) but slow and frequently 404s for older
 * or obscure releases. We:
 *   - LRU-cache positive hits for 24h.
 *   - LRU-cache negative results (404 or "no front image") for 24h too, so
 *     a missing cover doesn't translate to a CAA hit on every page load.
 *   - Treat any non-network failure as "no cover" — search/detail flows must
 *     never fail because CAA was flaky.
 *
 * The client is a singleton; tests can construct their own via
 * `createCoverArtClient` to inject a baseUrl.
 */

import axios, { type AxiosError, type AxiosInstance } from 'axios';
import { LRUCache } from 'lru-cache';

const DEFAULT_BASE_URL = 'https://coverartarchive.org';
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_MAX = 1000;
const DEFAULT_TIMEOUT_MS = 10_000;

export interface CoverArt {
  frontUrl?: string;
  thumbnailUrl?: string;
}

interface CAAImage {
  image?: string;
  front?: boolean;
  thumbnails?: {
    small?: string;
    large?: string;
    '250'?: string;
    '500'?: string;
    '1200'?: string;
  };
}

interface CAAResponse {
  images?: CAAImage[];
}

export interface CoverArtClientOptions {
  baseUrl?: string;
  ttlMs?: number;
  max?: number;
  timeoutMs?: number;
}

export class CoverArtClient {
  private readonly axios: AxiosInstance;
  private readonly cache: LRUCache<string, CoverArt>;

  constructor(opts: CoverArtClientOptions = {}) {
    const baseURL = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.axios = axios.create({
      baseURL,
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      headers: { Accept: 'application/json' },
      // Don't throw on 404 — we want to negative-cache it, not crash.
      validateStatus: (s) => (s >= 200 && s < 300) || s === 404,
    });
    this.cache = new LRUCache<string, CoverArt>({
      max: opts.max ?? DEFAULT_MAX,
      ttl: opts.ttlMs ?? DEFAULT_TTL_MS,
    });
  }

  async getCoverArt(releaseMbid: string): Promise<CoverArt> {
    return this.fetchCached(`release:${releaseMbid}`, `/release/${releaseMbid}`);
  }

  /**
   * Fetch the front cover for a release-group. CAA exposes a per-RG endpoint
   * that "selects" the best release in the group — preferred for the
   * artist-discography view where we don't want to fan out one lookup per
   * release.
   */
  async getReleaseGroupCoverArt(releaseGroupMbid: string): Promise<CoverArt> {
    return this.fetchCached(
      `release-group:${releaseGroupMbid}`,
      `/release-group/${releaseGroupMbid}`
    );
  }

  private async fetchCached(cacheKey: string, urlPath: string): Promise<CoverArt> {
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    let result: CoverArt = {};
    try {
      const res = await this.axios.get<CAAResponse>(urlPath);
      if (res.status === 404 || !res.data) {
        // negative-cache — empty object below
      } else {
        result = pickCover(res.data);
      }
    } catch (err) {
      // Network failures, timeouts, or any other CAA hiccup: treat as "no
      // cover" and negative-cache briefly. We deliberately don't propagate
      // because cover art is non-essential.
      if (axios.isAxiosError(err)) {
        const ax = err as AxiosError;
        if (ax.response?.status === 404) {
          // already handled above, but be safe
        }
      }
    }

    this.cache.set(cacheKey, result);
    return result;
  }

  /** Test helper: clear cache between cases. */
  clearCache(): void {
    this.cache.clear();
  }
}

function pickCover(data: CAAResponse): CoverArt {
  const images = data.images ?? [];
  if (images.length === 0) return {};
  const front = images.find((i) => i.front) ?? images[0];
  if (!front) return {};
  const thumb = front.thumbnails?.['500'] ?? front.thumbnails?.large;
  const result: CoverArt = {};
  if (front.image) result.frontUrl = front.image;
  if (thumb) result.thumbnailUrl = thumb;
  return result;
}

export function createCoverArtClient(opts: CoverArtClientOptions = {}): CoverArtClient {
  return new CoverArtClient(opts);
}

export const coverArt = new CoverArtClient();
