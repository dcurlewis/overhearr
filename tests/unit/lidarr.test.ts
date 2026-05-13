/**
 * LidarrClient unit tests.
 *
 * msw fronts a fake Lidarr at `http://test-lidarr.local:8686`. Each describe
 * block builds a fresh client (with a tiny artist-list cache TTL where
 * relevant) so cache-bleed across tests is impossible.
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
  vi,
} from 'vitest';

import { LidarrClient, normalizeLidarrBaseUrl } from '../../server/api/lidarr';
import {
  lidarrClientCache,
  getLidarrClient,
} from '../../server/api/lidarr/factory';
import {
  LidarrAlbumNotFoundError,
  LidarrAlreadyExistsError,
  LidarrArtistNotFoundError,
  LidarrAuthError,
  LidarrError,
  LidarrMetadataUnavailableError,
  LidarrUnreachableError,
} from '../../server/lib/errors';
import { settingsService } from '../../server/services/settingsService';

import systemStatusFixture from '../__fixtures__/lidarr/system-status.json';
import rootFoldersFixture from '../__fixtures__/lidarr/rootfolders.json';
import qualityProfilesFixture from '../__fixtures__/lidarr/quality-profiles.json';
import metadataProfilesFixture from '../__fixtures__/lidarr/metadata-profiles.json';
import artistLookupRadiohead from '../__fixtures__/lidarr/artist-lookup-radiohead.json';
import artistLookupEmpty from '../__fixtures__/lidarr/artist-lookup-empty.json';
import artistList from '../__fixtures__/lidarr/artist-list.json';
import albumLookupInRainbows from '../__fixtures__/lidarr/album-lookup-in-rainbows.json';
import albumLookupMetadataDown from '../__fixtures__/lidarr/album-lookup-metadata-down.json';
import addArtistSuccess from '../__fixtures__/lidarr/add-artist-success.json';
import addAlbumSuccess from '../__fixtures__/lidarr/add-album-success.json';
import addArtistAlreadyExists from '../__fixtures__/lidarr/add-artist-already-exists.json';
import albumStatsDownloaded from '../__fixtures__/lidarr/album-stats-downloaded.json';
import albumStatsPending from '../__fixtures__/lidarr/album-stats-pending.json';

const BASE = 'http://test-lidarr.local:8686';
const API = `${BASE}/api/v1`;
const RADIOHEAD_MBID = 'a74b1b7f-71a5-4011-9441-d0b5e4122711';
const IN_RAINBOWS_MBID = 'b1392450-e666-3926-a536-22c65f834433';

// ---- msw infrastructure ---------------------------------------------------

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

// Counter wrapper to assert msw call counts per endpoint per test.
type CallCounts = Map<string, number>;
function bumpCount(counts: CallCounts, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function buildClient(
  overrides: Partial<{ apiKey: string; timeoutMs: number; ttlMs: number }> = {}
): LidarrClient {
  return new LidarrClient({
    url: BASE,
    apiKey: overrides.apiKey ?? 'test-key',
    timeoutMs: overrides.timeoutMs ?? 1_000,
    artistListCacheTtlMs: overrides.ttlMs ?? 60_000,
  });
}

// ---- normalizeLidarrBaseUrl ----------------------------------------------

describe('normalizeLidarrBaseUrl', () => {
  it('appends /api/v1 when missing', () => {
    expect(normalizeLidarrBaseUrl('http://lidarr:8686')).toBe(
      'http://lidarr:8686/api/v1'
    );
  });
  it('strips trailing slashes before appending', () => {
    expect(normalizeLidarrBaseUrl('http://lidarr:8686////')).toBe(
      'http://lidarr:8686/api/v1'
    );
  });
  it('leaves an existing /api/v1 alone', () => {
    expect(normalizeLidarrBaseUrl('http://lidarr:8686/api/v1')).toBe(
      'http://lidarr:8686/api/v1'
    );
  });
  it('matches /api/v1 case-insensitively', () => {
    expect(normalizeLidarrBaseUrl('http://lidarr:8686/API/V1')).toBe(
      'http://lidarr:8686/API/V1'
    );
  });
});

// ---- testConnection -------------------------------------------------------

describe('testConnection', () => {
  it('returns version + instanceName on success', async () => {
    server.use(
      http.get(`${API}/system/status`, () => HttpResponse.json(systemStatusFixture))
    );
    const c = buildClient();
    const status = await c.testConnection();
    expect(status.version).toBe('2.4.3.4248');
    expect(status.instanceName).toBe('Lidarr');
  });

  it('classifies 401 as LidarrAuthError', async () => {
    server.use(
      http.get(`${API}/system/status`, () =>
        HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })
      )
    );
    const c = buildClient();
    await expect(c.testConnection()).rejects.toBeInstanceOf(LidarrAuthError);
  });

  it('classifies network error as LidarrUnreachableError', async () => {
    server.use(http.get(`${API}/system/status`, () => HttpResponse.error()));
    const c = buildClient();
    await expect(c.testConnection()).rejects.toBeInstanceOf(
      LidarrUnreachableError
    );
  });
});

// ---- getRootFolders / getQualityProfiles / getMetadataProfiles ------------

describe('config endpoints', () => {
  it('getRootFolders returns the parsed list', async () => {
    server.use(
      http.get(`${API}/rootfolder`, () => HttpResponse.json(rootFoldersFixture))
    );
    const c = buildClient();
    const folders = await c.getRootFolders();
    expect(folders).toHaveLength(2);
    expect(folders[0]?.path).toBe('/music');
  });

  it('getQualityProfiles returns the parsed list', async () => {
    server.use(
      http.get(`${API}/qualityprofile`, () =>
        HttpResponse.json(qualityProfilesFixture)
      )
    );
    const c = buildClient();
    const profiles = await c.getQualityProfiles();
    expect(profiles).toEqual([
      { id: 1, name: 'Any' },
      { id: 2, name: 'Lossless' },
    ]);
  });

  it('getMetadataProfiles returns the parsed list', async () => {
    server.use(
      http.get(`${API}/metadataprofile`, () =>
        HttpResponse.json(metadataProfilesFixture)
      )
    );
    const c = buildClient();
    const profiles = await c.getMetadataProfiles();
    expect(profiles).toHaveLength(2);
  });

  it('classifies metadata-server-down (200 with {message}) as MetadataUnavailable', async () => {
    server.use(
      http.get(`${API}/rootfolder`, () =>
        HttpResponse.json({ message: 'Failed to query MusicBrainz' })
      )
    );
    const c = buildClient();
    await expect(c.getRootFolders()).rejects.toBeInstanceOf(
      LidarrMetadataUnavailableError
    );
  });
});

// ---- lookupArtist ---------------------------------------------------------

describe('lookupArtist', () => {
  it('returns the result via the lidarr:<mbid> prefix', async () => {
    server.use(
      http.get(`${API}/artist/lookup`, ({ request }) => {
        const term = new URL(request.url).searchParams.get('term');
        if (term === `lidarr:${RADIOHEAD_MBID}`) {
          return HttpResponse.json(artistLookupRadiohead);
        }
        return HttpResponse.json(artistLookupEmpty);
      })
    );
    const c = buildClient();
    const result = await c.lookupArtist(RADIOHEAD_MBID);
    expect(result?.foreignArtistId).toBe(RADIOHEAD_MBID);
    expect(result?.artistName).toBe('Radiohead');
  });

  it('falls back to bare mbid when prefix returns empty', async () => {
    const counts: CallCounts = new Map();
    server.use(
      http.get(`${API}/artist/lookup`, ({ request }) => {
        const term = new URL(request.url).searchParams.get('term') ?? '';
        bumpCount(counts, term);
        if (term.startsWith('lidarr:')) return HttpResponse.json([]);
        return HttpResponse.json(artistLookupRadiohead);
      })
    );
    const c = buildClient();
    const result = await c.lookupArtist(RADIOHEAD_MBID);
    expect(result?.foreignArtistId).toBe(RADIOHEAD_MBID);
    expect(counts.get(`lidarr:${RADIOHEAD_MBID}`)).toBe(1);
    expect(counts.get(RADIOHEAD_MBID)).toBe(1);
  });

  it('returns null when both lookups are empty', async () => {
    server.use(
      http.get(`${API}/artist/lookup`, () => HttpResponse.json([]))
    );
    const c = buildClient();
    const result = await c.lookupArtist(RADIOHEAD_MBID);
    expect(result).toBeNull();
  });

  it('reclassifies metadata error to MetadataUnavailable', async () => {
    server.use(
      http.get(`${API}/artist/lookup`, () =>
        HttpResponse.json({ message: 'Failed to query MusicBrainz' })
      )
    );
    const c = buildClient();
    await expect(c.lookupArtist(RADIOHEAD_MBID)).rejects.toBeInstanceOf(
      LidarrMetadataUnavailableError
    );
  });
});

// ---- lookupAlbum ----------------------------------------------------------

describe('lookupAlbum', () => {
  it('returns the album from the lidarr: prefix path', async () => {
    server.use(
      http.get(`${API}/album/lookup`, ({ request }) => {
        const term = new URL(request.url).searchParams.get('term') ?? '';
        if (term === `lidarr:${IN_RAINBOWS_MBID}`) {
          return HttpResponse.json(albumLookupInRainbows);
        }
        return HttpResponse.json([]);
      })
    );
    const c = buildClient();
    const album = await c.lookupAlbum(IN_RAINBOWS_MBID);
    expect(album?.title).toBe('In Rainbows');
    expect(album?.foreignAlbumId).toBe(IN_RAINBOWS_MBID);
  });

  it('falls back to bare-mbid path when prefix is empty', async () => {
    server.use(
      http.get(`${API}/album/lookup`, ({ request }) => {
        const term = new URL(request.url).searchParams.get('term') ?? '';
        if (term === IN_RAINBOWS_MBID) {
          return HttpResponse.json(albumLookupInRainbows);
        }
        return HttpResponse.json([]);
      })
    );
    const c = buildClient();
    const album = await c.lookupAlbum(IN_RAINBOWS_MBID);
    expect(album?.title).toBe('In Rainbows');
  });

  it('returns null when nothing matches', async () => {
    server.use(http.get(`${API}/album/lookup`, () => HttpResponse.json([])));
    const c = buildClient();
    expect(await c.lookupAlbum(IN_RAINBOWS_MBID)).toBeNull();
  });

  it('classifies the metadata-down 200 response as MetadataUnavailable', async () => {
    server.use(
      http.get(`${API}/album/lookup`, () =>
        HttpResponse.json(albumLookupMetadataDown)
      )
    );
    const c = buildClient();
    await expect(c.lookupAlbum(IN_RAINBOWS_MBID)).rejects.toBeInstanceOf(
      LidarrMetadataUnavailableError
    );
  });
});

// ---- getArtistByMbid (cache!) --------------------------------------------

describe('getArtistByMbid + cache', () => {
  it('returns the matching artist from the library', async () => {
    server.use(
      http.get(`${API}/artist`, () => HttpResponse.json(artistList))
    );
    const c = buildClient();
    const a = await c.getArtistByMbid(RADIOHEAD_MBID);
    expect(a?.id).toBe(42);
  });

  it('returns null when not in the library', async () => {
    server.use(
      http.get(`${API}/artist`, () => HttpResponse.json(artistList))
    );
    const c = buildClient();
    expect(await c.getArtistByMbid('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('caches the artist list across calls within TTL', async () => {
    const counts: CallCounts = new Map();
    server.use(
      http.get(`${API}/artist`, () => {
        bumpCount(counts, 'list');
        return HttpResponse.json(artistList);
      })
    );
    const c = buildClient({ ttlMs: 60_000 });
    await c.getArtistByMbid(RADIOHEAD_MBID);
    await c.getArtistByMbid(RADIOHEAD_MBID);
    await c.getArtistByMbid('not-a-thing');
    expect(counts.get('list')).toBe(1);
  });

  it('expires the cache after TTL elapses', async () => {
    const counts: CallCounts = new Map();
    server.use(
      http.get(`${API}/artist`, () => {
        bumpCount(counts, 'list');
        return HttpResponse.json(artistList);
      })
    );
    const c = buildClient({ ttlMs: 1 });
    await c.getArtistByMbid(RADIOHEAD_MBID);
    // Wait past TTL
    await new Promise((r) => setTimeout(r, 5));
    await c.getArtistByMbid(RADIOHEAD_MBID);
    expect(counts.get('list')).toBe(2);
  });
});

// ---- getAlbumByMbid -------------------------------------------------------

describe('getAlbumByMbid', () => {
  it('finds the album by MBID, scoped to artistId when given', async () => {
    server.use(
      http.get(`${API}/album`, ({ request }) => {
        const url = new URL(request.url);
        const artistId = url.searchParams.get('artistId');
        expect(artistId).toBe('99');
        return HttpResponse.json([
          {
            id: 7,
            title: 'In Rainbows',
            foreignAlbumId: IN_RAINBOWS_MBID,
            artistId: 99,
            monitored: true,
            anyReleaseOk: true,
          },
        ]);
      })
    );
    const c = buildClient();
    const a = await c.getAlbumByMbid(IN_RAINBOWS_MBID, 99);
    expect(a?.id).toBe(7);
  });

  it('returns null when no album matches', async () => {
    server.use(http.get(`${API}/album`, () => HttpResponse.json([])));
    const c = buildClient();
    expect(await c.getAlbumByMbid(IN_RAINBOWS_MBID)).toBeNull();
  });
});

// ---- addArtist ------------------------------------------------------------

describe('addArtist', () => {
  it('looks up + posts the artist and clears the artist-list cache', async () => {
    let listCalls = 0;
    server.use(
      http.get(`${API}/artist/lookup`, () =>
        HttpResponse.json(artistLookupRadiohead)
      ),
      http.post(`${API}/artist`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        expect(body.foreignArtistId).toBe(RADIOHEAD_MBID);
        expect(body.monitored).toBe(true);
        expect(body.monitorNewItems).toBe('all');
        expect(body.rootFolderPath).toBe('/music');
        expect(
          (body.addOptions as Record<string, unknown>).searchForMissingAlbums
        ).toBe(true);
        return HttpResponse.json(addArtistSuccess);
      }),
      http.get(`${API}/artist`, () => {
        listCalls += 1;
        return HttpResponse.json(artistList);
      })
    );
    const c = buildClient();
    // Prime the artist-list cache.
    await c.getArtistByMbid(RADIOHEAD_MBID);
    expect(listCalls).toBe(1);

    const added = await c.addArtist({
      mbid: RADIOHEAD_MBID,
      rootFolderPath: '/music',
      qualityProfileId: 1,
      metadataProfileId: 1,
      monitor: 'all',
      searchForMissingAlbums: true,
    });
    expect(added.id).toBe(99);

    // Cache should have been invalidated; a follow-up should refetch.
    await c.getArtistByMbid(RADIOHEAD_MBID);
    expect(listCalls).toBe(2);
  });

  it('throws LidarrArtistNotFoundError when lookup returns nothing', async () => {
    server.use(
      http.get(`${API}/artist/lookup`, () => HttpResponse.json([]))
    );
    const c = buildClient();
    await expect(
      c.addArtist({
        mbid: RADIOHEAD_MBID,
        rootFolderPath: '/music',
        qualityProfileId: 1,
        metadataProfileId: 1,
        monitor: 'all',
        searchForMissingAlbums: false,
      })
    ).rejects.toBeInstanceOf(LidarrArtistNotFoundError);
  });

  it('reclassifies a 400 already-exists response as LidarrAlreadyExistsError', async () => {
    server.use(
      http.get(`${API}/artist/lookup`, () =>
        HttpResponse.json(artistLookupRadiohead)
      ),
      http.post(`${API}/artist`, () =>
        HttpResponse.json(addArtistAlreadyExists, { status: 400 })
      )
    );
    const c = buildClient();
    await expect(
      c.addArtist({
        mbid: RADIOHEAD_MBID,
        rootFolderPath: '/music',
        qualityProfileId: 1,
        metadataProfileId: 1,
        monitor: 'all',
        searchForMissingAlbums: false,
      })
    ).rejects.toBeInstanceOf(LidarrAlreadyExistsError);
  });

  it('surfaces metadata-server-down during pre-lookup', async () => {
    server.use(
      http.get(`${API}/artist/lookup`, () =>
        HttpResponse.json({ message: 'Failed to query MusicBrainz' })
      )
    );
    const c = buildClient();
    await expect(
      c.addArtist({
        mbid: RADIOHEAD_MBID,
        rootFolderPath: '/music',
        qualityProfileId: 1,
        metadataProfileId: 1,
        monitor: 'all',
        searchForMissingAlbums: false,
      })
    ).rejects.toBeInstanceOf(LidarrMetadataUnavailableError);
  });
});

// ---- addAlbum -------------------------------------------------------------

describe('addAlbum', () => {
  it('happy path when artist is already in the library', async () => {
    let postedAlbumBody: Record<string, unknown> | null = null;
    let addArtistCalled = false;
    server.use(
      http.get(`${API}/artist`, () => HttpResponse.json(artistList)),
      http.get(`${API}/album/lookup`, () =>
        HttpResponse.json(albumLookupInRainbows)
      ),
      http.post(`${API}/artist`, () => {
        addArtistCalled = true;
        return HttpResponse.json(addArtistSuccess);
      }),
      http.post(`${API}/album`, async ({ request }) => {
        postedAlbumBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(addAlbumSuccess);
      })
    );
    const c = buildClient();
    const result = await c.addAlbum({
      mbid: IN_RAINBOWS_MBID,
      artistMbid: RADIOHEAD_MBID,
      rootFolderPath: '/music',
      qualityProfileId: 1,
      metadataProfileId: 1,
      searchForNewAlbum: true,
    });
    expect(addArtistCalled).toBe(false);
    expect(result.artistAdded).toBe(false);
    expect(result.album.id).toBe(555);
    expect(result.artist.id).toBe(42);
    expect(postedAlbumBody).not.toBeNull();
    expect(postedAlbumBody!.foreignAlbumId).toBe(IN_RAINBOWS_MBID);
    expect(postedAlbumBody!.artistId).toBe(42);
    expect(postedAlbumBody!.anyReleaseOk).toBe(true);
  });

  it('auto-adds the artist with monitor:none when artist not in library', async () => {
    let postedArtistBody: Record<string, unknown> | null = null;
    server.use(
      http.get(`${API}/artist`, () => HttpResponse.json([])),
      http.get(`${API}/artist/lookup`, () =>
        HttpResponse.json(artistLookupRadiohead)
      ),
      http.post(`${API}/artist`, async ({ request }) => {
        postedArtistBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(addArtistSuccess);
      }),
      http.get(`${API}/album/lookup`, () =>
        HttpResponse.json(albumLookupInRainbows)
      ),
      http.post(`${API}/album`, () => HttpResponse.json(addAlbumSuccess))
    );
    const c = buildClient();
    const result = await c.addAlbum({
      mbid: IN_RAINBOWS_MBID,
      artistMbid: RADIOHEAD_MBID,
      rootFolderPath: '/music',
      qualityProfileId: 1,
      metadataProfileId: 1,
      searchForNewAlbum: true,
    });
    expect(result.artistAdded).toBe(true);
    expect(postedArtistBody).not.toBeNull();
    expect(postedArtistBody!.monitorNewItems).toBe('none');
    expect(
      (postedArtistBody!.addOptions as Record<string, unknown>).monitor
    ).toBe('none');
    expect(
      (postedArtistBody!.addOptions as Record<string, unknown>)
        .searchForMissingAlbums
    ).toBe(false);
  });

  it('throws LidarrAlbumNotFoundError when album lookup yields nothing', async () => {
    server.use(
      http.get(`${API}/artist`, () => HttpResponse.json(artistList)),
      http.get(`${API}/album/lookup`, () => HttpResponse.json([]))
    );
    const c = buildClient();
    await expect(
      c.addAlbum({
        mbid: IN_RAINBOWS_MBID,
        artistMbid: RADIOHEAD_MBID,
        rootFolderPath: '/music',
        qualityProfileId: 1,
        metadataProfileId: 1,
        searchForNewAlbum: false,
      })
    ).rejects.toBeInstanceOf(LidarrAlbumNotFoundError);
  });
});

// ---- triggerArtistSearch + getDownloadStatus -----------------------------

describe('triggerArtistSearch', () => {
  it('POSTs the right command', async () => {
    let received: Record<string, unknown> | null = null;
    server.use(
      http.post(`${API}/command`, async ({ request }) => {
        received = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 1, status: 'queued' });
      })
    );
    const c = buildClient();
    await c.triggerArtistSearch(42);
    expect(received).not.toBeNull();
    expect(received!.name).toBe('ArtistSearch');
    expect(received!.artistId).toBe(42);
  });
});

describe('getDownloadStatus', () => {
  it('reports downloaded:true when trackFileCount>=trackCount>0', async () => {
    server.use(
      http.get(`${API}/album/555`, () => HttpResponse.json(albumStatsDownloaded))
    );
    const c = buildClient();
    const s = await c.getDownloadStatus(555);
    expect(s).toEqual({ trackFileCount: 10, trackCount: 10, downloaded: true });
  });

  it('reports downloaded:false when partial', async () => {
    server.use(
      http.get(`${API}/album/555`, () => HttpResponse.json(albumStatsPending))
    );
    const c = buildClient();
    const s = await c.getDownloadStatus(555);
    expect(s.downloaded).toBe(false);
    expect(s.trackFileCount).toBe(3);
    expect(s.trackCount).toBe(10);
  });

  it('reports downloaded:false when stats are absent', async () => {
    server.use(
      http.get(`${API}/album/555`, () =>
        HttpResponse.json({
          id: 555,
          title: 'X',
          foreignAlbumId: IN_RAINBOWS_MBID,
          artistId: 1,
          monitored: true,
          anyReleaseOk: true,
        })
      )
    );
    const c = buildClient();
    const s = await c.getDownloadStatus(555);
    expect(s.downloaded).toBe(false);
    expect(s.trackCount).toBe(0);
  });
});

// ---- getArtistDownloadStatus ---------------------------------------------

describe('getArtistDownloadStatus', () => {
  it('reports complete:true when albumFileCount>=albumCount>0', async () => {
    server.use(
      http.get(`${API}/artist/42`, () =>
        HttpResponse.json({
          id: 42,
          artistName: 'Radiohead',
          statistics: { albumCount: 9, albumFileCount: 9 },
        })
      )
    );
    const c = buildClient();
    const s = await c.getArtistDownloadStatus(42);
    expect(s).toEqual({ albumCount: 9, albumFileCount: 9, complete: true });
  });

  it('reports complete:false when partial', async () => {
    server.use(
      http.get(`${API}/artist/42`, () =>
        HttpResponse.json({
          id: 42,
          artistName: 'Radiohead',
          statistics: { albumCount: 9, albumFileCount: 3 },
        })
      )
    );
    const c = buildClient();
    const s = await c.getArtistDownloadStatus(42);
    expect(s.complete).toBe(false);
    expect(s.albumCount).toBe(9);
    expect(s.albumFileCount).toBe(3);
  });

  it('reports complete:false when statistics are absent', async () => {
    server.use(
      http.get(`${API}/artist/42`, () =>
        HttpResponse.json({ id: 42, artistName: 'Radiohead' })
      )
    );
    const c = buildClient();
    const s = await c.getArtistDownloadStatus(42);
    expect(s.complete).toBe(false);
    expect(s.albumCount).toBe(0);
    expect(s.albumFileCount).toBe(0);
  });
});

// ---- error classification (extra coverage) -------------------------------

describe('error classification', () => {
  it('classifies a 500 with empty body as LidarrError', async () => {
    server.use(
      http.get(`${API}/system/status`, () =>
        HttpResponse.json({}, { status: 500 })
      )
    );
    const c = buildClient();
    await expect(c.testConnection()).rejects.toBeInstanceOf(LidarrError);
  });

  it('classifies a 500 with a metadata hint as MetadataUnavailable', async () => {
    server.use(
      http.get(`${API}/system/status`, () =>
        HttpResponse.json(
          { message: 'Skyhook query failed' },
          { status: 500 }
        )
      )
    );
    const c = buildClient();
    await expect(c.testConnection()).rejects.toBeInstanceOf(
      LidarrMetadataUnavailableError
    );
  });

  it('classifies a 404 against /album as LidarrAlbumNotFoundError', async () => {
    server.use(
      http.get(`${API}/album/12345`, () =>
        HttpResponse.json({ message: 'not found' }, { status: 404 })
      )
    );
    const c = buildClient();
    await expect(c.getDownloadStatus(12345)).rejects.toBeInstanceOf(
      LidarrAlbumNotFoundError
    );
  });

  it('classifies an unexpected non-array body as LidarrError', async () => {
    server.use(
      http.get(`${API}/qualityprofile`, () =>
        HttpResponse.json('a string somehow')
      )
    );
    const c = buildClient();
    await expect(c.getQualityProfiles()).rejects.toBeInstanceOf(LidarrError);
  });

  it('classifies a non-message error envelope as MetadataUnavailable', async () => {
    server.use(
      http.get(`${API}/qualityprofile`, () =>
        HttpResponse.json({ errors: ['boom'] })
      )
    );
    const c = buildClient();
    await expect(c.getQualityProfiles()).rejects.toBeInstanceOf(
      LidarrMetadataUnavailableError
    );
  });
});

// ---- factory --------------------------------------------------------------

describe('factory: getLidarrClient', () => {
  beforeEach(() => {
    lidarrClientCache.invalidate();
  });

  it('returns null when Lidarr is not configured', async () => {
    const spy = vi
      .spyOn(settingsService, 'getDecryptedLidarrConfig')
      .mockResolvedValue(null);
    expect(await getLidarrClient()).toBeNull();
    spy.mockRestore();
  });

  it('caches the client on equal (url,apiKey)', async () => {
    const spy = vi
      .spyOn(settingsService, 'getDecryptedLidarrConfig')
      .mockResolvedValue({
        url: BASE,
        apiKey: 'k',
        rootFolderPath: '/music',
        qualityProfileId: 1,
        metadataProfileId: 1,
      });
    const a = await getLidarrClient();
    const b = await getLidarrClient();
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    spy.mockRestore();
  });

  it('rebuilds the client after lidarrClientCache.invalidate()', async () => {
    const spy = vi
      .spyOn(settingsService, 'getDecryptedLidarrConfig')
      .mockResolvedValue({
        url: BASE,
        apiKey: 'k1',
        rootFolderPath: '/music',
        qualityProfileId: 1,
        metadataProfileId: 1,
      });
    const a = await getLidarrClient();

    spy.mockResolvedValue({
      url: BASE,
      apiKey: 'k2',
      rootFolderPath: '/music',
      qualityProfileId: 1,
      metadataProfileId: 1,
    });
    // Different apiKey → cache miss, fresh instance.
    const b = await getLidarrClient();
    expect(b).not.toBe(a);
    spy.mockRestore();
  });

  it('settings service triggers cache invalidation hook', async () => {
    const spy = vi
      .spyOn(settingsService, 'getDecryptedLidarrConfig')
      .mockResolvedValue({
        url: BASE,
        apiKey: 'k',
        rootFolderPath: '/music',
        qualityProfileId: 1,
        metadataProfileId: 1,
      });
    const first = await getLidarrClient();
    lidarrClientCache.invalidate();
    const second = await getLidarrClient();
    expect(second).not.toBe(first);
    spy.mockRestore();
  });
});
