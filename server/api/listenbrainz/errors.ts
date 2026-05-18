/**
 * ListenBrainz-specific error subclasses. ListenBrainz sitewide stats are
 * anonymous (no API key required), so unlike the old Last.fm client there is
 * no `NotConfigured` state — only "upstream is having a moment".
 */

import { AppError } from '../../lib/errors';

export class ListenBrainzUnreachableError extends AppError {
  constructor(message = 'ListenBrainz is unreachable') {
    super(message, 502, 'LISTENBRAINZ_UNREACHABLE');
  }
}
