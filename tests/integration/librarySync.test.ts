/**
 * Integration tests for the library-sync worker + manual-trigger endpoint.
 *
 * Mirrors the structure of `reconciliation.test.ts`: msw fronts a fake
 * Lidarr at `http://test-lidarr.local:8686`, the worker is invoked
 * directly, and side-effects on `LidarrLibraryAlbum` are asserted via
 * Prisma.
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
import {
  isLibrarySyncRunning,
  runLibrarySyncOnce,
  startLibrarySyncLoop,
  stopLibrarySyncLoop,
} from '../../server/services/librarySyncWorker';
import { getLibraryStatusBatch } from '../../server/services/libraryLookupService';

import {
  buildTestApp,
  CSRF_HEADER,
  RL_BYPASS,
  provisionAdminWithLidarr,
  VALID_PASSWORD,
} from './_helpers';

const LIDARR = 'http://test-lidarr.local:8686/api/v1';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

async function clearDb(): Promise<void> {
  await prisma.lidarrLibraryAlbum.deleteMany();
  await prisma.musicRequest.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.settings.deleteMany();
  settingsService.invalidate();
  lidarrClientCache.invalidate();
}

const sampleAlbums = [
  {
    id: 1,
    title: 'OK Computer',
    foreignAlbumId: 'rg-okcomputer',
    artistId: 10,
    monitored: true,
    anyReleaseOk: true,
    artist: { id: 10, foreignArtistId: 'art-radiohead' },
  },
  {
    id: 2,
    title: 'Kid A',
    foreignAlbumId: 'rg-kida',
    artistId: 10,
    monitored: true,
    anyReleaseOk: true,
    artist: { id: 10, foreignArtistId: 'art-radiohead' },
  },
];

describe('runLibrarySyncOnce', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('returns ran:false when Lidarr is unconfigured', async () => {
    // Provision then strip Lidarr settings.
    await provisionAdminWithLidarr(harness);
    await prisma.settings.update({
      where: { id: 1 },
      data: {
        lidarrUrl: null,
        lidarrApiKeyEncrypted: null,
      },
    });
    settingsService.invalidate();
    lidarrClientCache.invalidate();

    const summary = await runLibrarySyncOnce();
    expect(summary).toEqual({
      ran: false,
      fetched: 0,
      upserted: 0,
      removed: 0,
    });
  });

  it('upserts every Lidarr album into LidarrLibraryAlbum', async () => {
    await provisionAdminWithLidarr(harness);
    server.use(
      http.get(`${LIDARR}/album`, () => HttpResponse.json(sampleAlbums))
    );

    const summary = await runLibrarySyncOnce();
    expect(summary.ran).toBe(true);
    expect(summary.fetched).toBe(2);
    expect(summary.upserted).toBe(2);
    expect(summary.removed).toBe(0);

    const rows = await prisma.lidarrLibraryAlbum.findMany({
      orderBy: { foreignAlbumId: 'asc' },
    });
    expect(rows.map((r) => r.foreignAlbumId)).toEqual([
      'rg-kida',
      'rg-okcomputer',
    ]);
    expect(rows[0]).toMatchObject({
      foreignArtistId: 'art-radiohead',
      lidarrAlbumId: 2,
      lidarrArtistId: 10,
    });
  });

  it('removes rows that are no longer in Lidarr', async () => {
    await provisionAdminWithLidarr(harness);
    // Seed an existing local row for an album Lidarr no longer reports.
    await prisma.lidarrLibraryAlbum.create({
      data: {
        foreignAlbumId: 'rg-stale',
        foreignArtistId: 'art-stale',
        lidarrAlbumId: 999,
        lidarrArtistId: 998,
      },
    });

    server.use(
      http.get(`${LIDARR}/album`, () => HttpResponse.json(sampleAlbums))
    );

    const summary = await runLibrarySyncOnce();
    expect(summary.removed).toBe(1);

    const stale = await prisma.lidarrLibraryAlbum.findUnique({
      where: { foreignAlbumId: 'rg-stale' },
    });
    expect(stale).toBeNull();
  });

  it('drops rows missing foreignAlbumId or foreignArtistId at the client', async () => {
    await provisionAdminWithLidarr(harness);
    server.use(
      http.get(`${LIDARR}/album`, () =>
        HttpResponse.json([
          ...sampleAlbums,
          // No foreignAlbumId → dropped
          { id: 99, artistId: 10, artist: { id: 10, foreignArtistId: 'x' } },
          // No artist.foreignArtistId → dropped
          { id: 100, foreignAlbumId: 'rg-no-artist', artistId: 11 },
        ])
      )
    );
    const summary = await runLibrarySyncOnce();
    expect(summary.fetched).toBe(2);
    expect(summary.upserted).toBe(2);
  });

  it('concurrent calls share a single in-flight pass (no overlapping prune)', async () => {
    await provisionAdminWithLidarr(harness);

    let albumCalls = 0;
    server.use(
      http.get(`${LIDARR}/album`, async () => {
        albumCalls += 1;
        // Hold the response open long enough for both callers to enter
        // the pass and observe the single-flight behavior.
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.json(sampleAlbums);
      })
    );

    const [a, b] = await Promise.all([
      runLibrarySyncOnce(),
      runLibrarySyncOnce(),
    ]);

    // Both callers see the same summary, and Lidarr was hit exactly once.
    expect(albumCalls).toBe(1);
    expect(a).toEqual(b);
    expect(a.ran).toBe(true);
    expect(a.fetched).toBe(2);
  });

  it('returns ran:false when Lidarr errors during fetch', async () => {
    await provisionAdminWithLidarr(harness);
    server.use(
      http.get(`${LIDARR}/album`, () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 })
      )
    );

    const summary = await runLibrarySyncOnce();
    expect(summary.ran).toBe(false);
    const rows = await prisma.lidarrLibraryAlbum.findMany();
    expect(rows).toEqual([]);
  });
});

describe('getLibraryStatusBatch', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('returns true for albums and artists present in the local mirror', async () => {
    await prisma.lidarrLibraryAlbum.create({
      data: {
        foreignAlbumId: 'rg-okcomputer',
        foreignArtistId: 'art-radiohead',
        lidarrAlbumId: 1,
        lidarrArtistId: 10,
      },
    });

    const result = await getLibraryStatusBatch([
      { mbid: 'rg-okcomputer', type: 'ALBUM' },
      { mbid: 'rg-missing', type: 'ALBUM' },
      { mbid: 'art-radiohead', type: 'ARTIST' },
      { mbid: 'art-missing', type: 'ARTIST' },
    ]);

    expect(result.get('ALBUM:rg-okcomputer')).toBe(true);
    expect(result.get('ALBUM:rg-missing')).toBe(false);
    expect(result.get('ARTIST:art-radiohead')).toBe(true);
    expect(result.get('ARTIST:art-missing')).toBe(false);
  });

  it('empty input → empty map', async () => {
    const result = await getLibraryStatusBatch([]);
    expect(result.size).toBe(0);
  });
});

describe('startLibrarySyncLoop / stopLibrarySyncLoop', () => {
  it('is a no-op in NODE_ENV=test', () => {
    expect(process.env.NODE_ENV).toBe('test');
    startLibrarySyncLoop();
    expect(isLibrarySyncRunning()).toBe(false);
    stopLibrarySyncLoop();
    expect(isLibrarySyncRunning()).toBe(false);
  });

  it('starts and stops when forced into a non-test mode', () => {
    const env = process.env as Record<string, string | undefined>;
    const original = env.NODE_ENV;
    env.NODE_ENV = 'production';
    try {
      startLibrarySyncLoop({ intervalMs: 60_000 });
      expect(isLibrarySyncRunning()).toBe(true);
      // Idempotent.
      startLibrarySyncLoop({ intervalMs: 60_000 });
      expect(isLibrarySyncRunning()).toBe(true);
    } finally {
      stopLibrarySyncLoop();
      env.NODE_ENV = original;
    }
    expect(isLibrarySyncRunning()).toBe(false);
  });
});

describe('POST /api/settings/library-sync', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('admin can manually trigger a library sync', async () => {
    const admin = await provisionAdminWithLidarr(harness);
    server.use(
      http.get(`${LIDARR}/album`, () => HttpResponse.json(sampleAlbums))
    );
    const res = await admin
      .post('/api/settings/library-sync')
      .set(CSRF_HEADER)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ran: true,
      fetched: 2,
      upserted: 2,
      removed: 0,
    });
  });

  it('non-admin → 403', async () => {
    const admin = await provisionAdminWithLidarr(harness);
    await admin
      .post('/api/users')
      .set(CSRF_HEADER)
      .send({ username: 'bob', password: VALID_PASSWORD, role: 'USER' })
      .expect(201);
    const bob = harness.agent();
    await bob
      .post('/api/auth/login')
      .set(RL_BYPASS)
      .send({ username: 'bob', password: VALID_PASSWORD })
      .expect(200);
    const res = await bob
      .post('/api/settings/library-sync')
      .set(CSRF_HEADER)
      .send({});
    expect(res.status).toBe(403);
  });

  it('without CSRF → 403', async () => {
    const admin = await provisionAdminWithLidarr(harness);
    const res = await admin.post('/api/settings/library-sync').send({});
    expect(res.status).toBe(403);
  });
});
