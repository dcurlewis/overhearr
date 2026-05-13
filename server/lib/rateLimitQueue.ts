/**
 * RateLimitQueue
 *
 * A tiny FIFO async queue that ensures consecutive task starts are spaced by
 * at least `minIntervalMs` (plus optional random jitter). Designed to comply
 * with MusicBrainz's 1 req/sec policy without blocking the event loop or
 * silently dropping requests.
 *
 * Semantics:
 *   - Tasks run one at a time, in the order `enqueue` was called.
 *   - The next task starts no sooner than `lastStartedAt + minIntervalMs +
 *     random(0, jitterMs)`. The first task runs immediately.
 *   - If a task throws or rejects, the failure propagates to its caller and
 *     the queue continues with the next task.
 */

export interface RateLimitQueueOptions {
  minIntervalMs: number;
  jitterMs?: number;
}

interface QueuedTask<T = unknown> {
  fn: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

export class RateLimitQueue {
  private readonly minIntervalMs: number;
  private readonly jitterMs: number;
  private readonly queue: QueuedTask[] = [];
  private running = false;
  private lastStartedAt = 0;

  constructor(opts: RateLimitQueueOptions) {
    if (opts.minIntervalMs < 0) {
      throw new Error('minIntervalMs must be >= 0');
    }
    this.minIntervalMs = opts.minIntervalMs;
    this.jitterMs = opts.jitterMs ?? 0;
  }

  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        fn: fn as () => Promise<unknown>,
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      while (this.queue.length > 0) {
        const task = this.queue.shift();
        if (!task) break;

        const wait = this.computeWait();
        if (wait > 0) {
          await sleep(wait);
        }

        this.lastStartedAt = Date.now();
        try {
          const result = await task.fn();
          task.resolve(result);
        } catch (err) {
          task.reject(err);
        }
      }
    } finally {
      this.running = false;
    }
  }

  private computeWait(): number {
    if (this.lastStartedAt === 0) return 0;
    const jitter = this.jitterMs > 0 ? Math.random() * this.jitterMs : 0;
    const earliest = this.lastStartedAt + this.minIntervalMs + jitter;
    return Math.max(0, earliest - Date.now());
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
