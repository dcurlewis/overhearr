/**
 * Last.fm client unit tests.
 *
 * msw stands in for the Last.fm API. We dispatch on the `?method=` query
 * param so a single base URL can route to the right fixture (or error). The
 * `apiKeyProvider` is a stub function the tests rebind per-case to drive
 * the unconfigured / configured paths.
 */

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { LastfmClient } from '../../server/api/lastfm';
import {
  LastfmInvalidKeyError,
  LastfmNotConfiguredError,
  LastfmUnreachableError,
} from '../../server/api/lastfm/errors';

import topAlbumsFixture from '../__fixtures__/lastfm/chart-gettopalbums.json';
import topArtistsFixture from '../__fixtures__/lastfm/chart-gettopartists.json';
import geoFixture from '../__fixtures__/lastfm/geo-gettopalbums.json';
import invalidKeyFixture from '../__fixtures__/lastfm/error-invalid-key.json';

const BASE_URL = 'https://lastfm.test/2.0/';

// ---- msw infrastructure ---------------------------------------------------

type MethodHandler = (req: Request, url: URL) => Response | Promise<Response>;
let methodHandlers: Map<string, MethodHandler>;
let methodCallCount: Map<string, number>;

const server = setupServer(
  http.get('https://lastfm.test/2.0/', ({ request }) => {
    const url = new URL(request.url);
    const method = url.searchParams.get('method') ?? '';
    methodCallCount.set(method, (methodCallCount.get(method) ?? 0) + 1);
    const handler = methodHandlers.get(method);
    if (!handler) {
      return HttpResponse.json(
        { error: 6, message: `no test handler registered for ${method}` },
        { status: 200 }
      );
    }
    return handler(request, url) as Response;
  })
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

beforeEach(() => {
  methodHandlers = new Map();
  methodCallCount = new Map();
});

afterEach(() => {
  server.resetHandlers(
    http.get('https://lastfm.test/2.0/', ({ request }) => {
      const url = new URL(request.url);
      const method = url.searchParams.get('method') ?? '';
      methodCallCount.set(method, (methodCallCount.get(method) ?? 0) + 1);
      const handler = methodHandlers.get(method);
      if (!handler) {
        return HttpResponse.json(
          { error: 6, message: `no test handler registered for ${method}` },
          { status: 200 }
        );
      }
      return handler(request, url) as Response;
    })
  );
});

// ---- helpers --------------------------------------------------------------

function buildClient(overrides: Partial<{
  apiKey: string | null;
  ttlMs: number;
}> = {}): { client: LastfmClient; provider: () => Promise<string | null> } {
  const value = overrides.apiKey === undefined ? 'TESTKEY' : overrides.apiKey;
  const provider: () => Promise<string | null> = vi.fn(async () => value);
  const client = new LastfmClient({
    apiKeyProvider: provider,
    baseUrl: BASE_URL,
    cacheTtlMs: overrides.ttlMs ?? 60_000,
    timeoutMs: 2_000,
  });
  return { client, provider };
}

function setMethod(method: string, handler: MethodHandler): void {
  methodHandlers.set(method, handler);
}

// ---- tests ----------------------------------------------------------------

describe('LastfmClient — configured happy paths', () => {
  it('getTopAlbums maps fixture into LastfmAlbum[] with mbid carried through', async () => {
    setMethod('chart.gettopalbums', () => HttpResponse.json(topAlbumsFixture));
    const { client } = buildClient();
    const albums = await client.getTopAlbums(2);
    expect(albums).toHaveLength(2);

    const first = albums[0]!;
    expect(first.name).toBe('Currents');
    expect(first.artist).toBe('Tame Impala');
    expect(first.mbid).toBe('ad010f4f-aa3a-4abb-a8a8-09c819a8e9d3');
    expect(first.artistMbid).toBe('63aa26c3-d59b-4da4-84ac-716b54f1ef4d');
    expect(first.imageUrl).toBe('https://lastfm.example/xl.png');
    expect(first.playcount).toBe(12345678);
    expect(first.listeners).toBe(999000);

    // Empty mbid + empty extralarge image url → mbid undefined, fallback to small.
    const second = albums[1]!;
    expect(second.mbid).toBeUndefined();
    expect(second.artistMbid).toBeUndefined();
    expect(second.imageUrl).toBe('https://lastfm.example/sm2.png');
  });

  it('getTopArtists maps fixture and prefers mega image when present', async () => {
    setMethod('chart.gettopartists', () => HttpResponse.json(topArtistsFixture));
    const { client } = buildClient();
    const artists = await client.getTopArtists();
    expect(artists).toHaveLength(2);
    expect(artists[0]!.name).toBe('Radiohead');
    expect(artists[0]!.mbid).toBe('a74b1b7f-71a5-4011-9441-d0b5e4122711');
    expect(artists[0]!.imageUrl).toBe('https://lastfm.example/r-mega.png');
    expect(artists[0]!.playcount).toBe(987654321);

    expect(artists[1]!.name).toBe('Nameless');
    expect(artists[1]!.mbid).toBeUndefined();
    expect(artists[1]!.imageUrl).toBeUndefined();
  });

  it('getGeoTopAlbums passes country query and maps fixture', async () => {
    let observedCountry: string | null = null;
    setMethod('geo.gettopalbums', (_req, url) => {
      observedCountry = url.searchParams.get('country');
      return HttpResponse.json(geoFixture);
    });
    const { client } = buildClient();
    const albums = await client.getGeoTopAlbums('United States', 5);
    expect(observedCountry).toBe('United States');
    expect(albums).toHaveLength(1);
    expect(albums[0]!.name).toBe('Folklore');
    expect(albums[0]!.artist).toBe('Taylor Swift');
    expect(albums[0]!.mbid).toBe('f00b00f0-0000-0000-0000-000000000001');
  });
});

describe('LastfmClient — unconfigured path', () => {
  it('throws LastfmNotConfiguredError when apiKeyProvider returns null', async () => {
    const { client } = buildClient({ apiKey: null });
    await expect(client.getTopAlbums()).rejects.toBeInstanceOf(LastfmNotConfiguredError);
    await expect(client.getTopArtists()).rejects.toBeInstanceOf(LastfmNotConfiguredError);
    await expect(client.getGeoTopAlbums()).rejects.toBeInstanceOf(LastfmNotConfiguredError);
    // No upstream hits should have happened.
    expect(methodCallCount.size).toBe(0);
  });

  it('does not populate cache on unconfigured failure', async () => {
    const { client } = buildClient({ apiKey: null });
    await expect(client.getTopAlbums()).rejects.toBeInstanceOf(LastfmNotConfiguredError);
    // Now configure and ensure the next call actually hits upstream (cache empty).
    setMethod('chart.gettopalbums', () => HttpResponse.json(topAlbumsFixture));
    // Swap provider to return a key by building a new client (apiKeyProvider is fixed).
    const { client: client2 } = buildClient();
    const albums = await client2.getTopAlbums();
    expect(albums.length).toBeGreaterThan(0);
    expect(methodCallCount.get('chart.gettopalbums')).toBe(1);
  });

  it('getDiscover throws LastfmNotConfiguredError without firing requests', async () => {
    const { client } = buildClient({ apiKey: null });
    await expect(client.getDiscover()).rejects.toBeInstanceOf(LastfmNotConfiguredError);
    expect(methodCallCount.size).toBe(0);
  });
});

describe('LastfmClient — invalid key', () => {
  it('throws LastfmInvalidKeyError when Last.fm returns error code 10', async () => {
    setMethod('chart.gettopalbums', () => HttpResponse.json(invalidKeyFixture));
    const { client } = buildClient();
    await expect(client.getTopAlbums()).rejects.toBeInstanceOf(LastfmInvalidKeyError);
  });

  it('throws LastfmUnreachableError for non-10 Last.fm error codes', async () => {
    setMethod('chart.gettopartists', () =>
      HttpResponse.json({ error: 11, message: 'Service Offline' })
    );
    const { client } = buildClient();
    await expect(client.getTopArtists()).rejects.toBeInstanceOf(LastfmUnreachableError);
  });
});

describe('LastfmClient — network errors', () => {
  it('throws LastfmUnreachableError on network failure', async () => {
    setMethod('chart.gettopalbums', () => HttpResponse.error());
    const { client } = buildClient();
    await expect(client.getTopAlbums()).rejects.toBeInstanceOf(LastfmUnreachableError);
  });
});

describe('LastfmClient — getDiscover aggregation', () => {
  it('returns aggregate when all three succeed', async () => {
    setMethod('chart.gettopalbums', () => HttpResponse.json(topAlbumsFixture));
    setMethod('chart.gettopartists', () => HttpResponse.json(topArtistsFixture));
    setMethod('geo.gettopalbums', () => HttpResponse.json(geoFixture));
    const { client } = buildClient();
    const data = await client.getDiscover();
    expect(data.topAlbums.length).toBeGreaterThan(0);
    expect(data.topArtists.length).toBeGreaterThan(0);
    expect(data.newReleases.length).toBeGreaterThan(0);
  });

  it('degrades a failing section to empty array; others still populated', async () => {
    setMethod('chart.gettopalbums', () => HttpResponse.json(topAlbumsFixture));
    setMethod('chart.gettopartists', () => HttpResponse.error());
    setMethod('geo.gettopalbums', () => HttpResponse.json(geoFixture));
    const { client } = buildClient();
    const data = await client.getDiscover();
    expect(data.topAlbums.length).toBeGreaterThan(0);
    expect(data.topArtists).toEqual([]);
    expect(data.newReleases.length).toBeGreaterThan(0);
  });

  it('does not throw when all three sections fail; just returns empties', async () => {
    setMethod('chart.gettopalbums', () => HttpResponse.error());
    setMethod('chart.gettopartists', () => HttpResponse.error());
    setMethod('geo.gettopalbums', () => HttpResponse.error());
    const { client } = buildClient();
    const data = await client.getDiscover();
    expect(data).toEqual({ topAlbums: [], topArtists: [], newReleases: [] });
  });
});

describe('LastfmClient — caching', () => {
  it('second call within TTL hits cache (handler invoked once)', async () => {
    setMethod('chart.gettopalbums', () => HttpResponse.json(topAlbumsFixture));
    const { client } = buildClient();
    const a = await client.getTopAlbums(24);
    const b = await client.getTopAlbums(24);
    expect(a).toEqual(b);
    expect(methodCallCount.get('chart.gettopalbums')).toBe(1);
  });

  it('clearCache forces a re-fetch', async () => {
    setMethod('chart.gettopalbums', () => HttpResponse.json(topAlbumsFixture));
    const { client } = buildClient();
    await client.getTopAlbums();
    client.clearCache();
    await client.getTopAlbums();
    expect(methodCallCount.get('chart.gettopalbums')).toBe(2);
  });

  it('different argument values yield independent cache entries', async () => {
    setMethod('chart.gettopalbums', () => HttpResponse.json(topAlbumsFixture));
    const { client } = buildClient();
    await client.getTopAlbums(10);
    await client.getTopAlbums(20);
    expect(methodCallCount.get('chart.gettopalbums')).toBe(2);
  });
});
