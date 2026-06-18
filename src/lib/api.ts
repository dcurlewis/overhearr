/**
 * Typed fetch wrapper for the Overhearr backend.
 *
 * - Always sends cookies (`credentials: 'include'`).
 * - Adds `X-Overhearr-CSRF: 1` on mutating verbs.
 * - JSON request/response handling.
 * - Throws `ApiError` on non-2xx so callers (and SWR) get structured error
 *   info: `status`, `code`, `message`.
 */

export interface ApiErrorBody {
  message?: string;
  code?: string;
  /** The API error handler nests details here: `{ error: { code, message } }`. */
  error?: { code?: string; message?: string };
  [key: string]: unknown;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly body?: ApiErrorBody;

  constructor(status: number, message: string, code?: string, body?: ApiErrorBody) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

type JsonBody = Record<string, unknown> | unknown[] | undefined | null;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: JsonBody;
  signal?: AbortSignal;
}

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204 || res.status === 205) return null;
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    // Some endpoints may return empty body or text; surface it raw.
    const text = await res.text();
    return text ? text : null;
  }
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (opts.body !== undefined && opts.body !== null) {
    headers['Content-Type'] = 'application/json';
  }
  if (MUTATING.has(method)) {
    headers['X-Overhearr-CSRF'] = '1';
  }

  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'include',
      body:
        opts.body !== undefined && opts.body !== null
          ? JSON.stringify(opts.body)
          : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    // Network-level failure (DNS, offline, aborted, etc.).
    const message = err instanceof Error ? err.message : 'Network error';
    throw new ApiError(0, message, 'NETWORK_ERROR');
  }

  const body = await parseBody(res);

  if (!res.ok) {
    const errBody = (body && typeof body === 'object' ? (body as ApiErrorBody) : undefined);
    // The API error handler wraps details under a nested `error` object
    // (`{ error: { code, message } }`); fall back to top-level fields for any
    // flat payloads, then to a generic message.
    const nested = errBody?.error;
    const message =
      typeof nested?.message === 'string'
        ? nested.message
        : typeof errBody?.message === 'string'
          ? errBody.message
          : `Request failed with status ${res.status}`;
    const code =
      typeof nested?.code === 'string'
        ? nested.code
        : typeof errBody?.code === 'string'
          ? errBody.code
          : undefined;
    throw new ApiError(res.status, message, code, errBody);
  }

  return body as T;
}

export const apiGet = <T>(path: string, signal?: AbortSignal): Promise<T> =>
  request<T>(path, { method: 'GET', signal });

export const apiPost = <T>(path: string, body?: JsonBody): Promise<T> =>
  request<T>(path, { method: 'POST', body });

export const apiPatch = <T>(path: string, body?: JsonBody): Promise<T> =>
  request<T>(path, { method: 'PATCH', body });

export const apiDelete = <T>(path: string): Promise<T> =>
  request<T>(path, { method: 'DELETE' });

/**
 * SWR fetcher. Returns parsed JSON, throws ApiError on failure so SWR's
 * `error` field is structured.
 */
export const swrFetcher = <T>(path: string): Promise<T> => apiGet<T>(path);
