import { describe, expect, it } from 'vitest';

import {
  formatBytes,
  formatRelativeTime,
  formatUptime,
} from '../../../src/utils/formatters';

describe('formatRelativeTime', () => {
  const NOW = Date.parse('2026-05-13T12:00:00Z');

  it('returns empty string for null/undefined', () => {
    expect(formatRelativeTime(null, NOW)).toBe('');
    expect(formatRelativeTime(undefined, NOW)).toBe('');
  });

  it('returns empty string for unparseable input', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe('');
    expect(formatRelativeTime(Number.NaN, NOW)).toBe('');
  });

  it('treats a tiny delta as "just now"', () => {
    expect(formatRelativeTime(NOW, NOW)).toBe('just now');
    expect(formatRelativeTime(NOW - 5_000, NOW)).toBe('just now');
    expect(formatRelativeTime(NOW - 29_000, NOW)).toBe('just now');
  });

  it('formats sub-minute deltas in seconds', () => {
    expect(formatRelativeTime(NOW - 30_000, NOW)).toBe('30 seconds ago');
    expect(formatRelativeTime(NOW - 59_000, NOW)).toBe('59 seconds ago');
  });

  it('formats minute deltas', () => {
    expect(formatRelativeTime(NOW - 60_000, NOW)).toBe('1 minute ago');
    expect(formatRelativeTime(NOW - 5 * 60_000, NOW)).toBe('5 minutes ago');
    expect(formatRelativeTime(NOW - 59 * 60_000, NOW)).toBe('59 minutes ago');
  });

  it('formats hour deltas', () => {
    expect(formatRelativeTime(NOW - 60 * 60_000, NOW)).toBe('1 hour ago');
    expect(formatRelativeTime(NOW - 3 * 60 * 60_000, NOW)).toBe('3 hours ago');
  });

  it('renders "yesterday" between 24-48h', () => {
    expect(formatRelativeTime(NOW - 25 * 60 * 60_000, NOW)).toBe('yesterday');
    expect(formatRelativeTime(NOW - 47 * 60 * 60_000, NOW)).toBe('yesterday');
  });

  it('formats day deltas (2-6 days)', () => {
    expect(formatRelativeTime(NOW - 3 * 24 * 60 * 60_000, NOW)).toBe('3 days ago');
    expect(formatRelativeTime(NOW - 6 * 24 * 60 * 60_000, NOW)).toBe('6 days ago');
  });

  it('formats week deltas', () => {
    expect(formatRelativeTime(NOW - 7 * 24 * 60 * 60_000, NOW)).toBe('1 week ago');
    expect(formatRelativeTime(NOW - 21 * 24 * 60 * 60_000, NOW)).toBe('3 weeks ago');
  });

  it('formats month deltas', () => {
    expect(formatRelativeTime(NOW - 60 * 24 * 60 * 60_000, NOW)).toBe('2 months ago');
    expect(formatRelativeTime(NOW - 180 * 24 * 60 * 60_000, NOW)).toBe('6 months ago');
  });

  it('formats year deltas', () => {
    expect(formatRelativeTime(NOW - 365 * 24 * 60 * 60_000, NOW)).toBe('1 year ago');
    expect(formatRelativeTime(NOW - 2 * 365 * 24 * 60 * 60_000, NOW)).toBe(
      '2 years ago'
    );
  });

  it('handles future timestamps with "in X" prefix', () => {
    expect(formatRelativeTime(NOW + 5_000, NOW)).toBe('in a moment');
    expect(formatRelativeTime(NOW + 5 * 60_000, NOW)).toBe('in 5 minutes');
    expect(formatRelativeTime(NOW + 25 * 60 * 60_000, NOW)).toBe('tomorrow');
  });

  it('accepts ISO strings and Date instances', () => {
    expect(formatRelativeTime('2026-05-13T11:00:00Z', NOW)).toBe('1 hour ago');
    expect(formatRelativeTime(new Date(NOW - 60_000), NOW)).toBe('1 minute ago');
  });
});

describe('formatBytes', () => {
  it('returns empty string for null/undefined/NaN/negative', () => {
    expect(formatBytes(null)).toBe('');
    expect(formatBytes(undefined)).toBe('');
    expect(formatBytes(Number.NaN)).toBe('');
    expect(formatBytes(-5)).toBe('');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('');
  });

  it('formats zero bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats whole bytes without decimals', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('formats KB with one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('formats MB', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('formats GB', () => {
    expect(formatBytes(1024 ** 3)).toBe('1.0 GB');
    expect(formatBytes(2.5 * 1024 ** 3)).toBe('2.5 GB');
  });

  it('formats TB', () => {
    expect(formatBytes(1024 ** 4)).toBe('1.0 TB');
    expect(formatBytes(3 * 1024 ** 4)).toBe('3.0 TB');
  });

  it('respects the fractionDigits override', () => {
    expect(formatBytes(1536, 2)).toBe('1.50 KB');
    expect(formatBytes(1536, 0)).toBe('2 KB');
  });
});

describe('formatUptime', () => {
  it('returns empty for null/undefined/NaN/negative', () => {
    expect(formatUptime(null)).toBe('');
    expect(formatUptime(undefined)).toBe('');
    expect(formatUptime(Number.NaN)).toBe('');
    expect(formatUptime(-1)).toBe('');
  });

  it('formats seconds-only uptime', () => {
    expect(formatUptime(0)).toBe('0s');
    expect(formatUptime(42)).toBe('42s');
  });

  it('formats minutes + seconds', () => {
    expect(formatUptime(65)).toBe('1m 5s');
  });

  it('formats hours + minutes', () => {
    expect(formatUptime(3600 + 30 * 60)).toBe('1h 30m');
  });

  it('formats days + hours + minutes', () => {
    expect(formatUptime(2 * 86_400 + 3 * 3_600 + 4 * 60)).toBe('2d 3h 4m');
  });
});
