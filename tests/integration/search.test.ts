/**
 * Integration tests for /api/search.
 *
 * MusicBrainz and Cover Art Archive responses are mocked via msw at their
 * production URLs (the singletons in `server/api/musicbrainz/index.ts`
 * hard-code those URLs). Fixtures are shared with the MusicBrainz unit
 * test so search and detail behave consistently.
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

import searchInRainbows from '../__fixtures__/musicbrainz/searchInRainbows.json';
import searchArtists from '../__fixtures__/musicbrainz/searchArtists.json';

import { buildTestApp, VALID_PASSWORD } from './_helpers';

const RL = { 'x-test-disable-rate-limit': '1' };
const CSRF = { 'x-overhearr-csrf': '1' };

const MB = 'https://musicbrainz.org/ws/2';
const CAA = 'https://coverartarchive.org';

const handlers = [
  http.get(`${MB}/release`, () => HttpResponse.json(searchInRainbows)),
  http.get(`${MB}/artist`, () => HttpResponse.json(searchArtists)),
  // Per-release cover-art lookups — return 404 so search doesn't pay
  // unrelated retries.
  http.get(`${CAA}/release/:mbid`, () =>
    HttpResponse.json({ error: 'not found' }, { status: 404 })
  ),
];

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers(...handlers));

async function clearDb(): Promise<void> {
  await prisma.lidarrLibraryAlbum.deleteMany();
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

describe('GET /api/search — auth & setup gating', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('returns 401 unauthenticated', async () => {
    const res = await harness.agent().get('/api/search?q=in+rainbows');
    expect(res.status).toBe(401);
  });

  it('returns 409 SETUP_INCOMPLETE when authenticated but setup not done', async () => {
    const a = harness.agent();
    await a
      .post('/api/setup/initialize')
      .set(RL)
      .send({ username: 'admin', password: VALID_PASSWORD })
      .expect(201);
    const res = await a.get('/api/search?q=test');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SETUP_INCOMPLETE');
  });
});

describe('GET /api/search — happy path', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('type=all returns albums + artists, all requestStatus.exists=false', async () => {
    const admin = await provisionAdminAndComplete(harness);
    const res = await admin.get('/api/search?q=in+rainbows');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.albums)).toBe(true);
    expect(Array.isArray(res.body.artists)).toBe(true);
    expect(res.body.albums.length).toBeGreaterThan(0);
    expect(res.body.artists.length).toBeGreaterThan(0);
    for (const hit of res.body.albums) {
      expect(hit.requestStatus).toEqual({ exists: false });
      expect(hit.inLibrary).toBe(false);
      expect(typeof hit.title).toBe('string');
      expect(typeof hit.releaseGroupMbid).toBe('string');
    }
    for (const hit of res.body.artists) {
      expect(hit.requestStatus).toEqual({ exists: false });
      expect(hit.inLibrary).toBe(false);
    }
  }, 15_000);

  it('flags inLibrary=true for albums and artists present in the local Lidarr mirror', async () => {
    const admin = await provisionAdminAndComplete(harness);
    // Pre-seed the local mirror with the albums search will hit. The
    // dedupe step in MusicBrainz collapses both releases to release-group
    // "rg-rainbows", and the artist search returns one Radiohead row.
    await prisma.lidarrLibraryAlbum.create({
      data: {
        foreignAlbumId: 'rg-rainbows',
        foreignArtistId: 'radiohead-mbid',
        lidarrAlbumId: 1,
        lidarrArtistId: 10,
      },
    });

    const res = await admin.get('/api/search?q=in+rainbows');
    expect(res.status).toBe(200);
    const albumHit = res.body.albums.find(
      (a: { releaseGroupMbid: string }) => a.releaseGroupMbid === 'rg-rainbows'
    );
    expect(albumHit?.inLibrary).toBe(true);
    const artistHit = res.body.artists.find(
      (a: { mbid: string }) => a.mbid === 'radiohead-mbid'
    );
    expect(artistHit?.inLibrary).toBe(true);
  }, 15_000);

  it('attaches PENDING status when the user has a previous request for the album', async () => {
    const admin = await provisionAdminAndComplete(harness);
    const userRow = await prisma.user.findFirstOrThrow();
    // Create a PENDING request for the deduped release-group "rg-rainbows".
    await prisma.musicRequest.create({
      data: {
        userId: userRow.id,
        type: 'ALBUM',
        mbid: 'rg-rainbows',
        name: 'In Rainbows',
        status: 'PENDING',
      },
    });

    const res = await admin.get('/api/search?q=in+rainbows&type=album');
    expect(res.status).toBe(200);
    const hit = res.body.albums.find(
      (a: { releaseGroupMbid: string }) => a.releaseGroupMbid === 'rg-rainbows'
    );
    expect(hit).toBeDefined();
    expect(hit.requestStatus.exists).toBe(true);
    expect(hit.requestStatus.status).toBe('PENDING');
    expect(hit.requestStatus.type).toBe('ALBUM');
    expect(typeof hit.requestStatus.id).toBe('number');
    expect(typeof hit.requestStatus.createdAt).toBe('string');
  }, 15_000);

  it('type=album returns empty artists; type=artist returns empty albums', async () => {
    const admin = await provisionAdminAndComplete(harness);
    const onlyAlbums = await admin.get('/api/search?q=in+rainbows&type=album');
    expect(onlyAlbums.status).toBe(200);
    expect(onlyAlbums.body.artists).toEqual([]);
    expect(onlyAlbums.body.albums.length).toBeGreaterThan(0);

    const onlyArtists = await admin.get('/api/search?q=radiohead&type=artist');
    expect(onlyArtists.status).toBe(200);
    expect(onlyArtists.body.albums).toEqual([]);
    expect(onlyArtists.body.artists.length).toBeGreaterThan(0);
  }, 15_000);

  it('400 ValidationError when q is empty', async () => {
    const admin = await provisionAdminAndComplete(harness);
    const res = await admin.get('/api/search?q=');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 ValidationError when q is missing entirely', async () => {
    const admin = await provisionAdminAndComplete(harness);
    const res = await admin.get('/api/search');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 ValidationError on invalid type', async () => {
    const admin = await provisionAdminAndComplete(harness);
    const res = await admin.get('/api/search?q=foo&type=bogus');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
