/**
 * Integration tests for /api/image — the cover-art / artist-image proxy.
 *
 * The upstream image fetch is mocked via msw at the production CAA URL (the
 * `imageCache` singleton hard-codes nothing — it fetches the validated `src`
 * directly). The on-disk cache writes to a per-worker tmp dir configured in
 * `tests/integration/setup-env.ts`.
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

import { buildTestApp, VALID_PASSWORD } from './_helpers';

const RL = { 'x-test-disable-rate-limit': '1' };

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ALLOWED = 'https://coverartarchive.org/release/abc/1-250.jpg';

let upstreamHits = 0;

const handlers = [
  http.get('https://coverartarchive.org/release/:mbid/:file', () => {
    upstreamHits += 1;
    return HttpResponse.arrayBuffer(new Uint8Array(PNG).buffer, {
      headers: { 'Content-Type': 'image/png' },
    });
  }),
  // A host that returns HTML rather than an image.
  http.get('https://musicbrainz.org/bad.html', () =>
    HttpResponse.text('<html></html>', {
      headers: { 'Content-Type': 'text/html' },
    })
  ),
];

const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers(...handlers);
  upstreamHits = 0;
});

async function clearDb(): Promise<void> {
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.settings.deleteMany();
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

describe('GET /api/image', () => {
  let harness: ReturnType<typeof buildTestApp>;

  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });
  afterEach(() => harness.store.stopCleanup());

  it('rejects unauthenticated requests', async () => {
    const res = await harness
      .agent()
      .get(`/api/image?src=${encodeURIComponent(ALLOWED)}`);
    expect(res.status).toBe(401);
  });

  it('400s when src is missing', async () => {
    const a = await provisionAdmin(harness);
    const res = await a.get('/api/image');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400s for a disallowed host (SSRF guard)', async () => {
    const a = await provisionAdmin(harness);
    const res = await a.get(
      `/api/image?src=${encodeURIComponent('https://evil.example.com/x.png')}`
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IMAGE_SOURCE_NOT_ALLOWED');
    expect(upstreamHits).toBe(0);
  });

  it('400s for a non-http(s) scheme', async () => {
    const a = await provisionAdmin(harness);
    const res = await a.get(
      `/api/image?src=${encodeURIComponent('file:///etc/passwd')}`
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IMAGE_SOURCE_NOT_ALLOWED');
  });

  it('proxies and caches an allowlisted image (MISS then HIT)', async () => {
    const a = await provisionAdmin(harness);

    const first = await a.get(`/api/image?src=${encodeURIComponent(ALLOWED)}`);
    expect(first.status).toBe(200);
    expect(first.headers['content-type']).toContain('image/png');
    expect(first.headers['x-overhearr-image-cache']).toBe('MISS');
    expect(Buffer.from(first.body).equals(PNG)).toBe(true);
    expect(upstreamHits).toBe(1);

    const second = await a.get(`/api/image?src=${encodeURIComponent(ALLOWED)}`);
    expect(second.status).toBe(200);
    expect(second.headers['x-overhearr-image-cache']).toBe('HIT');
    // No second upstream round-trip.
    expect(upstreamHits).toBe(1);
  });

  it('502s when the upstream returns a non-image content type', async () => {
    const a = await provisionAdmin(harness);
    const res = await a.get(
      `/api/image?src=${encodeURIComponent('https://musicbrainz.org/bad.html')}`
    );
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe('IMAGE_NOT_AN_IMAGE');
  });
});
