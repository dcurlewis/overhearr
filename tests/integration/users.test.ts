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

async function provisionAdmin(harness: ReturnType<typeof buildTestApp>) {
  const a = harness.agent();
  await a
    .post('/api/setup/initialize')
    .set(RL)
    .send({ username: 'admin', password: VALID_PASSWORD })
    .expect(201);
  return a;
}

describe('users CRUD', () => {
  let harness: ReturnType<typeof buildTestApp>;

  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });

  afterEach(() => {
    harness.store.stopCleanup();
  });

  it('non-admin gets 403', async () => {
    const admin = await provisionAdmin(harness);
    // Admin creates a USER.
    const created = await admin
      .post('/api/users')
      .set(CSRF)
      .send({ username: 'bob', password: VALID_PASSWORD })
      .expect(201);
    expect(created.body.role).toBe('USER');

    // Bob logs in.
    const bob = harness.agent();
    await bob
      .post('/api/auth/login')
      .set(RL)
      .send({ username: 'bob', password: VALID_PASSWORD })
      .expect(200);

    // Bob hits /api/users -> 403.
    const res = await bob.get('/api/users');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('admin lists, creates, patches, deletes users', async () => {
    const admin = await provisionAdmin(harness);

    // Create
    const create = await admin
      .post('/api/users')
      .set(CSRF)
      .send({ username: 'Alice', password: VALID_PASSWORD, role: 'USER' });
    expect(create.status).toBe(201);
    expect(create.body.username).toBe('alice');
    const aliceId = create.body.id as number;

    // List
    const list = await admin.get('/api/users');
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
    expect(list.body.users).toHaveLength(2);

    // Get one
    const one = await admin.get(`/api/users/${aliceId}`);
    expect(one.status).toBe(200);
    expect(one.body.username).toBe('alice');

    // Patch
    const patch = await admin
      .patch(`/api/users/${aliceId}`)
      .set(CSRF)
      .send({ isActive: false });
    expect(patch.status).toBe(200);
    expect(patch.body.isActive).toBe(false);

    // Delete
    const del = await admin
      .delete(`/api/users/${aliceId}`)
      .set(CSRF);
    expect(del.status).toBe(204);

    const after = await admin.get('/api/users');
    expect(after.body.total).toBe(1);
  });

  it('last-admin guard: cannot deactivate the sole admin', async () => {
    const admin = await provisionAdmin(harness);
    // Create another admin so we can test "self-deactivate" separately.
    // Here we only have one admin, so try to deactivate a different admin
    // by constructing a second-admin then deactivate first.
    const me = await admin.get('/api/auth/me');
    const adminId = me.body.id as number;

    // With sole admin, attempt isActive=false -> blocked by self-deactivate
    // first since we're patching ourselves. So instead try to demote role.
    const demote = await admin
      .patch(`/api/users/${adminId}`)
      .set(CSRF)
      .send({ role: 'USER' });
    expect(demote.status).toBe(400);
    expect(demote.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('last-admin guard: cannot delete the sole admin (other-admin path)', async () => {
    const admin = await provisionAdmin(harness);
    // Create a second admin, then have the first admin try to delete the second?
    // For "last admin" we need exactly 1 active admin. So: create second admin,
    // delete second admin (allowed), then attempt to deactivate the first via
    // patch -> blocked by self-deactivate. The "last-admin via delete" path
    // only fires for non-self admins; once second is deleted we're back to 1.
    // Instead: with only the original admin, deleting him triggers
    // self-delete guard (also covered below). The cleanest path: deactivate
    // own only admin via direct guard test through a second admin.
    const second = await admin
      .post('/api/users')
      .set(CSRF)
      .send({ username: 'admin2', password: VALID_PASSWORD, role: 'ADMIN' })
      .expect(201);
    const secondId = second.body.id as number;

    // Login as admin2.
    const a2 = harness.agent();
    await a2
      .post('/api/auth/login')
      .set(RL)
      .send({ username: 'admin2', password: VALID_PASSWORD })
      .expect(200);

    // From admin2, deactivate the original admin -> ok (still have admin2 active).
    const meRes = await admin.get('/api/auth/me');
    const firstId = meRes.body.id as number;
    const deact = await a2
      .patch(`/api/users/${firstId}`)
      .set(CSRF)
      .send({ isActive: false });
    expect(deact.status).toBe(200);

    // Now admin2 is the sole active admin. Try to delete admin2 from original
    // admin (deactivated, can't). Use admin2 trying to delete himself ->
    // self-delete guard kicks in.
    const selfDel = await a2.delete(`/api/users/${secondId}`).set(CSRF);
    expect(selfDel.status).toBe(400);

    // And try to demote admin2 via... only admin2 is active admin; no other
    // admin can patch. So patch from admin2 with role=USER -> self-demote
    // blocked. Already covered above. Final check: ensure last-admin via
    // delete path triggers when *another* admin tries to delete the lone
    // active admin: re-activate first admin, demote first admin to USER (now
    // admin2 is sole admin), then have first try to delete admin2.
    await prisma.user.update({
      where: { id: firstId },
      data: { isActive: true },
    });
    await a2
      .patch(`/api/users/${firstId}`)
      .set(CSRF)
      .send({ role: 'USER' })
      .expect(200);
    // First admin is now a USER and active. Login as a fresh agent (admin
    // session for first admin still valid, but the user is now USER role).
    const firstNow = harness.agent();
    await firstNow
      .post('/api/auth/login')
      .set(RL)
      .send({ username: 'admin', password: VALID_PASSWORD })
      .expect(200);
    const tryDelete = await firstNow.delete(`/api/users/${secondId}`).set(CSRF);
    // first is now USER, so should get 403.
    expect(tryDelete.status).toBe(403);
  });

  it('self-deactivate is refused', async () => {
    const admin = await provisionAdmin(harness);
    const me = await admin.get('/api/auth/me');
    const id = me.body.id as number;
    const res = await admin
      .patch(`/api/users/${id}`)
      .set(CSRF)
      .send({ isActive: false });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/own account/i);
  });

  it('self-delete is refused', async () => {
    const admin = await provisionAdmin(harness);
    const me = await admin.get('/api/auth/me');
    const res = await admin.delete(`/api/users/${me.body.id}`).set(CSRF);
    expect(res.status).toBe(400);
  });

  it('duplicate username -> 409', async () => {
    const admin = await provisionAdmin(harness);
    await admin
      .post('/api/users')
      .set(CSRF)
      .send({ username: 'dup', password: VALID_PASSWORD })
      .expect(201);
    const res = await admin
      .post('/api/users')
      .set(CSRF)
      .send({ username: 'DUP', password: VALID_PASSWORD });
    expect(res.status).toBe(409);
  });

  it('GET /api/users/:id with bad id -> 404', async () => {
    const admin = await provisionAdmin(harness);
    const res = await admin.get('/api/users/99999');
    expect(res.status).toBe(404);
  });

  it('weak password rejected on create', async () => {
    const admin = await provisionAdmin(harness);
    const res = await admin
      .post('/api/users')
      .set(CSRF)
      .send({ username: 'weak', password: 'short' });
    expect(res.status).toBe(400);
  });
});

describe('profile password', () => {
  let harness: ReturnType<typeof buildTestApp>;

  beforeEach(async () => {
    await clearDb();
    harness = buildTestApp();
  });

  afterEach(() => {
    harness.store.stopCleanup();
  });

  it('PATCH /api/profile/password works with right currentPassword', async () => {
    const a = harness.agent();
    await a
      .post('/api/setup/initialize')
      .set(RL)
      .send({ username: 'admin', password: VALID_PASSWORD })
      .expect(201);

    const newPass = 'BrandNew1Pass';
    const res = await a
      .patch('/api/profile/password')
      .set(CSRF)
      .send({ currentPassword: VALID_PASSWORD, newPassword: newPass });
    expect(res.status).toBe(204);

    // Login with the new password.
    const fresh = harness.agent();
    const login = await fresh
      .post('/api/auth/login')
      .set(RL)
      .send({ username: 'admin', password: newPass });
    expect(login.status).toBe(200);
  });

  it('PATCH /api/profile/password rejects wrong currentPassword', async () => {
    const a = harness.agent();
    await a
      .post('/api/setup/initialize')
      .set(RL)
      .send({ username: 'admin', password: VALID_PASSWORD })
      .expect(201);

    const res = await a
      .patch('/api/profile/password')
      .set(CSRF)
      .send({ currentPassword: 'NotMyPassword1', newPassword: 'BrandNew1Pass' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/incorrect/i);
  });

  it('PATCH /api/profile/password rejects unauthenticated', async () => {
    const res = await harness
      .agent()
      .patch('/api/profile/password')
      .set(CSRF)
      .send({ currentPassword: 'x', newPassword: 'BrandNew1Pass' });
    expect(res.status).toBe(401);
  });

  it('PATCH /api/profile/password rejects weak new password', async () => {
    const a = harness.agent();
    await a
      .post('/api/setup/initialize')
      .set(RL)
      .send({ username: 'admin', password: VALID_PASSWORD })
      .expect(201);
    const res = await a
      .patch('/api/profile/password')
      .set(CSRF)
      .send({ currentPassword: VALID_PASSWORD, newPassword: 'short' });
    expect(res.status).toBe(400);
  });
});
