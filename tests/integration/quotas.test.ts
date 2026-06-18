/**
 * Integration tests for per-user request quotas at the request-create
 * boundary (POST /api/requests/album).
 *
 * Quota enforcement runs BEFORE any Lidarr call, so the over-quota cases
 * never need Lidarr to be reachable — we seed the quota-filling rows
 * directly. The happy-path Lidarr handlers are only registered for the
 * "under limit succeeds" case.
 *
 * Covers: under limit OK, at-limit 429 (active + weekly), admin exempt,
 * user-override-beats-global, null = unlimited.
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

const RG_RAINBOWS = 'rg-rainbows';
const RADIOHEAD_MBID = 'radiohead-mbid';

const artistLookupRadiohead = [
  { artistName: 'Radiohead', foreignArtistId: RADIOHEAD_MBID, monitored: false },
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
const addArtistSuccessLocal = {
  ...addArtistSuccess,
  foreignArtistId: RADIOHEAD_MBID,
};
const addAlbumSuccessLocal = { ...addAlbumSuccess, foreignAlbumId: RG_RAINBOWS };

const baseHandlers = [
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
afterEach(() => server.resetHandlers(...baseHandlers));

function registerHappyPathLidarr(): void {
  server.use(
    http.get(`${LIDARR}/artist`, () => HttpResponse.json([])),
    http.get(`${LIDARR}/artist/lookup`, () =>
      HttpResponse.json(artistLookupRadiohead)
    ),
    http.post(`${LIDARR}/artist`, () => HttpResponse.json(addArtistSuccessLocal)),
    http.get(`${LIDARR}/album/lookup`, () =>
      HttpResponse.json(albumLookupInRainbows)
    ),
    http.post(`${LIDARR}/album`, () => HttpResponse.json(addAlbumSuccessLocal)),
    http.post(`${LIDARR}/command`, () =>
      HttpResponse.json({ id: 1, status: 'queued' })
    )
  );
}

async function clearDb(): Promise<void> {
  await prisma.musicRequest.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.settings.deleteMany();
  settingsService.invalidate();
  lidarrClientCache.invalidate();
}

/** Create a non-admin user `bob` and return a logged-in agent + the id. */
async function provisionBob(
  harness: ReturnType<typeof buildTestApp>,
  admin: Awaited<ReturnType<typeof provisionAdminWithLidarr>>
): Promise<{ bob: ReturnType<(typeof harness)['agent']>; bobId: number }> {
  await admin
    .post('/api/users')
    .set(CSRF)
    .send({ username: 'bob', password: VALID_PASSWORD, role: 'USER' })
    .expect(201);
  const bobUser = await prisma.user.findFirstOrThrow({
    where: { username: 'bob' },
  });
  const bob = harness.agent();
  await bob
    .post('/api/auth/login')
    .set(RL)
    .send({ username: 'bob', password: VALID_PASSWORD })
    .expect(200);
  return { bob, bobId: bobUser.id };
}

/** Seed N active (PROCESSING) request rows directly for a user. */
async function seedActive(userId: number, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await prisma.musicRequest.create({
      data: {
        userId,
        type: 'ALBUM',
        mbid: `seed-${userId}-${i}`,
        name: `Seed ${i}`,
        status: 'PROCESSING',
      },
    });
  }
}

