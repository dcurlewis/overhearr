import { http, HttpResponse, type DefaultBodyType, type StrictRequest } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  MusicBrainzNotFoundError,
  MusicBrainzRateLimitedError,
  MusicBrainzUnreachableError,
} from '../../server/lib/errors';
import { CoverArtClient } from '../../server/api/musicbrainz/coverArt';
import { MusicBrainzClient } from '../../server/api/musicbrainz';

import searchInRainbows from '../__fixtures__/musicbrainz/searchInRainbows.json';
import releaseInRainbows from '../__fixtures__/musicbrainz/releaseInRainbows.json';
import releaseGroupFallback from '../__fixtures__/musicbrainz/releaseGroupFallback.json';
import releaseFallbackCanonical from '../__fixtures__/musicbrainz/releaseFallbackCanonical.json';
import searchArtists from '../__fixtures__/musicbrainz/searchArtists.json';
import artistDiscography from '../__fixtures__/musicbrainz/artistDiscography.json';
import coverArtFixture from '../__fixtures__/musicbrainz/coverArt.json';

const MB_BASE = 'https://test-mb.example.com/ws/2';
const CAA_BASE = 'https://test-caa.example.com';

// --- Test handler counters & state -----------------------------------------

interface Counters {
  releaseSearch: number;
  artistSearch: number;
  releaseLookup: number;
  releaseGroupLookup: number;
  artistLookup: number;
  caaLookup: Record<string, number>;
}

const counters: Counters = {
  releaseSearch: 0,
  artistSearch: 0,
  releaseLookup: 0,
  releaseGroupLookup: 0,
  artistLookup: 0,
  caaLookup: {},
};

function resetCounters(): void {
  counters.releaseSearch = 0;
  counters.artistSearch = 0;
  counters.releaseLookup = 0;
  counters.releaseGroupLookup = 0;
  counters.artistLookup = 0;
  counters.caaLookup = {};
}

// Per-release CAA behavior: 'hit' returns the fixture, 'missing' returns 404,
// 'error' triggers an axios network failure.
const caaBehavior = new Map<string, 'hit' | 'missing' | 'error'>();

// Per-release lookup behavior: by default returns release fixture; can be
// switched to 'not-found' to return 404, or 'rate-limit' for 503.
const releaseBehavior = new Map<string, 'ok' | 'not-found' | 'rate-limit' | 'unreachable' | 'fallback-canonical'>();

const releaseGroupBehavior = new Map<string, 'ok' | 'not-found'>();

// --- Handlers --------------------------------------------------------------

const handlers = [
  http.get(`${MB_BASE}/release`, ({ request }) => {
    counters.releaseSearch += 1;
    const url = new URL(request.url);
    if (url.searchParams.get('query')) {
      return HttpResponse.json(searchInRainbows);
    }
    return HttpResponse.json({ count: 0, releases: [] });
  }),

  http.get(`${MB_BASE}/release/:mbid`, ({ params }) => {
    counters.releaseLookup += 1;
    const mbid = String(params.mbid);
    const behavior = releaseBehavior.get(mbid) ?? 'ok';
    if (behavior === 'not-found') {
      return HttpResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    if (behavior === 'rate-limit') {
      return HttpResponse.json({ error: 'rate limited' }, { status: 503 });
    }
    if (behavior === 'unreachable') {
      return HttpResponse.json({ error: 'server error' }, { status: 500 });
    }
    if (behavior === 'fallback-canonical') {
      return HttpResponse.json(releaseFallbackCanonical);
    }
    if (mbid === 'release-fallback-canonical') {
      return HttpResponse.json(releaseFallbackCanonical);
    }
    return HttpResponse.json(releaseInRainbows);
  }),

  http.get(`${MB_BASE}/release-group/:mbid`, ({ params }) => {
    counters.releaseGroupLookup += 1;
    const mbid = String(params.mbid);
    const behavior = releaseGroupBehavior.get(mbid) ?? 'ok';
    if (behavior === 'not-found') {
      return HttpResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    return HttpResponse.json(releaseGroupFallback);
  }),

  http.get(`${MB_BASE}/artist`, () => {
    counters.artistSearch += 1;
    return HttpResponse.json(searchArtists);
  }),

  http.get(`${MB_BASE}/artist/:mbid`, () => {
    counters.artistLookup += 1;
    return HttpResponse.json(artistDiscography);
  }),

  http.get(`${CAA_BASE}/release/:mbid`, ({ params }) => {
    const mbid = String(params.mbid);
    counters.caaLookup[mbid] = (counters.caaLookup[mbid] ?? 0) + 1;
    const behavior = caaBehavior.get(mbid) ?? 'missing';
    if (behavior === 'hit') {
      return HttpResponse.json(coverArtFixture);
    }
    if (behavior === 'error') {
      return HttpResponse.error();
    }
    return HttpResponse.json({ error: 'Not Found' }, { status: 404 });
  }),

  http.get(`${CAA_BASE}/release-group/:mbid`, ({ params }) => {
    const mbid = String(params.mbid);
    const key = `rg:${mbid}`;
    counters.caaLookup[key] = (counters.caaLookup[key] ?? 0) + 1;
    const behavior = caaBehavior.get(key) ?? 'missing';
    if (behavior === 'hit') {
      return HttpResponse.json(coverArtFixture);
    }
    if (behavior === 'error') {
      return HttpResponse.error();
    }
    return HttpResponse.json({ error: 'Not Found' }, { status: 404 });
  }),
];

const server = setupServer(...handlers);

// --- Lifecycle -------------------------------------------------------------

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers(...handlers);
  resetCounters();
  caaBehavior.clear();
  releaseBehavior.clear();
  releaseGroupBehavior.clear();
});
afterAll(() => server.close());

