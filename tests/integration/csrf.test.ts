import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../server/db/prisma';

import { buildTestApp, VALID_PASSWORD } from './_helpers';

const RL = { 'x-test-disable-rate-limit': '1' };
const CSRF = { 'x-overhearr-csrf': '1' };

async function clearDb(): Promise<void> {
  await prisma.musicRequest.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.settings.deleteMany();
}

describe('CSRF', () => {
  let harness: ReturnType<typeof buildTestApp>;

  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });

  afterEach(() => {
    harness.store.stopCleanup();
  });

  it('setup/initialize does NOT require CSRF header', async () => {
    const res = await harness
      .agent()
      .post('/api/setup/initialize')
      .set(RL)
      // intentionally NO csrf header
      .send({ username: 'admin', password: VALID_PASSWORD });
    expect(res.status).toBe(201);
  });

  it('login does NOT require CSRF header', async () => {
    const a = harness.agent();
    await a
      .post('/api/setup/initialize')
      .set(RL)
      .send({ username: 'admin', password: VALID_PASSWORD })
      .expect(201);

    const res = await harness
      .agent()
      .post('/api/auth/login')
      .set(RL)
      .send({ username: 'admin', password: VALID_PASSWORD });
    expect(res.status).toBe(200);
  });

  it('PATCH /api/users/:id WITHOUT CSRF header -> 403', async () => {
    const a = harness.agent();
    await a
      .post('/api/setup/initialize')
      .set(RL)
      .send({ username: 'admin', password: VALID_PASSWORD })
      .expect(201);

    // Create a target user.
    const target = await a
      .post('/api/users')
      .set(CSRF)
      .send({ username: 'target', password: VALID_PASSWORD })
      .expect(201);

    const res = await a
      .patch(`/api/users/${target.body.id}`)
      .send({ isActive: false }); // no CSRF header
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('PATCH /api/users/:id WITH CSRF header -> 200', async () => {
    const a = harness.agent();
    await a
      .post('/api/setup/initialize')
      .set(RL)
      .send({ username: 'admin', password: VALID_PASSWORD })
      .expect(201);
    const target = await a
      .post('/api/users')
      .set(CSRF)
      .send({ username: 'target', password: VALID_PASSWORD })
      .expect(201);
    const res = await a
      .patch(`/api/users/${target.body.id}`)
      .set(CSRF)
      .send({ isActive: false });
    expect(res.status).toBe(200);
  });

  it('logout requires CSRF header', async () => {
    const a = harness.agent();
    await a
      .post('/api/setup/initialize')
      .set(RL)
      .send({ username: 'admin', password: VALID_PASSWORD })
      .expect(201);

    const noCsrf = await a.post('/api/auth/logout');
    expect(noCsrf.status).toBe(403);

    const withCsrf = await a.post('/api/auth/logout').set(CSRF);
    expect(withCsrf.status).toBe(204);
  });
});
