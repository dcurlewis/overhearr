import { describe, expect, it } from 'vitest';

import { RateLimitQueue } from '../../server/lib/rateLimitQueue';

describe('RateLimitQueue', () => {
  it('runs the first task immediately', async () => {
    const q = new RateLimitQueue({ minIntervalMs: 100 });
    const start = Date.now();
    await q.enqueue(async () => 'ok');
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50);
  });

  it('enforces minIntervalMs between consecutive tasks', async () => {
    const interval = 60;
    const q = new RateLimitQueue({ minIntervalMs: interval });
    const starts: number[] = [];
    const t0 = Date.now();
    await Promise.all([
      q.enqueue(async () => {
        starts.push(Date.now() - t0);
      }),
      q.enqueue(async () => {
        starts.push(Date.now() - t0);
      }),
      q.enqueue(async () => {
        starts.push(Date.now() - t0);
      }),
    ]);
    expect(starts).toHaveLength(3);
    // Allow a small fudge factor for timer drift.
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(interval - 10);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(interval - 10);
  });

  it('preserves FIFO order even with mixed task durations', async () => {
    const q = new RateLimitQueue({ minIntervalMs: 10 });
    const order: number[] = [];
    const tasks = [0, 1, 2, 3, 4].map((i) =>
      q.enqueue(async () => {
        // Varied durations; queue should still process in enqueue order.
        await new Promise((r) => setTimeout(r, (5 - i) * 5));
        order.push(i);
      })
    );
    await Promise.all(tasks);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it('propagates rejections without breaking the queue', async () => {
    const q = new RateLimitQueue({ minIntervalMs: 5 });
    const a = q.enqueue(async () => 1);
    const b = q.enqueue(async () => {
      throw new Error('boom');
    });
    const c = q.enqueue(async () => 3);

    await expect(a).resolves.toBe(1);
    await expect(b).rejects.toThrow('boom');
    await expect(c).resolves.toBe(3);
  });

  it('handles a concurrency burst correctly', async () => {
    const q = new RateLimitQueue({ minIntervalMs: 20 });
    let inflight = 0;
    let maxInflight = 0;
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        q.enqueue(async () => {
          inflight += 1;
          maxInflight = Math.max(maxInflight, inflight);
          await new Promise((r) => setTimeout(r, 10));
          inflight -= 1;
          return i;
        })
      )
    );
    expect(results).toEqual([0, 1, 2, 3, 4, 5]);
    expect(maxInflight).toBe(1);
  });

  it('applies jitter without violating min interval', async () => {
    const q = new RateLimitQueue({ minIntervalMs: 30, jitterMs: 20 });
    const t0 = Date.now();
    const starts: number[] = [];
    await Promise.all([
      q.enqueue(async () => {
        starts.push(Date.now() - t0);
      }),
      q.enqueue(async () => {
        starts.push(Date.now() - t0);
      }),
    ]);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(20);
  });

  it('rejects negative minIntervalMs', () => {
    expect(() => new RateLimitQueue({ minIntervalMs: -1 })).toThrow();
  });
});
