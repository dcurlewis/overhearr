/**
 * ListenBrainz client unit tests.
 *
 * msw stands in for the real API. ListenBrainz sitewide stats are anonymous
 * and the client carries no API key, so there is no "unconfigured" path to
 * cover — every test boots a fresh client with the test base URL and routes
 * into msw handlers. The Discover route's per-section settle() turns
 * `ListenBrainzUnreachableError` into `[]`, so the test for failure cases
 * just asserts the error class.
 */

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { ListenBrainzClient } from '../../server/api/listenbrainz';
import { ListenBrainzUnreachableError } from '../../server/api/listenbrainz/errors';

import releaseGroupsFixture from '../__fixtures__/listenbrainz/sitewide-release-groups.json';
import artistsFixture from '../__fixtures__/listenbrainz/sitewide-artists.json';
import similarArtistsFixture from '../__fixtures__/listenbrainz/similar-artists.json';

const BASE_URL = 'https://listenbrainz.test';
const LABS_URL = 'https://labs.listenbrainz.test';

type HandlerPath = 'release-groups' | 'artists' | 'similar-artists';
type PathHandler = (req: Request, url: URL) => Response | Promise<Response>;
let pathHandlers: Map<HandlerPath, PathHandler>;

function buildServer(): ReturnType<typeof setupServer> {
  return setupServer(
    http.get(`${BASE_URL}/1/stats/sitewide/release-groups`, ({ request }) => {
      const url = new URL(request.url);
      const handler = pathHandlers.get('release-groups');
      if (!handler) return HttpResponse.json({ payload: { release_groups: [] } });
      return handler(request, url) as Response;
    }),
    http.get(`${BASE_URL}/1/stats/sitewide/artists`, ({ request }) => {
      const url = new URL(request.url);
      const handler = pathHandlers.get('artists');
      if (!handler) return HttpResponse.json({ payload: { artists: [] } });
      return handler(request, url) as Response;
    }),
    http.get(`${LABS_URL}/similar-artists/json`, ({ request }) => {
      const url = new URL(request.url);
      const handler = pathHandlers.get('similar-artists');
      if (!handler) return HttpResponse.json([]);
      return handler(request, url) as Response;
    })
  );
}

const server = buildServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

beforeEach(() => {
  pathHandlers = new Map();
});

afterEach(() => {
  server.resetHandlers();
});

function buildClient(overrides: Partial<{ ttlMs: number }> = {}): ListenBrainzClient {
  return new ListenBrainzClient({
    baseUrl: BASE_URL,
    labsBaseUrl: LABS_URL,
    cacheTtlMs: overrides.ttlMs ?? 60_000,
    timeoutMs: 2_000,
  });
}

function setHandler(path: HandlerPath, handler: PathHandler): void {
  pathHandlers.set(path, handler);
}

describe('ListenBrainzClient — happy paths', () => {
  it('getTopReleaseGroups maps the fixture, derives CAA URLs, and drops empty names', async () => {
    setHandler('release-groups', () => HttpResponse.json(releaseGroupsFixture));
    const client = buildClient();
    const albums = await client.getTopReleaseGroups({ count: 5 });

    // Fixture has 3 entries; one with an empty name is dropped.
    expect(albums).toHaveLength(2);

    const first = albums[0]!;
    expect(first.name).toBe('Currents');
    expect(first.artist).toBe('Tame Impala');
    expect(first.mbid).toBe('ad010f4f-aa3a-4abb-a8a8-09c819a8e9d3');
    expect(first.artistMbid).toBe('63aa26c3-d59b-4da4-84ac-716b54f1ef4d');
    expect(first.imageUrl).toContain(
      'coverartarchive.org/release/5a334e2c-5b56-3d4c-bd2d-8e00fe27a8a9/31102104285'
    );
    expect(first.playcount).toBe(12345678);

    // Second row has empty mbid → mbid undefined; no caa fields → no imageUrl.
    const second = albums[1]!;
    expect(second.mbid).toBeUndefined();
    expect(second.imageUrl).toBeUndefined();
  });

  it('getTopArtists maps fixture, carries mbid through when present', async () => {
    setHandler('artists', () => HttpResponse.json(artistsFixture));
    const client = buildClient();
    const artists = await client.getTopArtists({ count: 5 });
    expect(artists).toHaveLength(2);
    expect(artists[0]!.name).toBe('Radiohead');
    expect(artists[0]!.mbid).toBe('a74b1b7f-71a5-4011-9441-d0b5e4122711');
    expect(artists[0]!.playcount).toBe(920_000_000);
    expect(artists[1]!.mbid).toBeUndefined();
  });

  it('forwards the requested range to the upstream as the `range` query param', async () => {
    let captured: string | null = null;
    setHandler('release-groups', (_req, url) => {
      captured = url.searchParams.get('range');
      return HttpResponse.json({ payload: { release_groups: [] } });
    });
    const client = buildClient();
    await client.getTopReleaseGroups({ range: 'week', count: 3 });
    expect(captured).toBe('week');
  });
});

