/**
 * Integration tests for /api/discover.
 *
 * Both upstreams (ListenBrainz + MusicBrainz) are anonymous public APIs, so
 * we never need to manipulate Settings — only swap the msw handlers.
 *
 * The real ListenBrainz client uses `https://api.listenbrainz.org`; the real
 * MusicBrainz client uses `https://musicbrainz.org/ws/2`. We register msw
 * handlers at those URLs so the singletons used by the route resolve to our
 * fakes without test-only injection.
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

import { listenbrainz } from '../../server/api/listenbrainz';
import { musicbrainz } from '../../server/api/musicbrainz';
import { prisma } from '../../server/db/prisma';
import { settingsService } from '../../server/services/settingsService';

import { buildTestApp, VALID_PASSWORD } from './_helpers';

const RL = { 'x-test-disable-rate-limit': '1' };
const CSRF = { 'x-overhearr-csrf': '1' };

const LB = 'https://api.listenbrainz.org';
const MB = 'https://musicbrainz.org/ws/2';

const sampleReleaseGroups = {
  payload: {
    release_groups: [
      {
        release_group_name: 'In Rainbows',
        release_group_mbid: 'rg-rainbows',
        artist_name: 'Radiohead',
        artist_mbids: ['radiohead-mbid'],
        listen_count: 1000,
      },
      {
        release_group_name: 'Untagged',
        release_group_mbid: '',
        artist_name: 'Some Band',
        listen_count: 50,
      },
    ],
  },
};

const sampleArtists = {
  payload: {
    artists: [
      {
        artist_name: 'Radiohead',
        artist_mbid: 'radiohead-mbid',
        listen_count: 5000,
      },
      {
        artist_name: 'Tagless Artist',
        listen_count: 100,
      },
    ],
  },
};

const sampleNewReleases = {
  count: 1,
  'release-groups': [
    {
      id: 'rg-okcomputer',
      title: 'OK Computer',
      'primary-type': 'Album',
      'first-release-date': '2026-05-15',
      'artist-credit': [
        { name: 'Radiohead', artist: { id: 'radiohead-mbid', name: 'Radiohead' } },
      ],
    },
  ],
};

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  // Both singletons cache responses; reset between tests so each case sees
  // only its own handlers.
  listenbrainz.clearCache();
  musicbrainz.clearCache();
});

async function clearDb(): Promise<void> {
  await prisma.musicRequest.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.settings.deleteMany();
  settingsService.invalidate();
}

async function provisionAdminAndComplete(
  harness: ReturnType<typeof buildTestApp>
) {
  const a = harness.agent();
  await a
    .post('/api/setup/initialize')
    .set(RL)
    .send({ username: 'admin', password: VALID_PASSWORD })
    .expect(201);
  await a
    .patch('/api/settings/lidarr')
    .set(CSRF)
    .send({
      url: 'http://lidarr.local:8686',
      apiKey: 'k',
      rootFolderPath: '/music',
      qualityProfileId: 1,
      metadataProfileId: 1,
    })
    .expect(200);
  await a.post('/api/setup/complete').set(CSRF).send({}).expect(200);
  return a;
}

// ---------------------------------------------------------------------------

describe('GET /api/discover', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('401 unauthenticated', async () => {
    const res = await harness.agent().get('/api/discover');
    expect(res.status).toBe(401);
  });

  it('full payload when both providers respond', async () => {
    server.use(
      http.get(`${LB}/1/stats/sitewide/release-groups`, () =>
        HttpResponse.json(sampleReleaseGroups)
      ),
      http.get(`${LB}/1/stats/sitewide/artists`, () =>
        HttpResponse.json(sampleArtists)
      ),
      http.get(`${MB}/release-group`, () =>
        HttpResponse.json(sampleNewReleases)
      ),
      // CAA hit for the new-release item; we don't care if it's a 404, only
      // that the route doesn't blow up.
      http.get('https://coverartarchive.org/release-group/:mbid', () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 })
      )
    );

    const admin = await provisionAdminAndComplete(harness);

    // Pre-seed a request so we can verify enrichment.
    const userRow = await prisma.user.findFirstOrThrow();
    await prisma.musicRequest.create({
      data: {
        userId: userRow.id,
        type: 'ALBUM',
        mbid: 'rg-rainbows',
        name: 'In Rainbows',
        status: 'PENDING',
      },
    });

    const res = await admin.get('/api/discover');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toMatch(/private/);

    // Configured field is gone — body has only the three rows.
    expect(Object.keys(res.body).sort()).toEqual([
      'newReleases',
      'topAlbums',
      'topArtists',
    ]);

    // Top albums.
    expect(res.body.topAlbums).toHaveLength(2);
    const rainbows = res.body.topAlbums[0];
    expect(rainbows.mbid).toBe('rg-rainbows');
    expect(rainbows.requestStatus.exists).toBe(true);
    expect(rainbows.requestStatus.status).toBe('PENDING');

    const untagged = res.body.topAlbums[1];
    expect(untagged.mbid).toBeUndefined();
    expect(untagged.requestStatus).toBeUndefined();

    // Top artists.
    expect(res.body.topArtists).toHaveLength(2);
    expect(res.body.topArtists[0].mbid).toBe('radiohead-mbid');
    expect(res.body.topArtists[0].requestStatus).toEqual({ exists: false });
    expect(res.body.topArtists[1].requestStatus).toBeUndefined();

    // New releases.
    expect(res.body.newReleases).toHaveLength(1);
    expect(res.body.newReleases[0].mbid).toBe('rg-okcomputer');
    expect(res.body.newReleases[0].name).toBe('OK Computer');
  });

  it('per-section graceful degrade when ListenBrainz is unreachable', async () => {
    server.use(
      http.get(`${LB}/1/stats/sitewide/release-groups`, () =>
        HttpResponse.error()
      ),
      http.get(`${LB}/1/stats/sitewide/artists`, () => HttpResponse.error()),
      http.get(`${MB}/release-group`, () =>
        HttpResponse.json(sampleNewReleases)
      ),
      http.get('https://coverartarchive.org/release-group/:mbid', () =>
        HttpResponse.json({ error: 'not found' }, { status: 404 })
      )
    );
    const admin = await provisionAdminAndComplete(harness);
    const res = await admin.get('/api/discover');
    expect(res.status).toBe(200);
    expect(res.body.topAlbums).toEqual([]);
    expect(res.body.topArtists).toEqual([]);
    expect(res.body.newReleases).toHaveLength(1);
  });

  it('per-section graceful degrade when MusicBrainz is unreachable', async () => {
    server.use(
      http.get(`${LB}/1/stats/sitewide/release-groups`, () =>
        HttpResponse.json(sampleReleaseGroups)
      ),
      http.get(`${LB}/1/stats/sitewide/artists`, () =>
        HttpResponse.json(sampleArtists)
      ),
      http.get(`${MB}/release-group`, () => HttpResponse.error())
    );
    const admin = await provisionAdminAndComplete(harness);
    const res = await admin.get('/api/discover');
    expect(res.status).toBe(200);
    expect(res.body.topAlbums.length).toBeGreaterThan(0);
    expect(res.body.topArtists.length).toBeGreaterThan(0);
    expect(res.body.newReleases).toEqual([]);
  });

  it('returns three empty rows when every provider fails (never bubbles 502)', async () => {
    server.use(
      http.get(`${LB}/1/stats/sitewide/release-groups`, () =>
        HttpResponse.error()
      ),
      http.get(`${LB}/1/stats/sitewide/artists`, () => HttpResponse.error()),
      http.get(`${MB}/release-group`, () => HttpResponse.error())
    );
    const admin = await provisionAdminAndComplete(harness);
    const res = await admin.get('/api/discover');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      topAlbums: [],
      topArtists: [],
      newReleases: [],
    });
  });
});
