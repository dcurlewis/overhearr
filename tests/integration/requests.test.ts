/**
 * Integration tests for /api/requests/*.
 *
 * The test app is identical to production except DATABASE_URL points at a
 * fresh tmp SQLite file (set up by tests/integration/setup-env.ts).
 * Lidarr + MusicBrainz are mocked at their normal URLs via msw so we never
 * make a real network call.
 *
 * Lidarr is configured at http://test-lidarr.local:8686 — that URL only
 * resolves through msw's interception layer.
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

import { prisma } from '../../server/db/prisma';
import { settingsService } from '../../server/services/settingsService';
import { lidarrClientCache } from '../../server/api/lidarr/factory';

import releaseInRainbows from '../__fixtures__/musicbrainz/releaseInRainbows.json';
import addArtistSuccess from '../__fixtures__/lidarr/add-artist-success.json';
import addAlbumSuccess from '../__fixtures__/lidarr/add-album-success.json';
import artistDiscography from '../__fixtures__/musicbrainz/artistDiscography.json';

// Inline fixtures: the JSON fixtures in tests/__fixtures__/lidarr/ encode
// real MBIDs (b139... + a74b...) which don't match the MusicBrainz fixture's
// rg-rainbows / radiohead-mbid placeholders. We synthesize matching shapes
// inline so the request flow's "does this artist's foreignArtistId match?"
// check succeeds.
const RG_RAINBOWS = 'rg-rainbows';
const RADIOHEAD_MBID = 'radiohead-mbid';

const artistLookupRadiohead = [
  {
    artistName: 'Radiohead',
    foreignArtistId: RADIOHEAD_MBID,
    monitored: false,
  },
];

const albumLookupInRainbows = [
  {
    album: {
      id: 0,
      title: 'In Rainbows',
      foreignAlbumId: RG_RAINBOWS,
      artistId: 0,
      monitored: false,
      anyReleaseOk: true,
    },
  },
];

const artistList = [
  {
    id: 42,
    artistName: 'Radiohead',
    foreignArtistId: RADIOHEAD_MBID,
    monitored: true,
  },
];

const addArtistSuccessLocal = {
  ...addArtistSuccess,
  foreignArtistId: RADIOHEAD_MBID,
};

const addAlbumSuccessLocal = {
  ...addAlbumSuccess,
  foreignAlbumId: RG_RAINBOWS,
};

import {
  buildTestApp,
  provisionAdminWithLidarr,
  VALID_PASSWORD,
} from './_helpers';

const RL = { 'x-test-disable-rate-limit': '1' };
const CSRF = { 'x-overhearr-csrf': '1' };

const LIDARR = 'http://test-lidarr.local:8686/api/v1';
const MB = 'https://musicbrainz.org/ws/2';
const CAA = 'https://coverartarchive.org';

interface CallCounts {
  artistPosts: number;
  albumPosts: number;
  artistSearches: number;
}

const counts: CallCounts = {
  artistPosts: 0,
  albumPosts: 0,
  artistSearches: 0,
};

function resetCounts(): void {
  counts.artistPosts = 0;
  counts.albumPosts = 0;
  counts.artistSearches = 0;
}

const baseHandlers = [
  // MusicBrainz: release lookup returns the In Rainbows fixture; the
  // route normalizes it into an Album with releaseGroupMbid=rg-rainbows
  // and artistMbid=radiohead-mbid.
  http.get(`${MB}/release/:mbid`, () => HttpResponse.json(releaseInRainbows)),
  http.get(`${MB}/artist/:mbid`, () => HttpResponse.json(artistDiscography)),
  http.get(`${CAA}/release/:mbid`, () =>
    HttpResponse.json({ error: 'not found' }, { status: 404 })
  ),
  http.get(`${CAA}/release-group/:mbid`, () =>
    HttpResponse.json({ error: 'not found' }, { status: 404 })
  ),
];

const server = setupServer(...baseHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers(...baseHandlers);
  resetCounts();
});

async function clearDb(): Promise<void> {
  await prisma.musicRequest.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.settings.deleteMany();
  settingsService.invalidate();
  lidarrClientCache.invalidate();
}

/**
 * Register Lidarr handlers covering the happy-path "add album" sequence:
 *  - GET /artist (library list) — empty (artist not in library)
 *  - GET /artist/lookup — Radiohead (auto-add resolution)
 *  - POST /artist — counts as a real add
 *  - GET /album/lookup — In Rainbows
 *  - POST /album — adds the album
 */
