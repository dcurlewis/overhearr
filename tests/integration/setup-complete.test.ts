/**
 * Direct exercise of `requireSetupComplete` middleware. We mount a tiny
 * route through buildApp's machinery so the middleware uses the real
 * Prisma + Settings table.
 */
import express from 'express';
import supertest from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { errorHandler } from '../../server/middleware/errorHandler';
import { requireSetupComplete } from '../../server/middleware/auth';
import { prisma } from '../../server/db/prisma';

async function clearDb(): Promise<void> {
  await prisma.musicRequest.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
  await prisma.settings.deleteMany();
}

function tinyApp(): express.Express {
  const app = express();
  app.get('/protected', requireSetupComplete, (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
}

describe('requireSetupComplete', () => {
  beforeEach(async () => {
    await clearDb();
  });

  afterEach(async () => {
    await clearDb();
  });

  it('returns 409 SETUP_INCOMPLETE when no Settings row exists', async () => {
    const res = await supertest(tinyApp()).get('/protected');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SETUP_INCOMPLETE');
  });

  it('returns 409 SETUP_INCOMPLETE when setupCompleted=false', async () => {
    await prisma.settings.upsert({
      where: { id: 1 },
      update: { setupCompleted: false },
      create: { id: 1, setupCompleted: false },
    });
    const res = await supertest(tinyApp()).get('/protected');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SETUP_INCOMPLETE');
  });

  it('passes through when setupCompleted=true', async () => {
    await prisma.settings.upsert({
      where: { id: 1 },
      update: { setupCompleted: true },
      create: { id: 1, setupCompleted: true },
    });
    const res = await supertest(tinyApp()).get('/protected');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