describe('POST /api/requests/album — quota enforcement', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('429 QUOTA_EXCEEDED when a non-admin user is at the active limit', async () => {
    const admin = await provisionAdminWithLidarr(harness);
    const { bob, bobId } = await provisionBob(harness, admin);
    // Give bob an override of 1 active request, then fill it.
    await admin
      .patch(`/api/users/${bobId}`)
      .set(CSRF)
      .send({ quotaActiveLimit: 1 })
      .expect(200);
    await seedActive(bobId, 1);

    const res = await bob
      .post('/api/requests/album')
      .set(CSRF)
      .send({ mbid: RG_RAINBOWS });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
    expect(res.body.error.message).toMatch(/active request/i);
  });

  it('429 when at the weekly limit', async () => {
    const admin = await provisionAdminWithLidarr(harness);
    const { bob, bobId } = await provisionBob(harness, admin);
    await admin
      .patch(`/api/users/${bobId}`)
      .set(CSRF)
      .send({ quotaWeeklyLimit: 1 })
      .expect(200);
    // A single AVAILABLE row created "now" counts toward the weekly window
    // even though it is not active.
    await prisma.musicRequest.create({
      data: {
        userId: bobId,
        type: 'ALBUM',
        mbid: 'weekly-seed',
        name: 'Weekly seed',
        status: 'AVAILABLE',
      },
    });

    const res = await bob
      .post('/api/requests/album')
      .set(CSRF)
      .send({ mbid: RG_RAINBOWS });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
    expect(res.body.error.message).toMatch(/per week/i);
  });

  it('admins are exempt from quotas', async () => {
    // Set a strict global default of 0-equivalent (1) and fill the admin's
    // own queue; the admin request must still succeed.
    registerHappyPathLidarr();
    const admin = await provisionAdminWithLidarr(harness);
    await admin
      .patch('/api/settings/quotas')
      .set(CSRF)
      .send({ defaultQuotaActiveLimit: 1 })
      .expect(200);
    const adminUser = await prisma.user.findFirstOrThrow({
      where: { username: 'admin' },
    });
    await seedActive(adminUser.id, 5);

    const res = await admin
      .post('/api/requests/album')
      .set(CSRF)
      .send({ mbid: RG_RAINBOWS });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PROCESSING');
  });

  it('under the limit succeeds for a non-admin user', async () => {
    registerHappyPathLidarr();
    const admin = await provisionAdminWithLidarr(harness);
    const { bob, bobId } = await provisionBob(harness, admin);
    await admin
      .patch(`/api/users/${bobId}`)
      .set(CSRF)
      .send({ quotaActiveLimit: 3 })
      .expect(200);
    await seedActive(bobId, 1);

    const res = await bob
      .post('/api/requests/album')
      .set(CSRF)
      .send({ mbid: RG_RAINBOWS });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PROCESSING');
  });

  it('user override (unlimited via higher value) beats a strict global default', async () => {
    registerHappyPathLidarr();
    const admin = await provisionAdminWithLidarr(harness);
    const { bob, bobId } = await provisionBob(harness, admin);
    // Global default is 1 (would block), but bob's override raises it to 10.
    await admin
      .patch('/api/settings/quotas')
      .set(CSRF)
      .send({ defaultQuotaActiveLimit: 1 })
      .expect(200);
    await admin
      .patch(`/api/users/${bobId}`)
      .set(CSRF)
      .send({ quotaActiveLimit: 10 })
      .expect(200);
    await seedActive(bobId, 3);

    const res = await bob
      .post('/api/requests/album')
      .set(CSRF)
      .send({ mbid: RG_RAINBOWS });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PROCESSING');
  });

  it('null/unset quota = unlimited (no default, no override)', async () => {
    registerHappyPathLidarr();
    const admin = await provisionAdminWithLidarr(harness);
    const { bob, bobId } = await provisionBob(harness, admin);
    // No global default, no override; pile on many active rows.
    await seedActive(bobId, 25);

    const res = await bob
      .post('/api/requests/album')
      .set(CSRF)
      .send({ mbid: RG_RAINBOWS });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('PROCESSING');
  });

  it('clearing a user override (null) falls back to the global default', async () => {
    const admin = await provisionAdminWithLidarr(harness);
    const { bob, bobId } = await provisionBob(harness, admin);
    // Global default 1; give bob a generous override, then clear it.
    await admin
      .patch('/api/settings/quotas')
      .set(CSRF)
      .send({ defaultQuotaActiveLimit: 1 })
      .expect(200);
    await admin
      .patch(`/api/users/${bobId}`)
      .set(CSRF)
      .send({ quotaActiveLimit: 10 })
      .expect(200);
    await admin
      .patch(`/api/users/${bobId}`)
      .set(CSRF)
      .send({ quotaActiveLimit: null })
      .expect(200);
    await seedActive(bobId, 1);

    const res = await bob
      .post('/api/requests/album')
      .set(CSRF)
      .send({ mbid: RG_RAINBOWS });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('QUOTA_EXCEEDED');
  });
});