function registerHappyPathLidarr(): void {
  server.use(
    http.get(`${LIDARR}/artist`, () => HttpResponse.json([])),
    http.get(`${LIDARR}/artist/lookup`, () =>
      HttpResponse.json(artistLookupRadiohead)
    ),
    http.post(`${LIDARR}/artist`, () => {
      counts.artistPosts += 1;
      return HttpResponse.json(addArtistSuccessLocal);
    }),
    http.get(`${LIDARR}/album/lookup`, () =>
      HttpResponse.json(albumLookupInRainbows)
    ),
    http.post(`${LIDARR}/album`, () => {
      counts.albumPosts += 1;
      return HttpResponse.json(addAlbumSuccessLocal);
    }),
    http.post(`${LIDARR}/command`, () => {
      counts.artistSearches += 1;
      return HttpResponse.json({ id: 1, status: 'queued' });
    })
  );
}

describe('POST /api/requests/album — auth & gating', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('401 unauthenticated', async () => {
    const res = await harness
      .agent()
      .post('/api/requests/album')
      .set(CSRF)
      .send({ mbid: RG_RAINBOWS });
    expect(res.status).toBe(401);
  });

  it('403 missing CSRF header (after setup complete)', async () => {
    const admin = await provisionAdminWithLidarr(harness);
    const res = await admin
      .post('/api/requests/album')
      .send({ mbid: RG_RAINBOWS });
    expect(res.status).toBe(403);
  });

  it('409 SETUP_INCOMPLETE when authenticated but setup not done', async () => {
    const a = harness.agent();
    await a
      .post('/api/setup/initialize')
      .set(RL)
      .send({ username: 'admin', password: VALID_PASSWORD })
      .expect(201);
    const res = await a
      .post('/api/requests/album')
      .set(CSRF)
      .send({ mbid: RG_RAINBOWS });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SETUP_INCOMPLETE');
  });
});

describe('POST /api/requests/album — happy path & idempotency', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('creates a PROCESSING row with lidarr ids set', async () => {
    registerHappyPathLidarr();
    const admin = await provisionAdminWithLidarr(harness);

    const res = await admin
      .post('/api/requests/album')
      .set(CSRF)
      .send({ mbid: RG_RAINBOWS });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PROCESSING');
    expect(res.body.lidarrAlbumId).toBe(555);
    expect(res.body.lidarrArtistId).toBe(99);
    expect(res.body.type).toBe('ALBUM');
    expect(res.body.mbid).toBe(RG_RAINBOWS);
    expect(res.body.errorMessage).toBeNull();
    // We added the artist + album exactly once.
    expect(counts.artistPosts).toBe(1);
    expect(counts.albumPosts).toBe(1);
  });

  it('idempotent: a second request returns the same row, no extra Lidarr calls', async () => {
    registerHappyPathLidarr();
    const admin = await provisionAdminWithLidarr(harness);

    const first = await admin
      .post('/api/requests/album')
      .set(CSRF)
      .send({ mbid: RG_RAINBOWS });
    expect(first.status).toBe(200);
    expect(counts.albumPosts).toBe(1);

    const second = await admin
      .post('/api/requests/album')
      .set(CSRF)
      .send({ mbid: RG_RAINBOWS });
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(counts.albumPosts).toBe(1);
    expect(counts.artistPosts).toBe(1);
  });

  it('skips POST /artist when artist already in library', async () => {
    server.use(
      http.get(`${LIDARR}/artist`, () => HttpResponse.json(artistList)),
      http.post(`${LIDARR}/artist`, () => {
        counts.artistPosts += 1;
        return HttpResponse.json(addArtistSuccessLocal);
      }),
      http.get(`${LIDARR}/album/lookup`, () =>
        HttpResponse.json(albumLookupInRainbows)
      ),
      http.post(`${LIDARR}/album`, () => {
        counts.albumPosts += 1;
        return HttpResponse.json(addAlbumSuccessLocal);
      })
    );
    const admin = await provisionAdminWithLidarr(harness);

    const res = await admin
      .post('/api/requests/album')
      .set(CSRF)
      .send({ mbid: RG_RAINBOWS });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PROCESSING');
    expect(counts.artistPosts).toBe(0);
    expect(counts.albumPosts).toBe(1);
  });
});

