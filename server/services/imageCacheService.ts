/**
 * Image-proxy cache service.
 *
 * Backs `GET /api/image?src=<encoded-upstream-url>`. Responsibilities:
 *   - SSRF safety: only http/https, and only an allowlist of the upstream
 *     hosts the app legitimately renders (Cover Art Archive, MusicBrainz,
 *     the Last.fm CDN). The proxy is deliberately NOT an open relay.
 *   - On-disk byte cache under `IMAGE_CACHE_DIR`, keyed by sha1(url). Each
 *     entry is a `<sha1>` blob plus a `<sha1>.json` sidecar carrying the
 *     content-type and the fetch timestamp (for TTL).
 *   - Size-capped LRU eviction: once the on-disk total exceeds
 *     `IMAGE_CACHE_MAX_BYTES`, the least-recently-accessed entries are
 *     deleted until we're back under cap. Access time is refreshed on cache
 *     hits via `utimes` so "recently served" beats "recently fetched".
 *   - TTL (~7d): a stale-on-disk entry is treated as a miss and re-fetched.
 *   - Reject non-image content types so a flaky upstream returning an HTML
 *     error page can't be cached or relayed as if it were an image.
 *
 * Conventions mirror the upstream HTTP clients:
 *   - IPv4-pinned https.Agent (CAA / MB CDN paths black-hole over IPv6).
 *   - pino child logger, typed errors, axios with explicit status handling.
 *
 * The class accepts an options bag so tests can inject a tmp dir, a tiny
 * byte cap / TTL, and a stub fetcher without touching the network.
 */

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';

import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosResponse,
} from 'axios';

import { env } from '../config/env';
import {
  ImageNotAnImageError,
  ImageSourceNotAllowedError,
  ImageUpstreamError,
} from '../lib/errors';
import { getLogger } from '../lib/logger';
import { buildUserAgent } from '../lib/packageVersion';

const log = getLogger('image-cache');

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES_PER_IMAGE = 16 * 1024 * 1024; // refuse absurd payloads

/**
 * Hosts we are willing to proxy. These are exactly the upstreams the
 * frontend renders images from today (see next.config.js `remotePatterns`).
 * Adding a new image source means adding it here AND to next.config.js.
 *
 * Entries are matched as either an exact host or a suffix match for the
 * wildcard MusicBrainz subdomains (`*.musicbrainz.org`).
 */
const ALLOWED_HOSTS: ReadonlyArray<string> = [
  'coverartarchive.org',
  'musicbrainz.org',
  'lastfm.freetls.fastly.net',
];
const ALLOWED_HOST_SUFFIXES: ReadonlyArray<string> = ['.musicbrainz.org'];

export interface CachedImage {
  /** Absolute path to the cached blob on disk. */
  filePath: string;
  contentType: string;
  /** Total byte length of the blob. */
  size: number;
  /** Whether this request was served from the on-disk cache. */
  fromCache: boolean;
}

interface ImageMeta {
  contentType: string;
  /** Epoch millis the blob was fetched (TTL anchor). */
  fetchedAt: number;
  url: string;
}

export interface ImageCacheServiceOptions {
  cacheDir?: string;
  maxBytes?: number;
  ttlMs?: number;
  timeoutMs?: number;
  maxBytesPerImage?: number;
  userAgent?: string;
  /**
   * Inject a fetcher (testing). Receives the validated URL, returns the
   * raw bytes + content-type. Throwing should surface as an
   * `ImageUpstreamError`.
   */
  fetcher?: (url: string) => Promise<{ body: Buffer; contentType: string }>;
}

function isHostAllowed(host: string): boolean {
  const h = host.toLowerCase();
  if (ALLOWED_HOSTS.includes(h)) return true;
  return ALLOWED_HOST_SUFFIXES.some((suffix) => h.endsWith(suffix));
}

/**
 * Validate a candidate upstream URL against the SSRF allowlist. Returns the
 * normalised absolute URL on success; throws `ImageSourceNotAllowedError`
 * otherwise. Exported for unit testing of the policy in isolation.
 */
