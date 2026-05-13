import session from 'express-session';

import { prisma } from '../db/prisma';

const ONE_HOUR_MS = 60 * 60 * 1000;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

type Callback<T = void> = (err?: unknown, value?: T) => void;

interface SessionWithUserId extends session.SessionData {
  userId?: number;
}

function computeExpiresAt(sess: session.SessionData): Date {
  const cookieExpires = sess.cookie?.expires;
  if (cookieExpires) {
    return cookieExpires instanceof Date ? cookieExpires : new Date(cookieExpires);
  }
  const maxAge = sess.cookie?.maxAge;
  return new Date(Date.now() + (typeof maxAge === 'number' ? maxAge : DEFAULT_TTL_MS));
}

export class PrismaSessionStore extends session.Store {
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(cleanupIntervalMs = ONE_HOUR_MS) {
    super();
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired().catch((err) => this.emit('error', err));
    }, cleanupIntervalMs);
    if (typeof this.cleanupTimer.unref === 'function') this.cleanupTimer.unref();
  }

  async cleanupExpired(): Promise<void> {
    await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }

  stopCleanup(): void {
    clearInterval(this.cleanupTimer);
  }

  get(sid: string, cb: Callback<session.SessionData | null>): void {
    prisma.session
      .findUnique({ where: { id: sid } })
      .then((row) => {
        if (!row) return cb(null, null);
        if (row.expiresAt.getTime() < Date.now()) {
          prisma.session.delete({ where: { id: sid } }).catch(() => undefined);
          return cb(null, null);
        }
        try {
          const data = JSON.parse(row.data) as session.SessionData;
          cb(null, data);
        } catch (err) {
          cb(err);
        }
      })
      .catch((err) => cb(err));
  }

  set(sid: string, sess: session.SessionData, cb?: Callback): void {
    const expiresAt = computeExpiresAt(sess);
    const userId = (sess as SessionWithUserId).userId ?? null;
    const data = JSON.stringify(sess);
    prisma.session
      .upsert({
        where: { id: sid },
        create: { id: sid, userId, expiresAt, data },
        update: { userId, expiresAt, data },
      })
      .then(() => cb?.())
      .catch((err) => cb?.(err));
  }

  destroy(sid: string, cb?: Callback): void {
    prisma.session
      .delete({ where: { id: sid } })
      .then(() => cb?.())
      .catch((err) => {
        // P2025: record not found — treat as success
        if ((err as { code?: string })?.code === 'P2025') return cb?.();
        cb?.(err);
      });
  }

  touch(sid: string, sess: session.SessionData, cb?: Callback): void {
    const expiresAt = computeExpiresAt(sess);
    prisma.session
      .update({ where: { id: sid }, data: { expiresAt } })
      .then(() => cb?.())
      .catch((err) => {
        if ((err as { code?: string })?.code === 'P2025') return cb?.();
        cb?.(err);
      });
  }

  length(cb: Callback<number>): void {
    prisma.session
      .count()
      .then((count) => cb(null, count))
      .catch((err) => cb(err));
  }

  clear(cb?: Callback): void {
    prisma.session
      .deleteMany({})
      .then(() => cb?.())
      .catch((err) => cb?.(err));
  }
}

export default PrismaSessionStore;
