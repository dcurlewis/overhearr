import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../server/db/prisma';

import { buildTestApp, VALID_PASSWORD } from './_helpers';

const RATE_LIMIT_BYPASS = { 'x-test-disable-rate-limit': '1' };

async function clearDb(): Promise<void> {
  await prisma.musicRequest.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.settings.deleteMany();
}

describe('auth + setup', () => {
  let harness: ReturnType<typeof buildTestApp>;

  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });

  afterEach(() => {
    harness.store.stopCleanup();
  });

  it('GET /api/setup/status: empty install reports hasAdmin=false', async () => {
    const res = await harness.agent().get('/api/setup/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ setupCompleted: false, hasAdmin: false });
  });

  it('POST /api/setup/initialize: creates first admin and logs in', async () => {
    const a = harness.agent();
    const res = await a
      .post('/api/setup/initialize')
      .set(RATE_LIMIT_BYPASS)
      .send({ username: 'Admin', password: VALID_PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      username: 'admin',
      role: 'ADMIN',
      isActive: true,
    });
    expect(res.body.passwordHash).toBeUndefined();

    // Cookie set => /me returns the same user.
    const me = await a.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.username).toBe('admin');
  });

  it('POST /api/setup/initialize: second call fails with 409', async () => {
    const a = harness.agent();
    await a
      .post('/api/setup/initialize')
      .set(RATE_LIMIT_BYPASS)
      .send({ username: 'admin', password: VALID_PASSWORD })
      .expect(201);

    const res = await harness
      .agent()
      .post('/api/setup/initialize')
      .set(RATE_LIMIT_BYPASS)
      .send({ username: 'other', password: VALID_PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('POST /api/setup/initialize: rejects weak passwords', async () => {
    const res = await harness
      .agent()
      .post('/api/setup/initialize')
      .set(RATE_LIMIT_BYPASS)
      .send({ username: 'admin', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('POST /api/setup/initialize: rejects bad usernames', async () => {
    const res = await harness
      .agent()
      .post('/api/setup/initialize')
      .set(RATE_LIMIT_BYPASS)
      .send({ username: 'a b', password: VALID_PASSWORD });
    expect(res.status).toBe(400);
  });

  describe('with admin already provisioned', () => {
    beforeEach(async () => {
      await harness
        .agent()
        .post('/api/setup/initialize')
        .set(RATE_LIMIT_BYPASS)
        .send({ username: 'admin', password: VALID_PASSWORD })
        .expect(201);
    });

    it('login: wrong password -> 401', async () => {
      const res = await harness
        .agent()
        .post('/api/auth/login')
        .set(RATE_LIMIT_BYPASS)
        .send({ username: 'admin', password: 'wrong-password' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('login: right password -> 200, /me returns user', async () => {
      const a = harness.agent();
      const res = await a
        .post('/api/auth/login')
        .set(RATE_LIMIT_BYPASS)
        .send({ username: 'ADMIN', password: VALID_PASSWORD }); // case-insensitive
      expect(res.status).toBe(200);
      expect(res.body.username).toBe('admin');

      const me = await a.get('/api/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.username).toBe('admin');
    });

    it('logout: destroys session, /me -> 401', async () => {
      const a = harness.agent();
      await a
        .post('/api/auth/login')
        .set(RATE_LIMIT_BYPASS)
        .send({ username: 'admin', password: VALID_PASSWORD })
        .expect(200);
      await a.post('/api/auth/logout').set('x-overhearr-csrf', '1').expect(204);
      const me = await a.get('/api/auth/me');
      expect(me.status).toBe(401);
    });

    it('inactive user cannot log in', async () => {
      await prisma.user.update({
        where: { username: 'admin' },
        data: { isActive: false },
      });
      // We need to ensure another admin exists — but we just deactivated the
      // sole admin via direct DB write, so that bypasses the guard. Fine for
      // this test's scope.
      const res = await harness
        .agent()
        .post('/api/auth/login')
        .set(RATE_LIMIT_BYPASS)
        .send({ username: 'admin', password: VALID_PASSWORD });
      expect(res.status).toBe(401);
    });

    it('login: rate limit triggers 429 after 10 failed attempts', async () => {
      const a = harness.agent();
      // Don't bypass rate limit here.
      let lastStatus = 0;
      for (let i = 0; i < 11; i++) {
        const r = await a
          .post('/api/auth/login')
          .send({ username: 'admin', password: 'bad-password' });
        lastStatus = r.status;
      }
      expect(lastStatus).toBe(429);
    });

    it('requireAuth: rejects sessions tied to deleted users', async () => {
      const a = harness.agent();
      await a
        .post('/api/auth/login')
        .set(RATE_LIMIT_BYPASS)
        .send({ username: 'admin', password: VALID_PASSWORD })
        .expect(200);
      await prisma.user.deleteMany({ where: { username: 'admin' } });
      const me = await a.get('/api/auth/me');
      expect(me.status).toBe(401);
    });
  });
});
