/**
 * Application error hierarchy. Thrown errors that extend AppError are mapped
 * to JSON responses by the central error handler middleware. Anything else is
 * treated as an unexpected internal error.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super(message, 409, 'CONFLICT');
  }
}

/**
 * MusicBrainz client errors. These are thrown by the MusicBrainz client and
 * Cover Art Archive helpers; route handlers can either let them propagate
 * (the central error handler will translate them) or catch and substitute a
 * domain-specific response.
 */
export class MusicBrainzNotFoundError extends AppError {
  constructor(message = 'MusicBrainz resource not found') {
    super(message, 404, 'MB_NOT_FOUND');
  }
}

/**
 * Thrown when MusicBrainz returns 503 (rate limit). Callers should retry
 * with backoff; the rate-limit queue inside the client already enforces the
 * 1 req/sec policy, but bursts from cold caches can still hit the upstream.
 */
export class MusicBrainzRateLimitedError extends AppError {
  constructor(message = 'MusicBrainz rate limited') {
    super(message, 503, 'MB_RATE_LIMITED');
  }
}

export class MusicBrainzUnreachableError extends AppError {
  constructor(message = 'MusicBrainz is unreachable') {
    super(message, 502, 'MB_UNREACHABLE');
  }
}

/**
 * Lidarr client errors. Phase 4b's request flow inspects these specific
 * subclasses to decide whether to fail soft (metadata down → "try later"),
 * hard-fail the request (auth, not-found), or reconcile (already-exists).
 *
 * All errors map to 4xx/5xx responses through the central error handler if
 * they propagate. Routes that want a different shape (e.g. settings test
 * connection returning 200 + ok:false) catch them explicitly.
 */
export class LidarrUnreachableError extends AppError {
  constructor(message = 'Lidarr is unreachable') {
    super(message, 502, 'LIDARR_UNREACHABLE');
  }
}

export class LidarrAuthError extends AppError {
  constructor(message = 'Lidarr rejected the API key') {
    super(message, 502, 'LIDARR_AUTH');
  }
}

/**
 * Thrown when Lidarr returns a 200 with an error-shaped body (e.g.
 * `{message: "Failed to query MusicBrainz..."}`) — meaning Lidarr's
 * upstream metadata server (skyhook) is having trouble. Very common in
 * production. Phase 4b request flow uses this to fail soft and prompt the
 * user to retry.
 */
export class LidarrMetadataUnavailableError extends AppError {
  constructor(message = 'Lidarr metadata server is currently unavailable') {
    super(message, 502, 'LIDARR_METADATA_UNAVAILABLE');
  }
}

export class LidarrAlbumNotFoundError extends AppError {
  constructor(message = 'Album not found in Lidarr') {
    super(message, 404, 'LIDARR_ALBUM_NOT_FOUND');
  }
}

export class LidarrArtistNotFoundError extends AppError {
  constructor(message = 'Artist not found in Lidarr') {
    super(message, 404, 'LIDARR_ARTIST_NOT_FOUND');
  }
}

export class LidarrAlreadyExistsError extends AppError {
  constructor(message = 'Already exists in Lidarr') {
    super(message, 409, 'LIDARR_ALREADY_EXISTS');
  }
}

export class LidarrError extends AppError {
  constructor(message = 'Lidarr returned an error') {
    super(message, 502, 'LIDARR_ERROR');
  }
}

/**
 * Thrown by the request flow when Lidarr is not configured. Maps to a 503
 * because the install is reachable but the upstream dependency required to
 * service the request has not been wired up yet.
 */
export class LidarrNotConfiguredError extends AppError {
  constructor(message = 'Lidarr is not configured') {
    super(message, 503, 'LIDARR_NOT_CONFIGURED');
  }
}

/**
 * Lightweight subclass of NotFoundError so request-flow code can throw a
 * domain-specific 404 without hand-coding the message at every callsite.
 */
export class RequestNotFoundError extends NotFoundError {
  constructor(message = 'Request not found') {
    super(message);
  }
}
