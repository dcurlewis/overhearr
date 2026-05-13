/**
 * Direct exercise of `requestLookupService` — pure data-access helpers,
 * but they touch Prisma so we run them as integration tests against a
 * real (test) SQLite DB.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../server/db/prisma';
import {
  getRequestStatus,
  getRequestStatusBatch,
  requestStatusKey,
} from '../../server/services/requestLookupService';

async function clearDb(): Promise<void> {
  await prisma.musicRequest.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.settings.deleteMany();
}

async function makeUser(username = 'alice'): Promise<number> {
  const u = await prisma.user.create({
    data: { username, passwordHash: 'x', role: 'USER', isActive: true },
  });
  return u.id;
}

describe('requestLookupService.getRequestStatus', () => {
  beforeEach(clearDb);
  afterEach(clearDb);

  it('returns {exists:false} when there is no row', async () => {
    const userId = await makeUser();
    const r = await getRequestStatus(userId, 'unknown-mbid', 'ALBUM');
    expect(r).toEqual({ exists: false });
  });

  it('returns the matching row (after the schema-level dedupe constraint)', async () => {
    const userId = await makeUser();
    // Phase 4b's @@unique([userId, mbid, type]) means at most one row exists
    // per tuple; retries bump the same row in place rather than appending.
    const row = await prisma.musicRequest.create({
      data: {
        userId,
        type: 'ALBUM',
        mbid: 'rg-x',
        name: 'X',
        status: 'PROCESSING',
        createdAt: new Date('2026-05-01T00:00:00Z'),
      },
    });
    const r = await getRequestStatus(userId, 'rg-x', 'ALBUM');
    expect(r.exists).toBe(true);
    if (r.exists) {
      expect(r.id).toBe(row.id);
      expect(r.status).toBe('PROCESSING');
      expect(r.type).toBe('ALBUM');
      expect(r.createdAt).toBe('2026-05-01T00:00:00.000Z');
    }
  });

  it('does not match across types (ALBUM vs ARTIST mbid collision)', async () => {
    const userId = await makeUser();
    await prisma.musicRequest.create({
      data: {
        userId,
        type: 'ARTIST',
        mbid: 'shared-mbid',
        name: 'A',
        status: 'PENDING',
      },
    });
    const album = await getRequestStatus(userId, 'shared-mbid', 'ALBUM');
    expect(album).toEqual({ exists: false });
    const artist = await getRequestStatus(userId, 'shared-mbid', 'ARTIST');
    expect(artist.exists).toBe(true);
  });

  it('does not match across users', async () => {
    const alice = await makeUser('alice');
    const bob = await makeUser('bob');
    await prisma.musicRequest.create({
      data: { userId: alice, type: 'ALBUM', mbid: 'm', name: 'M', status: 'PENDING' },
    });
    const aliceRes = await getRequestStatus(alice, 'm', 'ALBUM');
    const bobRes = await getRequestStatus(bob, 'm', 'ALBUM');
    expect(aliceRes.exists).toBe(true);
    expect(bobRes).toEqual({ exists: false });
  });
});

describe('requestLookupService.getRequestStatusBatch', () => {
  beforeEach(clearDb);
  afterEach(clearDb);

  it('returns an empty Map when given no items', async () => {
    const userId = await makeUser();
    const m = await getRequestStatusBatch(userId, []);
    expect(m.size).toBe(0);
  });

  it('returns {exists:false} for unknown items and hits for known ones', async () => {
    const userId = await makeUser();
    await prisma.musicRequest.create({
      data: { userId, type: 'ALBUM', mbid: 'a', name: 'A', status: 'PENDING' },
    });
    const m = await getRequestStatusBatch(userId, [
      { mbid: 'a', type: 'ALBUM' },
      { mbid: 'b', type: 'ALBUM' },
      { mbid: 'a', type: 'ARTIST' },
    ]);
    expect(m.get(requestStatusKey('ALBUM', 'a'))).toMatchObject({
      exists: true,
      status: 'PENDING',
      type: 'ALBUM',
    });
    expect(m.get(requestStatusKey('ALBUM', 'b'))).toEqual({ exists: false });
    expect(m.get(requestStatusKey('ARTIST', 'a'))).toEqual({ exists: false });
  });

  it('dedupes inputs and resolves duplicates against the same row', async () => {
    const userId = await makeUser();
    await prisma.musicRequest.create({
      data: { userId, type: 'ALBUM', mbid: 'a', name: 'A', status: 'AVAILABLE' },
    });
    const m = await getRequestStatusBatch(userId, [
      { mbid: 'a', type: 'ALBUM' },
      { mbid: 'a', type: 'ALBUM' },
      { mbid: 'a', type: 'ALBUM' },
    ]);
    // Map only carries one entry per (type,mbid).
    expect(m.size).toBe(1);
    expect(m.get(requestStatusKey('ALBUM', 'a'))).toMatchObject({
      exists: true,
      status: 'AVAILABLE',
    });
  });

  it('returns the single dedup row (schema enforces (userId,mbid,type) uniqueness)', async () => {
    const userId = await makeUser();
    const row = await prisma.musicRequest.create({
      data: {
        userId,
        type: 'ALBUM',
        mbid: 'a',
        name: 'A',
        status: 'PENDING',
        createdAt: new Date('2026-05-12T00:00:00Z'),
      },
    });
    const m = await getRequestStatusBatch(userId, [{ mbid: 'a', type: 'ALBUM' }]);
    const hit = m.get(requestStatusKey('ALBUM', 'a'));
    expect(hit).toMatchObject({
      exists: true,
      id: row.id,
      status: 'PENDING',
    });
  });
});
