/**
 * Integration tests for /api/album/:mbid and /api/artist/:mbid.
 *
 * MusicBrainz + Cover Art Archive are mocked at the singletons' production
 * URLs via msw. Per-test handler overrides let us exercise 404, large
 * discographies, and request-status enrichment.
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

import releaseInRainbows from '../__fixtures__/musicbrainz/releaseInRainbows.json';
import artistDiscography from '../__fixtures__/musicbrainz/artistDiscography.json';
import coverArtFixture from '../__fixtures__/musicbrainz/coverArt.json';

import { ARTIST_COVER_ART_CAP } from '../../server/routes/music';
import { buildTestApp, VALID_PASSWORD } from './_helpers';

const RL = { 'x-test-disable-rate-limit': '1' };
const CSRF = { 'x-overhearr-csrf': '1' };

const MB = 'https://musicbrainz.org/ws/2';
const CAA = 'https://coverartarchive.org';

interface RGCounters {
  releaseGroupCAA: number;
}

const counters: RGCounters = { releaseGroupCAA: 0 };

const baseHandlers = [
  // /release/:mbid — direct hit on the In Rainbows fixture by default.
  http.get(`${MB}/release/:mbid`, () => HttpResponse.json(releaseInRainbows)),
  // /artist/:mbid — Radiohead discography fixture.
  http.get(`${MB}/artist/:mbid`, () => HttpResponse.json(artistDiscography)),
  // CAA per-release lookup — return cover for the In Rainbows release id.
  http.get(`${CAA}/release/:mbid`, ({ params }) => {
    if (params.mbid === 'release-rainbows-001') {
      return HttpResponse.json(coverArtFixture);
    }
    return HttpResponse.json({ error: 'not found' }, { status: 404 });
  }),
  // CAA release-group lookup (used by the artist discography).
  http.get(`${CAA}/release-group/:mbid`, () => {
    counters.releaseGroupCAA += 1;
    return HttpResponse.json(coverArtFixture);
  }),
];

const server = setupServer(...baseHandlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers(...baseHandlers);
  counters.releaseGroupCAA = 0;
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

describe('GET /api/album/:mbid', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('happy path returns full album with both request statuses absent', async () => {
    const admin = await provisionAdminAndComplete(harness);
    const res = await admin.get('/api/album/release-rainbows-001');
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('In Rainbows');
    expect(res.body.tracks).toHaveLength(2);
    expect(res.body.requestStatus).toEqual({ exists: false });
    expect(res.body.artistRequestStatus).toEqual({ exists: false });
  }, 15_000);

  it('returns 404 MB_NOT_FOUND when MusicBrainz misses both endpoints', async () => {
    server.use(
      http.get(`${MB}/release/:mbid`, () =>
        HttpResponse.json({ error: 'gone' }, { status: 404 })
      ),
      http.get(`${MB}/release-group/:mbid`, () =>
        HttpResponse.json({ error: 'gone' }, { status: 404 })
      )
    );
    const admin = await provisionAdminAndComplete(harness);
    const res = await admin.get('/api/album/totally-unknown');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('MB_NOT_FOUND');
  }, 15_000);

  it('attaches album + artist request statuses when both rows exist', async () => {
    const admin = await provisionAdminAndComplete(harness);
    const userRow = await prisma.user.findFirstOrThrow();
    await prisma.musicRequest.createMany({
      data: [
        {
          userId: userRow.id,
          type: 'ALBUM',
          mbid: 'rg-rainbows',
          name: 'In Rainbows',
          status: 'PROCESSING',
        },
        {
          userId: userRow.id,
          type: 'ARTIST',
          mbid: 'radiohead-mbid',
          name: 'Radiohead',
          status: 'AVAILABLE',
        },
      ],
    });
    const res = await admin.get('/api/album/release-rainbows-001');
    expect(res.status).toBe(200);
    expect(res.body.requestStatus.exists).toBe(true);
    expect(res.body.requestStatus.status).toBe('PROCESSING');
    expect(res.body.requestStatus.type).toBe('ALBUM');
    expect(res.body.artistRequestStatus.exists).toBe(true);
    expect(res.body.artistRequestStatus.status).toBe('AVAILABLE');
    expect(res.body.artistRequestStatus.type).toBe('ARTIST');
  }, 15_000);
});

describe('GET /api/artist/:mbid', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('returns artist + discography with per-album request status', async () => {
    const admin = await provisionAdminAndComplete(harness);
    const userRow = await prisma.user.findFirstOrThrow();
    // Pre-seed: rg-okcomputer is requested as PENDING. rg-rainbows is not.
    await prisma.musicRequest.create({
      data: {
        userId: userRow.id,
        type: 'ALBUM',
        mbid: 'rg-okcomputer',
        name: 'OK Computer',
        status: 'PENDING',
      },
    });

    const res = await admin.get('/api/artist/radiohead-mbid');
    expect(res.status).toBe(200);
    expect(res.body.mbid).toBe('radiohead-mbid');
    expect(res.body.name).toBe('Radiohead');
    expect(res.body.requestStatus).toEqual({ exists: false });

    const titles = res.body.releaseGroups.map((rg: { title: string }) => rg.title);
    // Discography fixture filters to Album-only (3 entries) sorted desc.
    expect(titles).toEqual(['The Best Of', 'In Rainbows', 'OK Computer']);

    const ok = res.body.releaseGroups.find((rg: { mbid: string }) => rg.mbid === 'rg-okcomputer');
    expect(ok).toBeDefined();
    expect(ok.requestStatus.exists).toBe(true);
    expect(ok.requestStatus.status).toBe('PENDING');

    const rainbows = res.body.releaseGroups.find((rg: { mbid: string }) => rg.mbid === 'rg-rainbows');
    expect(rainbows.requestStatus).toEqual({ exists: false });

    // Cover art was fetched for every (3) RG; all carry coverArtUrl.
    for (const rg of res.body.releaseGroups) {
      expect(rg.coverArtUrl).toContain('front.jpg');
    }
  }, 15_000);

  it('caps cover-art lookups at ARTIST_COVER_ART_CAP for huge discographies', async () => {
    // Synthesise a 100-RG fixture.
    const big = {
      id: 'big-artist',
      name: 'Big Artist',
      'sort-name': 'Big Artist',
      'release-groups': Array.from({ length: 100 }, (_, i) => ({
        id: `rg-big-${i}`,
        title: `Album ${i}`,
        'primary-type': 'Album',
        'first-release-date': `20${String(20 + (i % 5)).padStart(2, '0')}-01-01`,
      })),
    };
    server.use(
      http.get(`${MB}/artist/:mbid`, ({ params }) => {
        if (params.mbid === 'big-artist') return HttpResponse.json(big);
        return HttpResponse.json(artistDiscography);
      })
    );

    const admin = await provisionAdminAndComplete(harness);
    const res = await admin.get('/api/artist/big-artist');
    expect(res.status).toBe(200);
    expect(res.body.releaseGroups).toHaveLength(100);
    expect(counters.releaseGroupCAA).toBe(ARTIST_COVER_ART_CAP);

    const withCover = res.body.releaseGroups.filter(
      (rg: { coverArtUrl?: string }) => typeof rg.coverArtUrl === 'string'
    );
    expect(withCover).toHaveLength(ARTIST_COVER_ART_CAP);
  }, 30_000);
});