describe('POST /api/requests/album — error classifications', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('AlbumNotFound → PENDING + triggerArtistSearch fallback', async () => {
    let artistAdded = false;
    server.use(
      // Before addArtist, library is empty. Once we POST /artist (which
      // invalidates the artist-list cache), subsequent GET /artist returns
      // the artist so the fallback can resolve its id and trigger search.
      http.get(`${LIDARR}/artist`, () =>
        HttpResponse.json(artistAdded ? artistList : [])
      ),
      http.get(`${LIDARR}/artist/lookup`, () =>
        HttpResponse.json(artistLookupRadiohead)
      ),
      http.post(`${LIDARR}/artist`, () => {
        counts.artistPosts += 1;
        artistAdded = true;
        return HttpResponse.json(addArtistSuccessLocal);
      }),
      // Album lookup yields nothing → addAlbum throws AlbumNotFound.
      http.get(`${LIDARR}/album/lookup`, () => HttpResponse.json([])),
      http.post(`${LIDARR}/command`, () => {
        counts.artistSearches += 1;
        return HttpResponse.json({ id: 1, status: 'queued' });
      })
    );
    const admin = await provisionAdminWithLidarr(harness);

    const res = await admin
      .post('/api/requests/album')
      .set(CSRF)
      .send({ mbid: RG_RAINBOWS });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.errorMessage).toMatch(/search the artist/i);
    expect(counts.artistSearches).toBe(1);
  });

  it('MetadataUnavailable → PENDING with errorMessage', async () => {
    server.use(
      http.get(`${LIDARR}/artist`, () => HttpResponse.json([])),
      http.get(`${LIDARR}/artist/lookup`, () =>
        HttpResponse.json({ message: 'Failed to query MusicBrainz' })
      )
    );
    const admin = await provisionAdminWithLidarr(harness);

    const res = await admin
      .post('/api/requests/album')
      .set(CSRF)
      .send({ mbid: RG_RAINBOWS });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.errorMessage).toBeTruthy();
  });

  it('Lidarr unreachable → FAILED with errorMessage', async () => {
    server.use(
      http.get(`${LIDARR}/artist`, () => HttpResponse.error()),
      http.get(`${LIDARR}/artist/lookup`, () => HttpResponse.error())
    );
    const admin = await provisionAdminWithLidarr(harness);

    const res = await admin
      .post('/api/requests/album')
      .set(CSRF)
      .send({ mbid: RG_RAINBOWS });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('FAILED');
    expect(res.body.errorMessage).toBeTruthy();
  });

  it('returns 503 LIDARR_NOT_CONFIGURED when settings not set', async () => {
    // Provision admin but DON'T set Lidarr; mark setup completed via direct
    // settings shortcut would fail (markSetupCompleted requires lidarr).
    // Instead, configure Lidarr, mark setup, then wipe Lidarr settings.
    const admin = await provisionAdminWithLidarr(harness);
    await prisma.settings.update({
      where: { id: 1 },
      data: {
        lidarrUrl: null,
        lidarrApiKeyEncrypted: null,
        lidarrRootFolderPath: null,
        lidarrQualityProfileId: null,
        lidarrMetadataProfileId: null,
      },
    });
    settingsService.invalidate();
    lidarrClientCache.invalidate();

    const res = await admin
      .post('/api/requests/album')
      .set(CSRF)
      .send({ mbid: RG_RAINBOWS });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('LIDARR_NOT_CONFIGURED');
  });
});

