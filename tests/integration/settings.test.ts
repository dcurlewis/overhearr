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

import { buildTestApp, VALID_PASSWORD } from './_helpers';

const RL = { 'x-test-disable-rate-limit': '1' };
const CSRF = { 'x-overhearr-csrf': '1' };

const LIDARR_URL = 'http://lidarr.local:8686';

async function clearDb(): Promise<void> {
  await prisma.musicRequest.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.settings.deleteMany();
  // The settingsService is a module-level singleton; force it to re-read
  // the freshly-cleared row on the next request.
  settingsService.invalidate();
}

async function provisionAdmin(harness: ReturnType<typeof buildTestApp>) {
  const a = harness.agent();
  await a
    .post('/api/setup/initialize')
    .set(RL)
    .send({ username: 'admin', password: VALID_PASSWORD })
    .expect(201);
  return a;
}

async function provisionUser(harness: ReturnType<typeof buildTestApp>) {
  const admin = await provisionAdmin(harness);
  await admin
    .post('/api/users')
    .set(CSRF)
    .send({ username: 'bob', password: VALID_PASSWORD })
    .expect(201);
  const bob = harness.agent();
  await bob
    .post('/api/auth/login')
    .set(RL)
    .send({ username: 'bob', password: VALID_PASSWORD })
    .expect(200);
  return bob;
}

// ---- msw mock server -------------------------------------------------------

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

// ---------------------------------------------------------------------------

describe('settings router — auth', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('non-admin gets 403 on every settings route', async () => {
    const bob = await provisionUser(harness);
    const get = await bob.get('/api/settings');
    expect(get.status).toBe(403);
    const patch = await bob.patch('/api/settings/lidarr').set(CSRF).send({ url: LIDARR_URL });
    expect(patch.status).toBe(403);
    const test = await bob
      .post('/api/settings/lidarr/test')
      .set(CSRF)
      .send({ url: LIDARR_URL, apiKey: 'k' });
    expect(test.status).toBe(403);
    const profiles = await bob.get('/api/settings/lidarr/profiles');
    expect(profiles.status).toBe(403);
  });

  it('unauthenticated gets 401', async () => {
    const res = await harness.agent().get('/api/settings');
    expect(res.status).toBe(401);
  });
});

describe('settings router — admin GET/PATCH', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('GET returns redacted (never raw key)', async () => {
    const admin = await provisionAdmin(harness);
    const SECRET = 'lidarr-key-1234567890abcd';
    await admin
      .patch('/api/settings/lidarr')
      .set(CSRF)
      .send({
        url: LIDARR_URL,
        apiKey: SECRET,
        rootFolderPath: '/music',
        qualityProfileId: 1,
        metadataProfileId: 1,
      })
      .expect(200);

    const res = await admin.get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.lidarrUrl).toBe(LIDARR_URL);
    expect(res.body.lidarrApiKey).toMatch(/^•+abcd$/);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it('PATCH /lidarr stores + redacts; empty apiKey on second PATCH preserves it', async () => {
    const admin = await provisionAdmin(harness);
    const SECRET = 'first-key-9999';

    const first = await admin
      .patch('/api/settings/lidarr')
      .set(CSRF)
      .send({
        url: LIDARR_URL,
        apiKey: SECRET,
        rootFolderPath: '/music',
        qualityProfileId: 1,
        metadataProfileId: 2,
      });
    expect(first.status).toBe(200);
    expect(first.body.lidarrApiKey).toMatch(/9999$/);

    // Re-PATCH with empty apiKey — must preserve the previous value.
    const second = await admin
      .patch('/api/settings/lidarr')
      .set(CSRF)
      .send({ apiKey: '', qualityProfileId: 7 });
    expect(second.status).toBe(200);
    expect(second.body.lidarrQualityProfileId).toBe(7);
    expect(second.body.lidarrApiKey).toMatch(/9999$/);

    // The decrypted config must still equal the original key.
    const cfg = await settingsService.getDecryptedLidarrConfig();
    expect(cfg?.apiKey).toBe(SECRET);
  });

});

