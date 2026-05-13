/**
 * Integration tests for the reconciliation worker + manual-trigger endpoint.
 *
 * The worker is normally driven by setInterval in production (skipped in
 * NODE_ENV=test). Tests invoke `runReconciliationOnce` directly or hit
 * POST /api/requests/_reconcile.
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
  isReconciliationRunning,
  runReconciliationOnce,
  startReconciliationLoop,
  stopReconciliationLoop,
} from '../../server/services/reconciliationWorker';

import {
  buildTestApp,
  provisionAdminWithLidarr,
  VALID_PASSWORD,
} from './_helpers';

const RL = { 'x-test-disable-rate-limit': '1' };
const CSRF = { 'x-overhearr-csrf': '1' };

const LIDARR = 'http://test-lidarr.local:8686/api/v1';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

async function clearDb(): Promise<void> {
  await prisma.musicRequest.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.settings.deleteMany();
  settingsService.invalidate();
  lidarrClientCache.invalidate();
}

describe('runReconciliationOnce', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('flips PROCESSING albums to AVAILABLE when downloaded', async () => {
    await provisionAdminWithLidarr(harness);
    const admin = await prisma.user.findFirstOrThrow();
    const row = await prisma.musicRequest.create({
      data: {
        userId: admin.id,
        type: 'ALBUM',
        mbid: 'rg-1',
        name: 'Album 1',
        status: 'PROCESSING',
        lidarrAlbumId: 555,
        lidarrArtistId: 99,
      },
    });

    server.use(
      http.get(`${LIDARR}/album/555`, () =>
        HttpResponse.json({
          id: 555,
          title: 'Album 1',
          foreignAlbumId: 'rg-1',
          artistId: 99,
          monitored: true,
          anyReleaseOk: true,
          statistics: { trackFileCount: 10, trackCount: 10 },
        })
      )
    );

    const summary = await runReconciliationOnce();
    expect(summary.checked).toBe(1);
    expect(summary.promotedToAvailable).toBe(1);
    expect(summary.errors).toBe(0);

    const after = await prisma.musicRequest.findUnique({
      where: { id: row.id },
    });
    expect(after?.status).toBe('AVAILABLE');
  });

  it('flips PROCESSING artists to AVAILABLE when artist statistics report complete', async () => {
    await provisionAdminWithLidarr(harness);
    const admin = await prisma.user.findFirstOrThrow();
    const row = await prisma.musicRequest.create({
      data: {
        userId: admin.id,
        type: 'ARTIST',
        mbid: 'a1',
        name: 'Artist 1',
        status: 'PROCESSING',
        lidarrArtistId: 42,
      },
    });

    server.use(
      http.get(`${LIDARR}/artist/42`, () =>
        HttpResponse.json({
          id: 42,
          artistName: 'Artist 1',
          statistics: { albumCount: 9, albumFileCount: 9 },
        })
      )
    );

    const summary = await runReconciliationOnce();
    expect(summary.promotedToAvailable).toBe(1);
    const after = await prisma.musicRequest.findUnique({
      where: { id: row.id },
    });
    expect(after?.status).toBe('AVAILABLE');
  });

  it('does not touch AVAILABLE / FAILED / PENDING rows', async () => {
    await provisionAdminWithLidarr(harness);
    const admin = await prisma.user.findFirstOrThrow();
    const seedStatuses: Array<'AVAILABLE' | 'FAILED' | 'PENDING'> = [
      'AVAILABLE',
      'FAILED',
      'PENDING',
    ];
    const ids: number[] = [];
    for (const s of seedStatuses) {
      const r = await prisma.musicRequest.create({
        data: {
          userId: admin.id,
          type: 'ALBUM',
          mbid: `mbid-${s}`,
          name: s,
          status: s,
          lidarrAlbumId: 100,
        },
      });
      ids.push(r.id);
    }
    // Even if the album endpoint reports complete, none of these rows are
    // PROCESSING so they should not be touched.
    server.use(
      http.get(`${LIDARR}/album/100`, () =>
        HttpResponse.json({
          id: 100,
          title: 'X',
          foreignAlbumId: 'x',
          artistId: 1,
          monitored: true,
          anyReleaseOk: true,
          statistics: { trackFileCount: 10, trackCount: 10 },
        })
      )
    );

    const summary = await runReconciliationOnce();
    expect(summary.checked).toBe(0);
    expect(summary.promotedToAvailable).toBe(0);

    for (let i = 0; i < seedStatuses.length; i++) {
      const after = await prisma.musicRequest.findUnique({
        where: { id: ids[i] as number },
      });
      expect(after?.status).toBe(seedStatuses[i]);
    }
  });

  it('per-row errors are counted but do not abort the pass', async () => {
    await provisionAdminWithLidarr(harness);
    const admin = await prisma.user.findFirstOrThrow();
    const a = await prisma.musicRequest.create({
      data: {
        userId: admin.id,
        type: 'ALBUM',
        mbid: 'rg-good',
        name: 'good',
        status: 'PROCESSING',
        lidarrAlbumId: 1,
      },
    });
    const b = await prisma.musicRequest.create({
      data: {
        userId: admin.id,
        type: 'ALBUM',
        mbid: 'rg-bad',
        name: 'bad',
        status: 'PROCESSING',
        lidarrAlbumId: 2,
      },
    });

    server.use(
      http.get(`${LIDARR}/album/1`, () =>
        HttpResponse.json({
          id: 1,
          title: 'good',
          foreignAlbumId: 'rg-good',
          artistId: 1,
          monitored: true,
          anyReleaseOk: true,
          statistics: { trackFileCount: 5, trackCount: 5 },
        })
      ),
      http.get(`${LIDARR}/album/2`, () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 })
      )
    );

    const summary = await runReconciliationOnce();
    expect(summary.checked).toBe(2);
    expect(summary.promotedToAvailable).toBe(1);
    expect(summary.errors).toBe(1);

    const aAfter = await prisma.musicRequest.findUnique({ where: { id: a.id } });
    const bAfter = await prisma.musicRequest.findUnique({ where: { id: b.id } });
    expect(aAfter?.status).toBe('AVAILABLE');
    expect(bAfter?.status).toBe('PROCESSING');
  });

  it('skips PROCESSING rows missing lidarr ids', async () => {
    await provisionAdminWithLidarr(harness);
    const admin = await prisma.user.findFirstOrThrow();
    const a = await prisma.musicRequest.create({
      data: {
        userId: admin.id,
        type: 'ALBUM',
        mbid: 'rg-noid',
        name: 'No id',
        status: 'PROCESSING',
        // lidarrAlbumId omitted intentionally
      },
    });
    const b = await prisma.musicRequest.create({
      data: {
        userId: admin.id,
        type: 'ARTIST',
        mbid: 'art-noid',
        name: 'No id',
        status: 'PROCESSING',
      },
    });

    const summary = await runReconciliationOnce();
    expect(summary.checked).toBe(2);
    expect(summary.promotedToAvailable).toBe(0);
    expect(summary.errors).toBe(0);

    const aAfter = await prisma.musicRequest.findUnique({ where: { id: a.id } });
    const bAfter = await prisma.musicRequest.findUnique({ where: { id: b.id } });
    expect(aAfter?.status).toBe('PROCESSING');
    expect(bAfter?.status).toBe('PROCESSING');
  });

  it('returns checked:0 when Lidarr is not configured', async () => {
    // Provision then strip Lidarr settings.
    await provisionAdminWithLidarr(harness);
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

    const summary = await runReconciliationOnce();
    expect(summary).toEqual({ checked: 0, promotedToAvailable: 0, errors: 0 });
  });
});

describe('startReconciliationLoop / stopReconciliationLoop', () => {
  it('is a no-op in NODE_ENV=test', () => {
    expect(process.env.NODE_ENV).toBe('test');
    startReconciliationLoop();
    expect(isReconciliationRunning()).toBe(false);
    // stop is idempotent.
    stopReconciliationLoop();
    expect(isReconciliationRunning()).toBe(false);
  });

  it('starts and stops when forced into a non-test mode', () => {
    const env = process.env as Record<string, string | undefined>;
    const original = env.NODE_ENV;
    env.NODE_ENV = 'production';
    try {
      startReconciliationLoop({ intervalMs: 60_000 });
      expect(isReconciliationRunning()).toBe(true);
      // Second start is idempotent.
      startReconciliationLoop({ intervalMs: 60_000 });
      expect(isReconciliationRunning()).toBe(true);
    } finally {
      stopReconciliationLoop();
      env.NODE_ENV = original;
    }
    expect(isReconciliationRunning()).toBe(false);
  });
});

describe('POST /api/requests/_reconcile', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('admin can manually reconcile (returns summary)', async () => {
    const admin = await provisionAdminWithLidarr(harness);
    const res = await admin
      .post('/api/requests/_reconcile')
      .set(CSRF)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      checked: 0,
      promotedToAvailable: 0,
      errors: 0,
    });
  });

  it('non-admin → 403', async () => {
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
    const res = await bob
      .post('/api/requests/_reconcile')
      .set(CSRF)
      .send({});
    expect(res.status).toBe(403);
  });

  it('without CSRF → 403', async () => {
    const admin = await provisionAdminWithLidarr(harness);
    const res = await admin.post('/api/requests/_reconcile').send({});
    expect(res.status).toBe(403);
  });
});
