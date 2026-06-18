/**
 * Unit tests for the image-proxy cache service.
 *
 * The upstream fetch is stubbed via the `fetcher` option so these tests never
 * touch the network. Each test gets its own tmp cache dir.
 */
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ImageNotAnImageError,
  ImageSourceNotAllowedError,
  ImageUpstreamError,
} from '../../server/lib/errors';
import {
  ImageCacheService,
  assertAllowedImageUrl,
} from '../../server/services/imageCacheService';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // "\x89PNG" magic

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'overhearr-img-'));
});

afterEach(async () => {
  await fs.rm(cacheDir, { recursive: true, force: true });
});

function svc(
  opts: Partial<ConstructorParameters<typeof ImageCacheService>[0]> = {},
  fetcher?: NonNullable<ConstructorParameters<typeof ImageCacheService>[0]>['fetcher']
): ImageCacheService {
  return new ImageCacheService({
    cacheDir,
    fetcher:
      fetcher ??
      (async () => ({ body: PNG, contentType: 'image/png' })),
    ...opts,
  });
}

describe('assertAllowedImageUrl', () => {
  it('accepts allowlisted hosts', () => {
    expect(
      assertAllowedImageUrl('https://coverartarchive.org/release/x/1-250.jpg')
    ).toContain('coverartarchive.org');
    expect(
      assertAllowedImageUrl('https://lastfm.freetls.fastly.net/i/u/300x300/a.png')
    ).toContain('lastfm.freetls.fastly.net');
  });

  it('accepts wildcard *.musicbrainz.org subdomains', () => {
    expect(
      assertAllowedImageUrl('https://ia.musicbrainz.org/some/image.jpg')
    ).toContain('musicbrainz.org');
    expect(
      assertAllowedImageUrl('https://musicbrainz.org/image.jpg')
    ).toContain('musicbrainz.org');
  });

  it('rejects non-allowlisted hosts (SSRF guard)', () => {
    expect(() => assertAllowedImageUrl('https://evil.example.com/x.png')).toThrow(
      ImageSourceNotAllowedError
    );
    // A lookalike suffix must not slip past the suffix match.
    expect(() =>
      assertAllowedImageUrl('https://notmusicbrainz.org/x.png')
    ).toThrow(ImageSourceNotAllowedError);
    expect(() =>
      assertAllowedImageUrl('https://evilmusicbrainz.org.attacker.com/x.png')
    ).toThrow(ImageSourceNotAllowedError);
  });

  it('rejects non-http(s) schemes', () => {
    expect(() =>
      assertAllowedImageUrl('file:///etc/passwd')
    ).toThrow(ImageSourceNotAllowedError);
    expect(() =>
      assertAllowedImageUrl('ftp://coverartarchive.org/x.png')
    ).toThrow(ImageSourceNotAllowedError);
  });

  it('rejects malformed / relative URLs', () => {
    expect(() => assertAllowedImageUrl('not a url')).toThrow(
      ImageSourceNotAllowedError
    );
    expect(() => assertAllowedImageUrl('/relative/path.png')).toThrow(
      ImageSourceNotAllowedError
    );
  });
});

describe('ImageCacheService.get', () => {
  const URL = 'https://coverartarchive.org/release/abc/1-250.jpg';

  it('fetches, stores, and reports a miss on first access', async () => {
    const fetcher = vi.fn(async () => ({
      body: PNG,
      contentType: 'image/png',
    }));
    const s = svc({}, fetcher);

    const result = await s.get(URL);
    expect(result.fromCache).toBe(false);
    expect(result.contentType).toBe('image/png');
    expect(result.size).toBe(PNG.byteLength);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const bytes = await fs.readFile(result.filePath);
    expect(bytes.equals(PNG)).toBe(true);
  });

  it('serves a cache HIT on the second access without re-fetching', async () => {
    const fetcher = vi.fn(async () => ({
      body: PNG,
      contentType: 'image/png',
    }));
    const s = svc({}, fetcher);

    await s.get(URL);
    const second = await s.get(URL);
    expect(second.fromCache).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('treats a TTL-expired entry as a miss and re-fetches', async () => {
    const fetcher = vi.fn(async () => ({
      body: PNG,
      contentType: 'image/png',
    }));
    const s = svc({ ttlMs: -1 }, fetcher); // already-expired on write

    await s.get(URL);
    const second = await s.get(URL);
    expect(second.fromCache).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects non-image content types', async () => {
    const s = svc({}, async () => ({
      body: Buffer.from('<html>error</html>'),
      contentType: 'text/html',
    }));
    await expect(s.get(URL)).rejects.toBeInstanceOf(ImageNotAnImageError);
  });

  it('surfaces upstream failures as ImageUpstreamError', async () => {
    const s = svc({}, async () => {
      throw new ImageUpstreamError('boom');
    });
    await expect(s.get(URL)).rejects.toBeInstanceOf(ImageUpstreamError);
  });

  it('rejects disallowed sources before any fetch', async () => {
    const fetcher = vi.fn(async () => ({
      body: PNG,
      contentType: 'image/png',
    }));
    const s = svc({}, fetcher);
    await expect(s.get('https://evil.example.com/x.png')).rejects.toBeInstanceOf(
      ImageSourceNotAllowedError
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('LRU-evicts the oldest entries when over the byte cap', async () => {
    // Each blob is PNG.byteLength bytes; cap to just under two blobs so a
    // third write forces eviction of the least-recently-accessed entry.
    const s = svc(
      { maxBytes: PNG.byteLength * 2 + 1 },
      async () => ({ body: PNG, contentType: 'image/png' })
    );

    const urlA = 'https://coverartarchive.org/release/a/1-250.jpg';
    const urlB = 'https://coverartarchive.org/release/b/1-250.jpg';
    const urlC = 'https://coverartarchive.org/release/c/1-250.jpg';

    await s.get(urlA);
    await s.flushEvictions();
    // Make B newer than A by access time.
    await new Promise((r) => setTimeout(r, 10));
    await s.get(urlB);
    await s.flushEvictions();
    await new Promise((r) => setTimeout(r, 10));
    await s.get(urlC);
    await s.flushEvictions();

    // Total would be 3 blobs > cap (2). A (oldest) should have been evicted.
    const blobs = (await fs.readdir(cacheDir)).filter(
      (f) => !f.endsWith('.json')
    );
    expect(blobs.length).toBe(2);

    // A is gone → next get(A) is a miss; B and C are hits.
    expect((await s.get(urlA)).fromCache).toBe(false);
    expect((await s.get(urlB)).fromCache).toBe(true);
    expect((await s.get(urlC)).fromCache).toBe(true);
  });
});