describe('settings router — PATCH /quotas', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('GET exposes the quota defaults (null initially)', async () => {
    const admin = await provisionAdmin(harness);
    const res = await admin.get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.defaultQuotaActiveLimit).toBeNull();
    expect(res.body.defaultQuotaWeeklyLimit).toBeNull();
  });

  it('sets and clears the global defaults', async () => {
    const admin = await provisionAdmin(harness);
    const set = await admin
      .patch('/api/settings/quotas')
      .set(CSRF)
      .send({ defaultQuotaActiveLimit: 5, defaultQuotaWeeklyLimit: 10 });
    expect(set.status).toBe(200);
    expect(set.body.defaultQuotaActiveLimit).toBe(5);
    expect(set.body.defaultQuotaWeeklyLimit).toBe(10);

    const clear = await admin
      .patch('/api/settings/quotas')
      .set(CSRF)
      .send({ defaultQuotaActiveLimit: null });
    expect(clear.status).toBe(200);
    expect(clear.body.defaultQuotaActiveLimit).toBeNull();
    // Untouched field is preserved.
    expect(clear.body.defaultQuotaWeeklyLimit).toBe(10);
  });

  it('rejects a non-positive limit', async () => {
    const admin = await provisionAdmin(harness);
    const res = await admin
      .patch('/api/settings/quotas')
      .set(CSRF)
      .send({ defaultQuotaActiveLimit: 0 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an empty body', async () => {
    const admin = await provisionAdmin(harness);
    const res = await admin.patch('/api/settings/quotas').set(CSRF).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('non-admin gets 403', async () => {
    const bob = await provisionUser(harness);
    const res = await bob
      .patch('/api/settings/quotas')
      .set(CSRF)
      .send({ defaultQuotaActiveLimit: 5 });
    expect(res.status).toBe(403);
  });
});

describe('settings router — POST /lidarr/test', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('returns ok:true when Lidarr returns 200', async () => {
    server.use(
      http.get(`${LIDARR_URL}/api/v1/system/status`, () =>
        HttpResponse.json({ version: '2.4.3.4248', instanceName: 'TestLidarr' })
      )
    );
    const admin = await provisionAdmin(harness);
    const res = await admin
      .post('/api/settings/lidarr/test')
      .set(CSRF)
      .send({ url: LIDARR_URL, apiKey: 'k' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.version).toBe('2.4.3.4248');
    expect(res.body.instanceName).toBe('TestLidarr');
  });

  it('returns ok:false with auth message on 401', async () => {
    server.use(
      http.get(`${LIDARR_URL}/api/v1/system/status`, () =>
        HttpResponse.json({ message: 'Unauthorized' }, { status: 401 })
      )
    );
    const admin = await provisionAdmin(harness);
    const res = await admin
      .post('/api/settings/lidarr/test')
      .set(CSRF)
      .send({ url: LIDARR_URL, apiKey: 'bad' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.toLowerCase()).toContain('auth');
  });

  it('returns ok:false on a 500-class Lidarr response', async () => {
    server.use(
      http.get(`${LIDARR_URL}/api/v1/system/status`, () =>
        HttpResponse.json({ message: 'oops' }, { status: 500 })
      )
    );
    const admin = await provisionAdmin(harness);
    const res = await admin
      .post('/api/settings/lidarr/test')
      .set(CSRF)
      .send({ url: LIDARR_URL, apiKey: 'k' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/HTTP 500/);
  });

  it('returns 400 on missing body fields', async () => {
    const admin = await provisionAdmin(harness);
    const res = await admin
      .post('/api/settings/lidarr/test')
      .set(CSRF)
      .send({ url: 'not-a-url', apiKey: 'k' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns ok:false with unreachable message on network error', async () => {
    server.use(
      http.get(`${LIDARR_URL}/api/v1/system/status`, () => HttpResponse.error())
    );
    const admin = await provisionAdmin(harness);
    const res = await admin
      .post('/api/settings/lidarr/test')
      .set(CSRF)
      .send({ url: LIDARR_URL, apiKey: 'k' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.toLowerCase()).toContain('unreachable');
  });
});

describe('settings router — GET /lidarr/profiles', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('400 when Lidarr URL/key are not yet configured', async () => {
    const admin = await provisionAdmin(harness);
    const res = await admin.get('/api/settings/lidarr/profiles');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('502 when Lidarr is unreachable from /lidarr/profiles', async () => {
    server.use(
      http.get(`${LIDARR_URL}/api/v1/rootfolder`, () => HttpResponse.error()),
      http.get(`${LIDARR_URL}/api/v1/qualityprofile`, () => HttpResponse.error()),
      http.get(`${LIDARR_URL}/api/v1/metadataprofile`, () => HttpResponse.error())
    );
    const admin = await provisionAdmin(harness);
    await admin
      .patch('/api/settings/lidarr')
      .set(CSRF)
      .send({
        url: LIDARR_URL,
        apiKey: 'k',
        rootFolderPath: '/music',
        qualityProfileId: 1,
        metadataProfileId: 1,
      })
      .expect(200);

    const res = await admin.get('/api/settings/lidarr/profiles');
    expect(res.status).toBe(502);
  });

  it('200 with rootFolders/qualityProfiles/metadataProfiles when configured', async () => {
    server.use(
      http.get(`${LIDARR_URL}/api/v1/rootfolder`, () =>
        HttpResponse.json([{ id: 1, path: '/music', accessible: true }])
      ),
      http.get(`${LIDARR_URL}/api/v1/qualityprofile`, () =>
        HttpResponse.json([{ id: 1, name: 'Lossless' }])
      ),
      http.get(`${LIDARR_URL}/api/v1/metadataprofile`, () =>
        HttpResponse.json([{ id: 1, name: 'Standard' }])
      )
    );

    const admin = await provisionAdmin(harness);
    await admin
      .patch('/api/settings/lidarr')
      .set(CSRF)
      .send({
        url: LIDARR_URL,
        apiKey: 'k',
        rootFolderPath: '/music',
        qualityProfileId: 1,
        metadataProfileId: 1,
      })
      .expect(200);

    const res = await admin.get('/api/settings/lidarr/profiles');
    expect(res.status).toBe(200);
    expect(res.body.rootFolders).toEqual([
      { id: 1, path: '/music', accessible: true },
    ]);
    expect(res.body.qualityProfiles).toEqual([{ id: 1, name: 'Lossless' }]);
    expect(res.body.metadataProfiles).toEqual([{ id: 1, name: 'Standard' }]);
  });
});

describe('POST /api/setup/complete', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('400 when Lidarr is not configured', async () => {
    const admin = await provisionAdmin(harness);
    const res = await admin.post('/api/setup/complete').set(CSRF).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('200 + flips setupCompleted when Lidarr is configured', async () => {
    const admin = await provisionAdmin(harness);
    await admin
      .patch('/api/settings/lidarr')
      .set(CSRF)
      .send({
        url: LIDARR_URL,
        apiKey: 'k',
        rootFolderPath: '/music',
        qualityProfileId: 1,
        metadataProfileId: 1,
      })
      .expect(200);

    const res = await admin.post('/api/setup/complete').set(CSRF).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ setupCompleted: true });

    const status = await harness.agent().get('/api/setup/status');
    expect(status.body.setupCompleted).toBe(true);
  });

  it('non-admin gets 403', async () => {
    const bob = await provisionUser(harness);
    const res = await bob.post('/api/setup/complete').set(CSRF).send({});
    expect(res.status).toBe(403);
  });
});

describe('GET /api/health — lidarrConfigured', () => {
  let harness: ReturnType<typeof buildTestApp>;
  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('reports false initially and true once Lidarr is fully configured', async () => {
    const before = await harness.agent().get('/api/health');
    expect(before.body.lidarrConfigured).toBe(false);

    const admin = await provisionAdmin(harness);
    await admin
      .patch('/api/settings/lidarr')
      .set(CSRF)
      .send({
        url: LIDARR_URL,
        apiKey: 'k',
        rootFolderPath: '/music',
        qualityProfileId: 1,
        metadataProfileId: 1,
      })
      .expect(200);

    const after = await harness.agent().get('/api/health');
    expect(after.body.lidarrConfigured).toBe(true);
  });
});
