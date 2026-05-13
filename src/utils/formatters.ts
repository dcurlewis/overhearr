/**
 * Pure formatting helpers used by Phase 5d's transactional pages.
 *
 * Kept dependency-free: a tiny humanizer for relative timestamps + a
 * binary-units (KiB/MiB/GiB/TiB) byte formatter for Lidarr root-folder free
 * space. Both functions are total — they never throw.
 */

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
// Approximations are fine here — these are display helpers, not accounting.
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * Format a timestamp as a coarse human-readable relative string.
 *
 * Examples (assuming `now` is the second argument or `Date.now()`):
 *   - <30s         -> "just now"
 *   - <60s         -> "30 seconds ago"
 *   - <60m         -> "5 minutes ago"
 *   - <24h         -> "3 hours ago"
 *   - <48h         -> "yesterday"
 *   - <7d          -> "3 days ago"
 *   - <30d         -> "2 weeks ago"
 *   - <365d        -> "5 months ago"
 *   - >=365d       -> "2 years ago"
 *
 * Future timestamps (input > now) are mirrored: "in 5 minutes", etc.
 * Invalid input returns an empty string.
 */
export function formatRelativeTime(
  input: string | number | Date | null | undefined,
  now: number = Date.now()
): string {
  if (input === null || input === undefined) return '';
  const ts =
    input instanceof Date
      ? input.getTime()
      : typeof input === 'number'
        ? input
        : Date.parse(input);
  if (!Number.isFinite(ts)) return '';

  const diffMs = now - ts;
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);

  let phrase: string;
  if (abs < 30 * SECOND) {
    return future ? 'in a moment' : 'just now';
  } else if (abs < MINUTE) {
    const n = Math.round(abs / SECOND);
    phrase = `${n} second${n === 1 ? '' : 's'}`;
  } else if (abs < HOUR) {
    const n = Math.round(abs / MINUTE);
    phrase = `${n} minute${n === 1 ? '' : 's'}`;
  } else if (abs < DAY) {
    const n = Math.round(abs / HOUR);
    phrase = `${n} hour${n === 1 ? '' : 's'}`;
  } else if (abs < 2 * DAY) {
    return future ? 'tomorrow' : 'yesterday';
  } else if (abs < WEEK) {
    const n = Math.round(abs / DAY);
    phrase = `${n} day${n === 1 ? '' : 's'}`;
  } else if (abs < MONTH) {
    const n = Math.round(abs / WEEK);
    phrase = `${n} week${n === 1 ? '' : 's'}`;
  } else if (abs < YEAR) {
    const n = Math.round(abs / MONTH);
    phrase = `${n} month${n === 1 ? '' : 's'}`;
  } else {
    const n = Math.round(abs / YEAR);
    phrase = `${n} year${n === 1 ? '' : 's'}`;
  }

  return future ? `in ${phrase}` : `${phrase} ago`;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/**
 * Format a byte count as a human-readable string using binary (1024) steps
 * but SI-style suffixes (the convention most file managers and Lidarr's UI
 * use). 1 decimal place once we leave plain bytes.
 *
 * `null`, `undefined`, NaN, and negatives produce an empty string so callers
 * can fall back to a placeholder ("—") without juggling falsy values.
 */
export function formatBytes(
  bytes: number | null | undefined,
  fractionDigits = 1
): string {
  if (bytes === null || bytes === undefined) return '';
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1) return '0 B';
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < BYTE_UNITS.length - 1) {
    value /= 1024;
    i += 1;
  }
  const decimals = i === 0 ? 0 : fractionDigits;
  return `${value.toFixed(decimals)} ${BYTE_UNITS[i]}`;
}

/**
 * Format an uptime in seconds as a compact "1d 2h 3m" / "5h 10m" / "42s"
 * string for the System health card. Always omits leading zero units.
 */
export function formatUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '';
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