// --- Helpers ---------------------------------------------------------------

function makeClient(overrides: Partial<ConstructorParameters<typeof MusicBrainzClient>[0]> = {}) {
  return new MusicBrainzClient({
    baseUrl: MB_BASE,
    coverArtBaseUrl: CAA_BASE,
    minIntervalMs: 30,
    jitterMs: 0,
    searchCacheTtlMs: 5_000,
    detailCacheTtlMs: 5_000,
    ...overrides,
  });
}

// --- Tests -----------------------------------------------------------------

describe('MusicBrainzClient.searchAlbums', () => {
  it('dedupes by release-group, attaches cover art when available', async () => {
    caaBehavior.set('release-rainbows-001', 'hit');
    const client = makeClient();
    const result = await client.searchAlbums('in rainbows', 5);

    // 4 raw releases collapse to 3 distinct release-groups.
    expect(result.items.map((a) => a.releaseGroupMbid)).toEqual([
      'rg-rainbows',
      'rg-rainbows-disc2',
      'rg-rainbows-basement',
    ]);
    // The Official version of `rg-rainbows` should win over the Promotion.
    const main = result.items[0]!;
    expect(main.mbid).toBe('release-rainbows-001');
    expect(main.artistName).toBe('Radiohead');
    expect(main.coverArtUrl).toContain('front.jpg');
    expect(main.thumbnailUrl).toContain('front-500.jpg');
  });

  it('slices to limit', async () => {
    const client = makeClient();
    const result = await client.searchAlbums('rainbows', 1);
    expect(result.items).toHaveLength(1);
  });

  it('does not fail when CAA is unavailable', async () => {
    caaBehavior.set('release-rainbows-001', 'error');
    const client = makeClient();
    const result = await client.searchAlbums('in rainbows', 5);
    expect(result.items[0]!.coverArtUrl).toBeUndefined();
    // Other items 404 from CAA — they should also have no cover.
    expect(result.items.every((a) => typeof a.title === 'string')).toBe(true);
  });

  it('caches identical queries within TTL', async () => {
    const client = makeClient();
    await client.searchAlbums('in rainbows', 5);
    await client.searchAlbums('in rainbows', 5);
    expect(counters.releaseSearch).toBe(1);
  });
});

describe('MusicBrainzClient.getAlbum', () => {
  it('returns the album when the release endpoint hits directly', async () => {
    caaBehavior.set('release-rainbows-001', 'hit');
    const client = makeClient();
    const album = await client.getAlbum('release-rainbows-001');
    expect(album.title).toBe('In Rainbows');
    expect(album.tracks).toHaveLength(2);
    expect(album.tracks[0]).toMatchObject({
      position: 1,
      title: '15 Step',
      lengthMs: 237000,
    });
    expect(album.coverArtUrl).toContain('front.jpg');
  });

  it('falls back from release 404 to release-group → best release', async () => {
    releaseBehavior.set('rg-fallback', 'not-found');
    const client = makeClient();
    const album = await client.getAlbum('rg-fallback');
    // Best release should be the Official+earliest one.
    expect(album.mbid).toBe('release-fallback-canonical');
    expect(album.title).toBe('Fallback Album');
    expect(counters.releaseLookup).toBe(2);
    expect(counters.releaseGroupLookup).toBe(1);
  });

  it('throws MusicBrainzNotFoundError when both endpoints miss', async () => {
    releaseBehavior.set('totally-unknown', 'not-found');
    releaseGroupBehavior.set('totally-unknown', 'not-found');
    const client = makeClient();
    await expect(client.getAlbum('totally-unknown')).rejects.toBeInstanceOf(
      MusicBrainzNotFoundError
    );
  });
});