describe('POST /api/requests/:id/retry', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('flips a FAILED row to PROCESSING when Lidarr recovers', async () => {
    // First call → Lidarr unreachable → FAILED
    server.use(
      http.get(`${LIDARR}/artist`, () => HttpResponse.error()),
      http.get(`${LIDARR}/artist/lookup`, () => HttpResponse.error())
    );
    const admin = await provisionAdminWithLidarr(harness);
    const first = await admin
      .post('/api/requests/album')
      .set(CSRF)
      .send({ mbid: RG_RAINBOWS });
    expect(first.body.status).toBe('FAILED');

    // Re-mock Lidarr as healthy.
    registerHappyPathLidarr();

    const retry = await admin
      .post(`/api/requests/${first.body.id}/retry`)
      .set(CSRF)
      .send({});
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(first.body.id);
    expect(retry.body.status).toBe('PROCESSING');
  });

  it('400 when the row is in a non-retryable status', async () => {
    registerHappyPathLidarr();
    const admin = await provisionAdminWithLidarr(harness);
    const created = await admin
      .post('/api/requests/album')
      .set(CSRF)
      .send({ mbid: RG_RAINBOWS });
    expect(created.body.status).toBe('PROCESSING');

    const retry = await admin
      .post(`/api/requests/${created.body.id}/retry`)
      .set(CSRF)
      .send({});
    expect(retry.status).toBe(400);
    expect(retry.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('404 for a request belonging to another user', async () => {
    registerHappyPathLidarr();
    const admin = await provisionAdminWithLidarr(harness);
    // Create a second user (non-admin) and a request for the admin.
    await admin
      .post('/api/users')
      .set(CSRF)
      .send({ username: 'bob', password: VALID_PASSWORD, role: 'USER' })
      .expect(201);

    const created = await admin
      .post('/api/requests/album')
      .set(CSRF)
      .send({ mbid: RG_RAINBOWS });
    expect(created.body.status).toBe('PROCESSING');

    // Mark it FAILED so it's retryable.
    await prisma.musicRequest.update({
      where: { id: created.body.id },
      data: { status: 'FAILED' },
    });

    // Log in as bob and try to retry admin's request.
    const bob = harness.agent();
    await bob
      .post('/api/auth/login')
      .set(RL)
      .send({ username: 'bob', password: VALID_PASSWORD })
      .expect(200);
    const res = await bob
      .post(`/api/requests/${created.body.id}/retry`)
      .set(CSRF)
      .send({});
    expect(res.status).toBe(404);
  });
});

describe('POST /api/requests/artist', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('addArtist with monitor=all + searchForMissingAlbums', async () => {
    let body: Record<string, unknown> | null = null;
    server.use(
      http.get(`${LIDARR}/artist`, () => HttpResponse.json([])),
      http.get(`${LIDARR}/artist/lookup`, () =>
        HttpResponse.json(artistLookupRadiohead)
      ),
      http.post(`${LIDARR}/artist`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(addArtistSuccessLocal);
      })
    );

    const admin = await provisionAdminWithLidarr(harness);
    const res = await admin
      .post('/api/requests/artist')
      .set(CSRF)
      .send({ mbid: RADIOHEAD_MBID });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PROCESSING');
    expect(res.body.lidarrArtistId).toBe(99);
    expect(body).not.toBeNull();
    expect(body!.monitorNewItems).toBe('all');
    expect(
      (body!.addOptions as Record<string, unknown>).searchForMissingAlbums
    ).toBe(true);
  });

  it('artist already in library → triggers ArtistSearch, no POST /artist', async () => {
    let artistPosts = 0;
    let searchCalls = 0;
    server.use(
      http.get(`${LIDARR}/artist`, () => HttpResponse.json(artistList)),
      http.post(`${LIDARR}/artist`, () => {
        artistPosts += 1;
        return HttpResponse.json(addArtistSuccessLocal);
      }),
      http.post(`${LIDARR}/command`, () => {
        searchCalls += 1;
        return HttpResponse.json({ id: 1, status: 'queued' });
      })
    );
    const admin = await provisionAdminWithLidarr(harness);

    const res = await admin
      .post('/api/requests/artist')
      .set(CSRF)
      .send({ mbid: RADIOHEAD_MBID });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PROCESSING');
    expect(artistPosts).toBe(0);
    expect(searchCalls).toBe(1);
  });
});