export function assertAllowedImageUrl(src: string): string {
  let parsed: URL;
  try {
    parsed = new URL(src);
  } catch {
    throw new ImageSourceNotAllowedError('src is not a valid absolute URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ImageSourceNotAllowedError(
      'Only http(s) image sources are allowed'
    );
  }
  if (!isHostAllowed(parsed.hostname)) {
    throw new ImageSourceNotAllowedError(
      `Host not allowed: ${parsed.hostname}`
    );
  }
  return parsed.toString();
}

export class ImageCacheService {
  private readonly cacheDir: string;
  private readonly maxBytes: number;
  private readonly ttlMs: number;
  private readonly maxBytesPerImage: number;
  private readonly axios: AxiosInstance;
  private readonly fetcher?: ImageCacheServiceOptions['fetcher'];
  /** Serialise eviction so concurrent misses don't double-trim. */
  private evicting: Promise<void> = Promise.resolve();

  constructor(opts: ImageCacheServiceOptions = {}) {
    this.cacheDir = opts.cacheDir ?? env.IMAGE_CACHE_DIR;
    this.maxBytes = opts.maxBytes ?? env.IMAGE_CACHE_MAX_BYTES;
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.maxBytesPerImage = opts.maxBytesPerImage ?? DEFAULT_MAX_BYTES_PER_IMAGE;
    this.fetcher = opts.fetcher;

    this.axios = axios.create({
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      responseType: 'arraybuffer',
      maxContentLength: this.maxBytesPerImage,
      // IPv4-pinned agents — the CAA / MB CDN paths black-hole over IPv6
      // (see CLAUDE.md "All outbound HTTP clients pin IPv4").
      httpsAgent: new https.Agent({ family: 4, keepAlive: true }),
      httpAgent: new http.Agent({ family: 4, keepAlive: true }),
      headers: {
        'User-Agent': opts.userAgent ?? buildUserAgent(__dirname),
        Accept: 'image/*',
      },
      // Classify status ourselves.
      validateStatus: (s) => s >= 200 && s < 600,
    });
  }

  private keyFor(url: string): string {
    return createHash('sha1').update(url).digest('hex');
  }

  private blobPath(key: string): string {
    return path.join(this.cacheDir, key);
  }

  private metaPath(key: string): string {
    return `${this.blobPath(key)}.json`;
  }

  /**
   * Resolve a cached + fresh entry, or fetch-store-return. The returned
   * `filePath` is a stable on-disk path the route can stream with
   * `res.sendFile` / a read stream.
   */
  async get(src: string): Promise<CachedImage> {
    const url = assertAllowedImageUrl(src);
    const key = this.keyFor(url);

    const cached = await this.readFresh(key);
    if (cached) {
      // Refresh access time so LRU eviction sees this as recently used.
      void this.touch(key);
      return { ...cached, fromCache: true };
    }

    const fetched = await this.fetch(url);
    const stored = await this.store(key, url, fetched);
    // Eviction runs opportunistically after a write; serialise to avoid
    // two concurrent misses trimming each other's freshly-written blobs.
    this.evicting = this.evicting.then(() => this.evict()).catch((err) => {
      log.warn({ err }, 'image cache eviction failed');
    });
    return { ...stored, fromCache: false };
  }

  /** Return a fresh on-disk entry, or undefined if missing / stale / broken. */
  private async readFresh(
    key: string
  ): Promise<Omit<CachedImage, 'fromCache'> | undefined> {
    try {
      const metaRaw = await fs.readFile(this.metaPath(key), 'utf8');
      const meta = JSON.parse(metaRaw) as ImageMeta;
      if (Date.now() - meta.fetchedAt > this.ttlMs) return undefined;
      const stat = await fs.stat(this.blobPath(key));
      return {
        filePath: this.blobPath(key),
        contentType: meta.contentType,
        size: stat.size,
      };
    } catch {
      return undefined;
    }
  }