describe('MusicBrainzClient.searchArtists / getArtist', () => {
  it('maps artist search results', async () => {
    const client = makeClient();
    const result = await client.searchArtists('radiohead', 5);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      mbid: 'radiohead-mbid',
      name: 'Radiohead',
      country: 'GB',
      type: 'Group',
      disambiguation: 'English rock band',
    });
  });

  it('filters discography to Album-only and sorts desc by date', async () => {
    const client = makeClient();
    const details = await client.getArtist('radiohead-mbid');
    const titles = details.releaseGroups.map((rg) => rg.title);
    // Singles + EPs filtered out; "The Best Of" (Album+Compilation) kept since
    // the spec only says filter to primary-type === 'Album'.
    expect(titles).toEqual(['The Best Of', 'In Rainbows', 'OK Computer']);
    expect(details.releaseGroups.every((rg) => rg.primaryType === 'Album')).toBe(true);
  });
});

describe('MusicBrainzClient: rate limiting', () => {
  it('spaces consecutive calls by at least minIntervalMs', async () => {
    const client = makeClient({ minIntervalMs: 100, jitterMs: 0 });
    const t0 = Date.now();
    await client.searchArtists('a', 1);
    await client.searchArtists('b', 1);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(95);
  });
});

describe('MusicBrainzClient: error mapping', () => {
  it('maps 503 to MusicBrainzRateLimitedError', async () => {
    releaseBehavior.set('release-rl', 'rate-limit');
    const client = makeClient();
    await expect(client.getAlbum('release-rl')).rejects.toBeInstanceOf(
      MusicBrainzRateLimitedError
    );
  });

  it('maps 5xx to MusicBrainzUnreachableError', async () => {
    releaseBehavior.set('release-bad', 'unreachable');
    const client = makeClient();
    await expect(client.getAlbum('release-bad')).rejects.toBeInstanceOf(
      MusicBrainzUnreachableError
    );
  });

  it('maps network failure to MusicBrainzUnreachableError', async () => {
    server.use(
      http.get(`${MB_BASE}/release/:mbid`, () => HttpResponse.error())
    );
    const client = makeClient();
    await expect(client.getAlbum('anything')).rejects.toBeInstanceOf(
      MusicBrainzUnreachableError
    );
  });

  it('maps 404 to MusicBrainzNotFoundError on direct artist lookup', async () => {
    server.use(
      http.get(`${MB_BASE}/artist/:mbid`, () =>
        HttpResponse.json({ error: 'gone' }, { status: 404 })
      )
    );
    const client = makeClient();
    await expect(client.getArtist('missing-artist')).rejects.toBeInstanceOf(
      MusicBrainzNotFoundError
    );
  });
});

describe('CoverArtClient', () => {
  it('returns urls on hit', async () => {
    caaBehavior.set('release-rainbows-001', 'hit');
    const caa = new CoverArtClient({ baseUrl: CAA_BASE });
    const cover = await caa.getCoverArt('release-rainbows-001');
    expect(cover.frontUrl).toContain('front.jpg');
    expect(cover.thumbnailUrl).toContain('500');
  });

  it('negative-caches 404s (single CAA call across two lookups)', async () => {
    const caa = new CoverArtClient({ baseUrl: CAA_BASE });
    const first = await caa.getCoverArt('release-no-cover');
    const second = await caa.getCoverArt('release-no-cover');
    expect(first).toEqual({});
    expect(second).toEqual({});
    expect(counters.caaLookup['release-no-cover']).toBe(1);
  });

  it('returns {} on network error without throwing', async () => {
    caaBehavior.set('release-error', 'error');
    const caa = new CoverArtClient({ baseUrl: CAA_BASE });
    const cover = await caa.getCoverArt('release-error');
    expect(cover).toEqual({});
  });

  it('getReleaseGroupCoverArt returns urls on hit and caches', async () => {
    caaBehavior.set('rg:rg-rainbows', 'hit');
    const caa = new CoverArtClient({ baseUrl: CAA_BASE });
    const first = await caa.getReleaseGroupCoverArt('rg-rainbows');
    const second = await caa.getReleaseGroupCoverArt('rg-rainbows');
    expect(first.frontUrl).toContain('front.jpg');
    expect(second.frontUrl).toContain('front.jpg');
    expect(counters.caaLookup['rg:rg-rainbows']).toBe(1);
  });

  it('getReleaseGroupCoverArt returns {} on 404', async () => {
    const caa = new CoverArtClient({ baseUrl: CAA_BASE });
    const cover = await caa.getReleaseGroupCoverArt('rg-missing');
    expect(cover).toEqual({});
  });
});

describe('MusicBrainzClient.getReleaseGroupCoverArt', () => {
  it('proxies to the CoverArtClient and degrades to {} on error', async () => {
    caaBehavior.set('rg:rg-rainbows', 'hit');
    const client = makeClient();
    const cover = await client.getReleaseGroupCoverArt('rg-rainbows');
    expect(cover.frontUrl).toContain('front.jpg');

    // Network failures must not throw out of the wrapper.
    caaBehavior.set('rg:rg-broken', 'error');
    const broken = await client.getReleaseGroupCoverArt('rg-broken');
    expect(broken).toEqual({});
  });
});
