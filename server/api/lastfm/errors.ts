/**
 * Last.fm-specific error subclasses.
 *
 * These are intentionally defined locally (rather than in `server/lib/errors.ts`)
 * so Phase 3a (MusicBrainz client) and Phase 3c (this file) can land in
 * parallel without racing on the shared error module. The central error
 * handler maps any subclass of `AppError` based on its `statusCode` / `code`,
 * so the wire format is identical regardless of where the class is declared.
 *
 * - `LastfmNotConfiguredError` (503) — no API key in settings. The frontend
 *   distinguishes this from a real upstream failure and renders a "Configure
 *   in Settings" empty state for the Discover page.
 * - `LastfmInvalidKeyError` (502) — Last.fm responded with `{error: 10}`.
 *   The key is set but rejected; admin needs to update it.
 * - `LastfmUnreachableError` (502) — generic upstream failure (network /
 *   timeout / non-10 Last.fm error code).
 */

import { AppError } from '../../lib/errors';

export class LastfmNotConfiguredError extends AppError {
  constructor(message = 'Last.fm API key is not configured') {
    super(message, 503, 'LASTFM_NOT_CONFIGURED');
  }
}

export class LastfmUnreachableError extends AppError {
  constructor(message = 'Last.fm is unreachable') {
    super(message, 502, 'LASTFM_UNREACHABLE');
  }
}

export class LastfmInvalidKeyError extends AppError {
  constructor(message = 'Last.fm API key is invalid') {
    super(message, 502, 'LASTFM_INVALID_KEY');
  }
}

// Convenience re-export so callers can `import { AppError } from '../api/lastfm/errors'`
// without reaching across module boundaries; not load-bearing for tests but
// keeps the import surface tidy.
export { AppError } from '../../lib/errors';
