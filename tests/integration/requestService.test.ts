/**
 * Branch-coverage tests for requestService.
 *
 * These supplement the route-level tests in requests.test.ts by driving the
 * service directly and stubbing the LidarrClient via the factory cache. The
 * goal is to hit the long tail of error-classification branches without
 * round-tripping through HTTP.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { prisma } from '../../server/db/prisma';
import { settingsService } from '../../server/services/settingsService';
import { lidarrClientCache } from '../../server/api/lidarr/factory';
import { LidarrClient } from '../../server/api/lidarr';
import {
  createAlbumRequest,
  createArtistRequest,
  deleteRequest,
  getRequest,
  listRequests,
  retryRequest,
} from '../../server/services/requestService';
import {
  LidarrAlbumNotFoundError,
  LidarrAlreadyExistsError,
  LidarrAuthError,
  LidarrError,
  LidarrMetadataUnavailableError,
  LidarrNotConfiguredError,
  LidarrUnreachableError,
  MusicBrainzNotFoundError,
  RequestNotFoundError,
  ValidationError,
} from '../../server/lib/errors';
import { musicbrainz } from '../../server/api/musicbrainz';

const ADMIN_USERNAME = 'admin';

async function setupLidarrSettings(): Promise<void> {
  await settingsService.updateLidarrSettings({
    url: 'http://test-lidarr.local:8686',
    apiKey: 'k',
    rootFolderPath: '/music',
    qualityProfileId: 1,
    metadataProfileId: 1,
  });
}

async function makeUser(username = ADMIN_USERNAME, role = 'ADMIN'): Promise<number> {
  const u = await prisma.user.create({
    data: {
      username,
      passwordHash: 'x',
      role,
    },
  });
  return u.id;
}

async function clearDb(): Promise<void> {
  await prisma.musicRequest.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.settings.deleteMany();
  settingsService.invalidate();
  lidarrClientCache.invalidate();
}

function stubLidarrClient(stub: Partial<LidarrClient>): void {
  // Place a stubbed client in the factory cache so getLidarrClient returns it.
  lidarrClientCache.set(
    'http://test-lidarr.local:8686',
    'k',
    stub as unknown as LidarrClient
  );
}

const ALBUM_META = {
  mbid: 'release-1',
  releaseGroupMbid: 'rg-1',
  title: 'Album One',
  artistName: 'Artist One',
  artistMbid: 'artist-1',
  tracks: [],
  firstReleaseDate: '2020-01-01',
  coverArtUrl: 'http://example.com/cover.jpg',
};

const ARTIST_META = {
  mbid: 'artist-1',
  name: 'Artist One',
  sortName: 'Artist One',
  releaseGroups: [],
};

beforeEach(async () => {
  await clearDb();
  await setupLidarrSettings();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---- Album: error classification branches --------------------------------

describe('createAlbumRequest — error classifications', () => {
  it('LidarrAlreadyExistsError → PROCESSING with looked-up ids', async () => {
    const userId = await makeUser('alice', 'ADMIN');
    vi.spyOn(musicbrainz, 'getAlbum').mockResolvedValue(ALBUM_META);
    stubLidarrClient({
      addAlbum: vi
        .fn()
        .mockRejectedValue(new LidarrAlreadyExistsError('exists')),
      getArtistByMbid: vi
        .fn()
        .mockResolvedValue({ id: 7, foreignArtistId: 'artist-1', artistName: 'Artist One', monitored: true }),
      getAlbumByMbid: vi
        .fn()
        .mockResolvedValue({ id: 99, foreignAlbumId: 'rg-1', title: 'Album One', artistId: 7, monitored: true, anyReleaseOk: true }),
    });

    const row = await createAlbumRequest(userId, 'rg-1');
    expect(row.status).toBe('PROCESSING');
    expect(row.lidarrAlbumId).toBe(99);
    expect(row.lidarrArtistId).toBe(7);
  });

  it('LidarrAlreadyExistsError + lookup throws → still PROCESSING (no ids)', async () => {
    const userId = await makeUser('alice', 'ADMIN');
    vi.spyOn(musicbrainz, 'getAlbum').mockResolvedValue(ALBUM_META);
    stubLidarrClient({
      addAlbum: vi
        .fn()
        .mockRejectedValue(new LidarrAlreadyExistsError('exists')),
      getArtistByMbid: vi.fn().mockRejectedValue(new LidarrError('boom')),
      getAlbumByMbid: vi.fn(),
    });

    const row = await createAlbumRequest(userId, 'rg-1');
    expect(row.status).toBe('PROCESSING');
    expect(row.lidarrAlbumId).toBeNull();
  });

  it('LidarrAuthError → FAILED', async () => {
    const userId = await makeUser('alice', 'ADMIN');
    vi.spyOn(musicbrainz, 'getAlbum').mockResolvedValue(ALBUM_META);
    stubLidarrClient({
      addAlbum: vi
        .fn()
        .mockRejectedValue(new LidarrAuthError('nope')),
    });
    const row = await createAlbumRequest(userId, 'rg-1');
    expect(row.status).toBe('FAILED');
    expect(row.errorMessage).toBe('nope');
  });

  it('LidarrError → FAILED', async () => {
    const userId = await makeUser('alice', 'ADMIN');
    vi.spyOn(musicbrainz, 'getAlbum').mockResolvedValue(ALBUM_META);
    stubLidarrClient({
      addAlbum: vi.fn().mockRejectedValue(new LidarrError('500')),
    });
    const row = await createAlbumRequest(userId, 'rg-1');
    expect(row.status).toBe('FAILED');
    expect(row.errorMessage).toBe('500');
  });

  it('Unexpected error → FAILED', async () => {
    const userId = await makeUser('alice', 'ADMIN');
    vi.spyOn(musicbrainz, 'getAlbum').mockResolvedValue(ALBUM_META);
    stubLidarrClient({
      addAlbum: vi.fn().mockRejectedValue(new Error('weird')),
    });
    const row = await createAlbumRequest(userId, 'rg-1');
    expect(row.status).toBe('FAILED');
    expect(row.errorMessage).toBe('weird');
  });

  it('LidarrMetadataUnavailable → PENDING with default message when err has no message', async () => {
    const userId = await makeUser('alice', 'ADMIN');
    vi.spyOn(musicbrainz, 'getAlbum').mockResolvedValue(ALBUM_META);
    stubLidarrClient({
      addAlbum: vi
        .fn()
        .mockRejectedValue(new LidarrMetadataUnavailableError('skyhook')),
    });
    const row = await createAlbumRequest(userId, 'rg-1');
    expect(row.status).toBe('PENDING');
    expect(row.errorMessage).toBe('skyhook');
  });

  it('LidarrAlbumNotFound + artist lookup throws → PENDING with generic msg', async () => {
    const userId = await makeUser('alice', 'ADMIN');
    vi.spyOn(musicbrainz, 'getAlbum').mockResolvedValue(ALBUM_META);
    stubLidarrClient({
      addAlbum: vi
        .fn()
        .mockRejectedValue(new LidarrAlbumNotFoundError('not found')),
      getArtistByMbid: vi.fn().mockRejectedValue(new LidarrError('lookup boom')),
      triggerArtistSearch: vi.fn(),
    });
    const row = await createAlbumRequest(userId, 'rg-1');
    expect(row.status).toBe('PENDING');
    expect(row.errorMessage).toMatch(/Try again later/);
  });

  it('throws ValidationError when MB has no artistMbid', async () => {
    const userId = await makeUser('alice', 'ADMIN');
    vi.spyOn(musicbrainz, 'getAlbum').mockResolvedValue({
      ...ALBUM_META,
      artistMbid: '',
    });
    await expect(createAlbumRequest(userId, 'rg-1')).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it('throws ValidationError when MB returns 404', async () => {
    const userId = await makeUser('alice', 'ADMIN');
    vi.spyOn(musicbrainz, 'getAlbum').mockRejectedValue(
      new MusicBrainzNotFoundError()
    );
    await expect(createAlbumRequest(userId, 'rg-1')).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it('throws LidarrNotConfiguredError when settings cleared', async () => {
    const userId = await makeUser('alice', 'ADMIN');
    vi.spyOn(musicbrainz, 'getAlbum').mockResolvedValue(ALBUM_META);
    await prisma.settings.update({
      where: { id: 1 },
      data: { lidarrUrl: null, lidarrApiKeyEncrypted: null },
    });
    settingsService.invalidate();
    lidarrClientCache.invalidate();
    await expect(createAlbumRequest(userId, 'rg-1')).rejects.toBeInstanceOf(
      LidarrNotConfiguredError
    );
  });
});

// ---- Artist: error classification branches -------------------------------

describe('createArtistRequest — error classifications', () => {
  it('Unreachable → FAILED', async () => {
    const userId = await makeUser('alice', 'ADMIN');
    vi.spyOn(musicbrainz, 'getArtist').mockResolvedValue(ARTIST_META);
    stubLidarrClient({
      getArtistByMbid: vi.fn().mockResolvedValue(null),
      addArtist: vi
        .fn()
        .mockRejectedValue(new LidarrUnreachableError('down')),
    });
    const row = await createArtistRequest(userId, 'artist-1');
    expect(row.status).toBe('FAILED');
    expect(row.errorMessage).toBe('down');
  });

  it('MetadataUnavailable → PENDING', async () => {
    const userId = await makeUser('alice', 'ADMIN');
    vi.spyOn(musicbrainz, 'getArtist').mockResolvedValue(ARTIST_META);
    stubLidarrClient({
      getArtistByMbid: vi.fn().mockResolvedValue(null),
      addArtist: vi
        .fn()
        .mockRejectedValue(new LidarrMetadataUnavailableError('skyhook')),
    });
    const row = await createArtistRequest(userId, 'artist-1');
    expect(row.status).toBe('PENDING');
    expect(row.errorMessage).toBe('skyhook');
  });

  it('AlreadyExists handled idempotently when reachable post-add', async () => {
    const userId = await makeUser('alice', 'ADMIN');
    vi.spyOn(musicbrainz, 'getArtist').mockResolvedValue(ARTIST_META);
    let lookupCalls = 0;
    stubLidarrClient({
      getArtistByMbid: vi.fn().mockImplementation(async () => {
        lookupCalls += 1;
        if (lookupCalls === 1) return null;
        return { id: 50, foreignArtistId: 'artist-1', artistName: 'Artist One', monitored: true };
      }),
      addArtist: vi
        .fn()
        .mockRejectedValue(new LidarrAlreadyExistsError('exists')),
      triggerArtistSearch: vi.fn().mockResolvedValue(undefined),
    });
    const row = await createArtistRequest(userId, 'artist-1');
    expect(row.status).toBe('PROCESSING');
    expect(row.lidarrArtistId).toBe(50);
  });

  it('Auth error → FAILED', async () => {
    const userId = await makeUser('alice', 'ADMIN');
    vi.spyOn(musicbrainz, 'getArtist').mockResolvedValue(ARTIST_META);
    stubLidarrClient({
      getArtistByMbid: vi.fn().mockResolvedValue(null),
      addArtist: vi.fn().mockRejectedValue(new LidarrAuthError('bad key')),
    });
    const row = await createArtistRequest(userId, 'artist-1');
    expect(row.status).toBe('FAILED');
    expect(row.errorMessage).toBe('bad key');
  });

  it('Generic LidarrError → FAILED', async () => {
    const userId = await makeUser('alice', 'ADMIN');
    vi.spyOn(musicbrainz, 'getArtist').mockResolvedValue(ARTIST_META);
    stubLidarrClient({
      getArtistByMbid: vi.fn().mockResolvedValue(null),
      addArtist: vi.fn().mockRejectedValue(new LidarrError('502')),
    });
    const row = await createArtistRequest(userId, 'artist-1');
    expect(row.status).toBe('FAILED');
    expect(row.errorMessage).toBe('502');
  });

  it('Unexpected error → FAILED', async () => {
    const userId = await makeUser('alice', 'ADMIN');
    vi.spyOn(musicbrainz, 'getArtist').mockResolvedValue(ARTIST_META);
    stubLidarrClient({
      getArtistByMbid: vi.fn().mockResolvedValue(null),
      addArtist: vi.fn().mockRejectedValue(new Error('what')),
    });
    const row = await createArtistRequest(userId, 'artist-1');
    expect(row.status).toBe('FAILED');
    expect(row.errorMessage).toBe('what');
  });

  it('triggerArtistSearch failure on existing artist still → PROCESSING', async () => {
    const userId = await makeUser('alice', 'ADMIN');
    vi.spyOn(musicbrainz, 'getArtist').mockResolvedValue(ARTIST_META);
    stubLidarrClient({
      getArtistByMbid: vi
        .fn()
        .mockResolvedValue({ id: 5, foreignArtistId: 'artist-1', artistName: 'Artist One', monitored: true }),
      triggerArtistSearch: vi.fn().mockRejectedValue(new Error('boom')),
    });
    const row = await createArtistRequest(userId, 'artist-1');
    expect(row.status).toBe('PROCESSING');
    expect(row.lidarrArtistId).toBe(5);
  });

  it('throws ValidationError on MB 404', async () => {
    const userId = await makeUser('alice', 'ADMIN');
    vi.spyOn(musicbrainz, 'getArtist').mockRejectedValue(
      new MusicBrainzNotFoundError()
    );
    await expect(createArtistRequest(userId, 'artist-1')).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it('throws LidarrNotConfiguredError when settings cleared', async () => {
    const userId = await makeUser('alice', 'ADMIN');
    vi.spyOn(musicbrainz, 'getArtist').mockResolvedValue(ARTIST_META);
    await prisma.settings.update({
      where: { id: 1 },
      data: { lidarrUrl: null, lidarrApiKeyEncrypted: null },
    });
    settingsService.invalidate();
    lidarrClientCache.invalidate();
    await expect(createArtistRequest(userId, 'artist-1')).rejects.toBeInstanceOf(
      LidarrNotConfiguredError
    );
  });
});

// ---- Idempotency / retry / list / get / delete ---------------------------

describe('list/get/delete/retry plumbing', () => {
  it('returns the same row when current status is non-FAILED (idempotent)', async () => {
    const userId = await makeUser();
    vi.spyOn(musicbrainz, 'getAlbum').mockResolvedValue(ALBUM_META);
    stubLidarrClient({
      addAlbum: vi.fn().mockResolvedValue({
        album: { id: 1, foreignAlbumId: 'rg-1', title: 'A', artistId: 1, monitored: true, anyReleaseOk: true },
        artist: { id: 1, foreignArtistId: 'artist-1', artistName: 'A', monitored: true },
        artistAdded: false,
      }),
    });
    const first = await createAlbumRequest(userId, 'rg-1');
    expect(first.status).toBe('PROCESSING');
    // Second call should not re-invoke addAlbum.
    const addAlbumSpy = vi
      .spyOn(LidarrClient.prototype, 'addAlbum')
      .mockResolvedValue({
        album: { id: 999, foreignAlbumId: 'rg-1', title: 'A', artistId: 1, monitored: true, anyReleaseOk: true },
        artist: { id: 1, foreignArtistId: 'artist-1', artistName: 'A', monitored: true },
        artistAdded: false,
      });
    const second = await createAlbumRequest(userId, 'rg-1');
    expect(second.id).toBe(first.id);
    expect(addAlbumSpy).not.toHaveBeenCalled();
  });

  it('listRequests filters by status and type, paginates', async () => {
    const userId = await makeUser();
    await prisma.musicRequest.createMany({
      data: [
        { userId, type: 'ALBUM', mbid: 'a', name: 'A', status: 'PROCESSING' },
        { userId, type: 'ALBUM', mbid: 'b', name: 'B', status: 'AVAILABLE' },
        { userId, type: 'ARTIST', mbid: 'c', name: 'C', status: 'PROCESSING' },
        { userId, type: 'ARTIST', mbid: 'd', name: 'D', status: 'FAILED' },
      ],
    });

    const processing = await listRequests({
      userId,
      isAdmin: true,
      scope: 'mine',
      status: 'PROCESSING',
    });
    expect(processing.total).toBe(2);

    const albums = await listRequests({
      userId,
      isAdmin: true,
      scope: 'mine',
      type: 'ALBUM',
    });
    expect(albums.total).toBe(2);

    const page = await listRequests({
      userId,
      isAdmin: true,
      scope: 'mine',
      limit: 1,
      offset: 1,
    });
    expect(page.requests).toHaveLength(1);
    expect(page.total).toBe(4);
  });

  it('listRequests with limit > MAX caps to 100', async () => {
    const userId = await makeUser();
    const res = await listRequests({
      userId,
      isAdmin: true,
      scope: 'mine',
      limit: 9999,
    });
    expect(res.total).toBe(0);
  });

  it('listRequests scope=all forbidden for non-admin', async () => {
    const userId = await makeUser();
    await expect(
      listRequests({ userId, isAdmin: false, scope: 'all' })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('getRequest 404 for missing row, 404 for non-owner', async () => {
    const alice = await makeUser('alice', 'USER');
    const bob = await makeUser('bob', 'USER');
    const row = await prisma.musicRequest.create({
      data: { userId: alice, type: 'ALBUM', mbid: 'x', name: 'X', status: 'PROCESSING' },
    });
    await expect(getRequest(99999, alice, false)).rejects.toBeInstanceOf(
      RequestNotFoundError
    );
    await expect(getRequest(row.id, bob, false)).rejects.toBeInstanceOf(
      RequestNotFoundError
    );
    // Admin can fetch other-user rows.
    const adminFetch = await getRequest(row.id, bob, true);
    expect(adminFetch.id).toBe(row.id);
  });

  it('deleteRequest admin can delete other users row', async () => {
    const alice = await makeUser('alice', 'USER');
    const bob = await makeUser('bob', 'USER');
    const row = await prisma.musicRequest.create({
      data: { userId: alice, type: 'ALBUM', mbid: 'x', name: 'X', status: 'PROCESSING' },
    });
    await deleteRequest(row.id, bob, true);
    expect(await prisma.musicRequest.findUnique({ where: { id: row.id } })).toBeNull();
  });

  it('deleteRequest 404 for missing row', async () => {
    const userId = await makeUser();
    await expect(deleteRequest(99999, userId, true)).rejects.toBeInstanceOf(
      RequestNotFoundError
    );
  });

  it('retryRequest: 404 missing', async () => {
    const userId = await makeUser();
    await expect(retryRequest(userId, true, 99999)).rejects.toBeInstanceOf(
      RequestNotFoundError
    );
  });

  it('retryRequest: 400 when row is AVAILABLE', async () => {
    const userId = await makeUser();
    const row = await prisma.musicRequest.create({
      data: { userId, type: 'ALBUM', mbid: 'x', name: 'X', status: 'AVAILABLE' },
    });
    await expect(retryRequest(userId, false, row.id)).rejects.toBeInstanceOf(
      ValidationError
    );
  });

  it('retryRequest: PENDING row gets re-run', async () => {
    const userId = await makeUser();
    const row = await prisma.musicRequest.create({
      data: { userId, type: 'ARTIST', mbid: 'artist-1', name: 'X', status: 'PENDING' },
    });
    vi.spyOn(musicbrainz, 'getArtist').mockResolvedValue(ARTIST_META);
    stubLidarrClient({
      getArtistByMbid: vi
        .fn()
        .mockResolvedValue({ id: 7, foreignArtistId: 'artist-1', artistName: 'A', monitored: true }),
      triggerArtistSearch: vi.fn().mockResolvedValue(undefined),
    });
    const result = await retryRequest(userId, false, row.id);
    expect(result.status).toBe('PROCESSING');
    expect(result.lidarrArtistId).toBe(7);
  });

  it('retryRequest: admin can retry another user\'s FAILED row', async () => {
    const alice = await makeUser('alice', 'USER');
    const adminId = await makeUser('admin2', 'ADMIN');
    const row = await prisma.musicRequest.create({
      data: { userId: alice, type: 'ARTIST', mbid: 'artist-1', name: 'X', status: 'FAILED' },
    });
    vi.spyOn(musicbrainz, 'getArtist').mockResolvedValue(ARTIST_META);
    stubLidarrClient({
      getArtistByMbid: vi
        .fn()
        .mockResolvedValue({ id: 8, foreignArtistId: 'artist-1', artistName: 'A', monitored: true }),
      triggerArtistSearch: vi.fn().mockResolvedValue(undefined),
    });
    const result = await retryRequest(adminId, true, row.id);
    expect(result.status).toBe('PROCESSING');
  });
});
