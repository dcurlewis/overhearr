/**
 * Integration tests for /api/discover.
 *
 * The Last.fm singleton (`server/api/lastfm/index.ts`) reads its API key
 * lazily via `settingsService.getDecryptedLastfmKey()` on every call, so
 * we control "configured vs. not" by setting (or omitting) the key in
 * Settings between tests.
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

import { lastfm } from '../../server/api/lastfm';
import { prisma } from '../../server/db/prisma';
import { settingsService } from '../../server/services/settingsService';

import { buildTestApp, VALID_PASSWORD } from './_helpers';

const RL = { 'x-test-disable-rate-limit': '1' };
const CSRF = { 'x-overhearr-csrf': '1' };

const LASTFM = 'https://ws.audioscrobbler.com/2.0/';

interface LfmHandlerOpts {
  topAlbums?: object;
  topArtists?: object;
  geoTopAlbums?: object;
  unreachable?: boolean;
}

function lastfmHandlers(opts: LfmHandlerOpts = {}) {
  return [
    http.get(LASTFM, ({ request }) => {
      if (opts.unreachable) return HttpResponse.error();
      const url = new URL(request.url);
      const method = url.searchParams.get('method');
      if (method === 'chart.gettopalbums') {
        return HttpResponse.json(opts.topAlbums ?? { topalbums: { album: [] } });
      }
      if (method === 'chart.gettopartists') {
        return HttpResponse.json(opts.topArtists ?? { artists: { artist: [] } });
      }
      if (method === 'geo.gettopalbums') {
        return HttpResponse.json(opts.geoTopAlbums ?? { topalbums: { album: [] } });
      }
      return HttpResponse.json({ error: 6, message: 'unknown method' });
    }),
  ];
}

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  // The lastfm client caches by method name; reset between tests so each
  // case sees its own handlers.
  lastfm.clearCache();
});

async function clearDb(): Promise<void> {
  await prisma.musicRequest.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.settings.deleteMany();
  settingsService.invalidate();
}

async function provisionAdminAndComplete(harness: ReturnType<typeof buildTestApp>) {
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

  it('configured:false + empty arrays when Last.fm key not set', async () => {
    const admin = await provisionAdminAndComplete(harness);
    const res = await admin.get('/api/discover');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      configured: false,
      topAlbums: [],
      topArtists: [],
      newReleases: [],
    });
    // Cache header is still present.
    expect(res.headers['cache-control']).toMatch(/private/);
  });

  it('full payload with configured:true when Last.fm responds', async () => {
    server.use(
      ...lastfmHandlers({
        topAlbums: {
          topalbums: {
            album: [
              {
                mbid: 'rg-rainbows',
                name: 'In Rainbows',
                artist: { name: 'Radiohead', mbid: 'radiohead-mbid' },
                playcount: '1000',
              },
              {
                mbid: '',
                name: 'Untagged',
                artist: 'Some Band',
              },
            ],
          },
        },
        topArtists: {
          artists: {
            artist: [
              { mbid: 'radiohead-mbid', name: 'Radiohead', listeners: '500' },
              { name: 'Tagless Artist' }, // no mbid → no requestStatus
            ],
          },
        },
        geoTopAlbums: {
          topalbums: {
            album: [
              {
                mbid: 'rg-okcomputer',
                name: 'OK Computer',
                artist: 'Radiohead',
              },
            ],
          },
        },
      })
    );
    const admin = await provisionAdminAndComplete(harness);
    await admin.patch('/api/settings/lastfm').set(CSRF).send({ apiKey: 'lfm-1234' }).expect(200);
    settingsService.invalidate();

    // Pre-seed a request to verify enrichment.
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
    expect(res.body.configured).toBe(true);
    expect(res.body.topAlbums).toHaveLength(2);
    expect(res.body.topArtists).toHaveLength(2);
    expect(res.body.newReleases).toHaveLength(1);

    // Albums: the one with mbid carries requestStatus; the untagged one
    // does not have a requestStatus key.
    const rainbows = res.body.topAlbums[0];
    expect(rainbows.mbid).toBe('rg-rainbows');
    expect(rainbows.requestStatus.exists).toBe(true);
    expect(rainbows.requestStatus.status).toBe('PENDING');
    const untagged = res.body.topAlbums[1];
    expect(untagged.mbid).toBeUndefined();
    expect(untagged.requestStatus).toBeUndefined();

    const radiohead = res.body.topArtists[0];
    expect(radiohead.requestStatus).toEqual({ exists: false });
    const tagless = res.body.topArtists[1];
    expect(tagless.requestStatus).toBeUndefined();
  });

  it('gracefully degrades to empty sections when Last.fm is unreachable', async () => {
    // The Last.fm client swallows per-section upstream failures (so a flaky
    // chart endpoint cannot blank the entire page). The route therefore
    // returns configured:true with whatever sections succeeded, even when
    // all three failed.
    server.use(...lastfmHandlers({ unreachable: true }));
    const admin = await provisionAdminAndComplete(harness);
    await admin.patch('/api/settings/lastfm').set(CSRF).send({ apiKey: 'lfm-1234' }).expect(200);
    settingsService.invalidate();

    const res = await admin.get('/api/discover');
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.topAlbums).toEqual([]);
    expect(res.body.topArtists).toEqual([]);
    expect(res.body.newReleases).toEqual([]);
  });
});