describe('GET /api/requests, GET /:id, DELETE /:id', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('list scope=mine returns only your rows', async () => {
    const admin = await provisionAdminWithLidarr(harness);
    await admin
      .post('/api/users')
      .set(CSRF)
      .send({ username: 'bob', password: VALID_PASSWORD, role: 'USER' })
      .expect(201);

    // Insert rows directly for both users.
    const adminUser = await prisma.user.findFirstOrThrow({
      where: { username: 'admin' },
    });
    const bobUser = await prisma.user.findFirstOrThrow({
      where: { username: 'bob' },
    });
    await prisma.musicRequest.create({
      data: {
        userId: adminUser.id,
        type: 'ALBUM',
        mbid: 'a',
        name: 'A',
        status: 'PROCESSING',
      },
    });
    await prisma.musicRequest.create({
      data: {
        userId: bobUser.id,
        type: 'ALBUM',
        mbid: 'b',
        name: 'B',
        status: 'PROCESSING',
      },
    });

    const res = await admin.get('/api/requests?scope=mine');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.requests[0].mbid).toBe('a');

    const all = await admin.get('/api/requests?scope=all');
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(2);
  });

  it('non-admin scope=all → 403', async () => {
    const admin = await provisionAdminWithLidarr(harness);
    await admin
      .post('/api/users')
      .set(CSRF)
      .send({ username: 'bob', password: VALID_PASSWORD, role: 'USER' })
      .expect(201);
    const bob = harness.agent();
    await bob
      .post('/api/auth/login')
      .set(RL)
      .send({ username: 'bob', password: VALID_PASSWORD })
      .expect(200);
    const res = await bob.get('/api/requests?scope=all');
    expect(res.status).toBe(403);
  });

  it('GET /:id ownership guard', async () => {
    const admin = await provisionAdminWithLidarr(harness);
    await admin
      .post('/api/users')
      .set(CSRF)
      .send({ username: 'bob', password: VALID_PASSWORD, role: 'USER' })
      .expect(201);
    const adminUser = await prisma.user.findFirstOrThrow({
      where: { username: 'admin' },
    });
    const row = await prisma.musicRequest.create({
      data: {
        userId: adminUser.id,
        type: 'ALBUM',
        mbid: 'x',
        name: 'X',
        status: 'PROCESSING',
      },
    });

    const bob = harness.agent();
    await bob
      .post('/api/auth/login')
      .set(RL)
      .send({ username: 'bob', password: VALID_PASSWORD })
      .expect(200);
    const res = await bob.get(`/api/requests/${row.id}`);
    expect(res.status).toBe(404);
  });

  it('DELETE /:id removes the row', async () => {
    const admin = await provisionAdminWithLidarr(harness);
    const adminUser = await prisma.user.findFirstOrThrow({
      where: { username: 'admin' },
    });
    const row = await prisma.musicRequest.create({
      data: {
        userId: adminUser.id,
        type: 'ALBUM',
        mbid: 'x',
        name: 'X',
        status: 'PROCESSING',
      },
    });
    const res = await admin
      .delete(`/api/requests/${row.id}`)
      .set(CSRF)
      .send({});
    expect(res.status).toBe(204);
    const after = await prisma.musicRequest.findUnique({
      where: { id: row.id },
    });
    expect(after).toBeNull();
  });

  it('DELETE /:id 404 for non-owner', async () => {
    const admin = await provisionAdminWithLidarr(harness);
    await admin
      .post('/api/users')
      .set(CSRF)
      .send({ username: 'bob', password: VALID_PASSWORD, role: 'USER' })
      .expect(201);
    const adminUser = await prisma.user.findFirstOrThrow({
      where: { username: 'admin' },
    });
    const row = await prisma.musicRequest.create({
      data: {
        userId: adminUser.id,
        type: 'ALBUM',
        mbid: 'x',
        name: 'X',
        status: 'PROCESSING',
      },
    });
    const bob = harness.agent();
    await bob
      .post('/api/auth/login')
      .set(RL)
      .send({ username: 'bob', password: VALID_PASSWORD })
      .expect(200);
    const res = await bob
      .delete(`/api/requests/${row.id}`)
      .set(CSRF)
      .send({});
    expect(res.status).toBe(404);
  });
});

describe('input validation', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('400 when mbid is missing', async () => {
    const admin = await provisionAdminWithLidarr(harness);
    const res = await admin.post('/api/requests/album').set(CSRF).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