  private async touch(key: string): Promise<void> {
    try {
      const now = new Date();
      await fs.utimes(this.blobPath(key), now, now);
      await fs.utimes(this.metaPath(key), now, now);
    } catch {
      // best-effort; a failed touch only means slightly-off LRU ordering.
    }
  }

  private async fetch(
    url: string
  ): Promise<{ body: Buffer; contentType: string }> {
    const fetched = this.fetcher
      ? await this.fetcher(url)
      : await this.fetchUpstream(url);

    // Guard the content-type for every fetch path (real or injected) so a
    // non-image response is never cached or streamed back.
    if (!fetched.contentType.toLowerCase().startsWith('image/')) {
      throw new ImageNotAnImageError(
        `Upstream content-type is "${fetched.contentType || 'unknown'}", not an image`
      );
    }
    return fetched;
  }

  private async fetchUpstream(
    url: string
  ): Promise<{ body: Buffer; contentType: string }> {
    const res = await this.requestUpstream(url);

    if (res.status < 200 || res.status >= 300) {
      throw new ImageUpstreamError(`Upstream returned ${res.status}`);
    }
    const contentType = String(res.headers['content-type'] ?? '').toLowerCase();
    return { body: Buffer.from(res.data), contentType };
  }

  private async requestUpstream(
    url: string
  ): Promise<AxiosResponse<ArrayBuffer>> {
    try {
      return await this.axios.get<ArrayBuffer>(url);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const ax = err as AxiosError;
        log.warn({ err: ax.message, code: ax.code, url }, 'image fetch failed');
        throw new ImageUpstreamError(`Image fetch failed: ${ax.message}`);
      }
      throw new ImageUpstreamError(
        err instanceof Error ? err.message : 'unknown error'
      );
    }
  }

  private async store(
    key: string,
    url: string,
    fetched: { body: Buffer; contentType: string }
  ): Promise<Omit<CachedImage, 'fromCache'>> {
    await fs.mkdir(this.cacheDir, { recursive: true });
    const blobPath = this.blobPath(key);
    const meta: ImageMeta = {
      contentType: fetched.contentType,
      fetchedAt: Date.now(),
      url,
    };
    // Write blob then meta; readFresh keys off the meta sidecar, so writing
    // it last avoids serving a half-written blob.
    await fs.writeFile(blobPath, fetched.body);
    await fs.writeFile(this.metaPath(key), JSON.stringify(meta), 'utf8');
    return {
      filePath: blobPath,
      contentType: fetched.contentType,
      size: fetched.body.byteLength,
    };
  }

  /**
   * Size-capped LRU eviction. Sum the on-disk blob sizes; if over cap, sort
   * by access time (oldest first) and delete whole entries (blob + sidecar)
   * until back under cap.
   */
  private async evict(): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(this.cacheDir);
    } catch {
      return; // dir doesn't exist yet → nothing to evict
    }

    const blobs: Array<{ key: string; size: number; atimeMs: number }> = [];
    let total = 0;
    for (const name of entries) {
      if (name.endsWith('.json')) continue;
      try {
        const stat = await fs.stat(path.join(this.cacheDir, name));
        if (!stat.isFile()) continue;
        blobs.push({ key: name, size: stat.size, atimeMs: stat.atimeMs });
        total += stat.size;
      } catch {
        // entry vanished mid-scan; ignore
      }
    }

    if (total <= this.maxBytes) return;

    blobs.sort((a, b) => a.atimeMs - b.atimeMs); // oldest access first
    for (const b of blobs) {
      if (total <= this.maxBytes) break;
      try {
        await fs.rm(this.blobPath(b.key), { force: true });
        await fs.rm(this.metaPath(b.key), { force: true });
        total -= b.size;
        log.debug({ key: b.key, freed: b.size }, 'evicted cached image');
      } catch (err) {
        log.warn({ err, key: b.key }, 'failed to evict cached image');
      }
    }
  }

  /** Test helper: block until the most recent eviction settles. */
  async flushEvictions(): Promise<void> {
    await this.evicting;
  }
}

export const imageCache = new ImageCacheService();
