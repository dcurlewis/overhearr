import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  request,
  swrFetcher,
} from '../../../src/lib/api';

type FetchMock = ReturnType<typeof vi.fn>;

function makeResponse(
  status: number,
  body: unknown,
  contentType = 'application/json'
): Response {
  const headers = new Headers();
  if (contentType) headers.set('content-type', contentType);
  // Per Fetch spec, 204/205/304 must not carry a body. The Response
  // constructor enforces that, so pass `null` for those statuses.
  const isNullBodyStatus = status === 204 || status === 205 || status === 304;
  const text = isNullBodyStatus || body === null || body === undefined
    ? null
    : JSON.stringify(body);
  return new Response(text, { status, headers });
}

describe('lib/api', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('apiGet returns parsed JSON for a 200', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(200, { ok: true, value: 42 }));
    const res = await apiGet<{ ok: boolean; value: number }>('/api/x');
    expect(res).toEqual({ ok: true, value: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
    // GET should NOT carry the CSRF header.
    expect(init.headers['X-Overhearr-CSRF']).toBeUndefined();
  });

  it('apiPost adds X-Overhearr-CSRF + JSON content type', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(200, { id: 1 }));
    await apiPost('/api/x', { foo: 'bar' });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe('POST');
    expect(init.headers['X-Overhearr-CSRF']).toBe('1');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ foo: 'bar' }));
  });

  it('apiPatch and apiDelete also carry the CSRF header', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(204, null, ''));
    await apiPatch('/api/x', { a: 1 });
    expect(fetchMock.mock.calls[0]![1].headers['X-Overhearr-CSRF']).toBe('1');

    fetchMock.mockResolvedValueOnce(makeResponse(204, null, ''));
    await apiDelete('/api/x');
    expect(fetchMock.mock.calls[1]![1].headers['X-Overhearr-CSRF']).toBe('1');
    expect(fetchMock.mock.calls[1]![1].method).toBe('DELETE');
  });

  it('returns null body for 204 No Content', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(204, null, ''));
    const res = await apiDelete<null>('/api/x');
    expect(res).toBeNull();
  });

  it('throws ApiError with code + message from JSON error body', async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse(409, { code: 'SETUP_INCOMPLETE', message: 'Setup incomplete' })
    );
    await expect(apiGet('/api/x')).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'SETUP_INCOMPLETE',
      message: 'Setup incomplete',
    });
  });

  it('throws ApiError with default message when body has no message field', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(500, { foo: 'bar' }));
    try {
      await apiGet('/api/x');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(500);
      expect((err as ApiError).code).toBeUndefined();
      expect((err as ApiError).message).toMatch(/500/);
    }
  });

  it('handles non-JSON error bodies gracefully', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(502, 'Bad Gateway', 'text/plain'));
    try {
      await apiGet('/api/x');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(502);
    }
  });

  it('wraps network failures as ApiError(0, NETWORK_ERROR)', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    try {
      await apiGet('/api/x');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(0);
      expect((err as ApiError).code).toBe('NETWORK_ERROR');
    }
  });

  it('does not set Content-Type when no body is provided', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(200, { ok: true }));
    await apiPost('/api/x');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it('forwards an AbortSignal to fetch', async () => {
    const ctrl = new AbortController();
    fetchMock.mockResolvedValueOnce(makeResponse(200, {}));
    await request('/api/x', { method: 'GET', signal: ctrl.signal });
    expect(fetchMock.mock.calls[0]![1].signal).toBe(ctrl.signal);
  });

  it('swrFetcher delegates to apiGet', async () => {
    fetchMock.mockResolvedValueOnce(makeResponse(200, { hi: 1 }));
    const res = await swrFetcher<{ hi: number }>('/api/x');
    expect(res).toEqual({ hi: 1 });
  });

  it('handles empty/null body even when content-type is JSON', async () => {
    const headers = new Headers({ 'content-type': 'application/json' });
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200, headers }));
    const res = await apiGet<unknown>('/api/x');
    expect(res).toBeNull();
  });
});