describe('ListenBrainzClient — failure paths', () => {
  it('throws ListenBrainzUnreachableError on non-2xx', async () => {
    setHandler('release-groups', () =>
      HttpResponse.json({ message: 'oh no' }, { status: 503 })
    );
    const client = buildClient();
    await expect(client.getTopReleaseGroups()).rejects.toBeInstanceOf(
      ListenBrainzUnreachableError
    );
  });

  it('throws ListenBrainzUnreachableError on network failure', async () => {
    setHandler('artists', () => HttpResponse.error());
    const client = buildClient();
    await expect(client.getTopArtists()).rejects.toBeInstanceOf(
      ListenBrainzUnreachableError
    );
  });

  it('returns an empty array for malformed payloads (missing payload.release_groups)', async () => {
    setHandler('release-groups', () => HttpResponse.json({ payload: {} }));
    const client = buildClient();
    await expect(client.getTopReleaseGroups()).resolves.toEqual([]);
  });
});

describe('ListenBrainzClient — cache', () => {
  it('memoises by (range,count) — second call does not hit the network', async () => {
    let calls = 0;
    setHandler('release-groups', () => {
      calls += 1;
      return HttpResponse.json(releaseGroupsFixture);
    });
    const client = buildClient();
    await client.getTopReleaseGroups({ count: 5 });
    await client.getTopReleaseGroups({ count: 5 });
    expect(calls).toBe(1);
    // Different count → different cache key → second hit.
    await client.getTopReleaseGroups({ count: 3 });
    expect(calls).toBe(2);
  });

  it('clearCache forgets memoised entries', async () => {
    let calls = 0;
    setHandler('release-groups', () => {
      calls += 1;
      return HttpResponse.json(releaseGroupsFixture);
    });
    const client = buildClient();
    await client.getTopReleaseGroups();
    client.clearCache();
    await client.getTopReleaseGroups();
    expect(calls).toBe(2);
  });
});

describe('ListenBrainzClient — getSimilarArtists', () => {
  it('maps the fixture, drops rows without an mbid or name, and dedupes', async () => {
    setHandler('similar-artists', () => HttpResponse.json(similarArtistsFixture));
    const client = buildClient();
    const artists = await client.getSimilarArtists(
      '83d91898-7763-47d7-b03b-b92132375c47'
    );
    // Fixture has 4 rows: 2 usable, 1 missing mbid, 1 with empty name → 2 kept.
    expect(artists).toHaveLength(2);
    expect(artists[0]).toEqual({
      mbid: 'b7ffd2af-418f-4be2-bdd1-22f8b48613da',
      name: 'Nine Inch Nails',
    });
    expect(artists[1]!.name).toBe('Placebo');
  });

  it('sends the artist mbid + algorithm as query params', async () => {
    let capturedMbid: string | null = null;
    let capturedAlgo: string | null = null;
    setHandler('similar-artists', (_req, url) => {
      capturedMbid = url.searchParams.get('artist_mbids');
      capturedAlgo = url.searchParams.get('algorithm');
      return HttpResponse.json([]);
    });
    const client = buildClient();
    await client.getSimilarArtists('seed-mbid');
    expect(capturedMbid).toBe('seed-mbid');
    expect(capturedAlgo).toMatch(/^session_based_/);
  });

  it('caps results at the requested count', async () => {
    setHandler('similar-artists', () => HttpResponse.json(similarArtistsFixture));
    const client = buildClient();
    const artists = await client.getSimilarArtists('seed-mbid', { count: 1 });
    expect(artists).toHaveLength(1);
  });

  it('excludes the seed artist if it appears in its own list', async () => {
    setHandler('similar-artists', () =>
      HttpResponse.json([
        { artist_mbid: 'seed-mbid', name: 'Self' },
        { artist_mbid: 'other-mbid', name: 'Other' },
      ])
    );
    const client = buildClient();
    const artists = await client.getSimilarArtists('seed-mbid');
    expect(artists).toEqual([{ mbid: 'other-mbid', name: 'Other' }]);
  });

  it('tolerates the nested-array envelope shape', async () => {
    setHandler('similar-artists', () =>
      HttpResponse.json([
        { some: 'metadata' },
        [{ artist_mbid: 'nested-mbid', name: 'Nested' }],
      ])
    );
    const client = buildClient();
    const artists = await client.getSimilarArtists('seed-mbid');
    expect(artists).toEqual([{ mbid: 'nested-mbid', name: 'Nested' }]);
  });

  it('throws ListenBrainzUnreachableError on non-2xx', async () => {
    setHandler('similar-artists', () =>
      HttpResponse.json({ message: 'down' }, { status: 503 })
    );
    const client = buildClient();
    await expect(client.getSimilarArtists('seed-mbid')).rejects.toBeInstanceOf(
      ListenBrainzUnreachableError
    );
  });
});
