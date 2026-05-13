/**
 * Unit tests for `useRequestAction`. Mocks `apiPost` and the toast +
 * SWR mutate hooks so we can exercise the hook's branching without a
 * full DOM render.
 *
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type * as ApiModule from '../../../src/lib/api';
import type * as SwrModule from 'swr';

vi.mock('../../../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>(
    '../../../src/lib/api'
  );
  return {
    ...actual,
    apiPost: vi.fn(),
  };
});

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};
vi.mock('../../../src/components/ui/Toast', () => ({
  useToast: () => mockToast,
}));

const mockMutate = vi.fn().mockResolvedValue(undefined);
vi.mock('swr', async () => {
  const actual = await vi.importActual<typeof SwrModule>('swr');
  return {
    ...actual,
    useSWRConfig: () => ({ mutate: mockMutate }),
  };
});

import { ApiError, apiPost } from '../../../src/lib/api';
import { useRequestAction } from '../../../src/hooks/useRequestAction';

const apiPostMock = apiPost as unknown as ReturnType<typeof vi.fn>;

const makeRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  userId: 1,
  type: 'ALBUM',
  mbid: 'abc',
  name: 'Album',
  artistName: 'Artist',
  coverArtUrl: null,
  releaseDate: null,
  status: 'PENDING',
  lidarrAlbumId: null,
  lidarrArtistId: null,
  errorMessage: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('useRequestAction', () => {
  beforeEach(() => {
    apiPostMock.mockReset();
    mockMutate.mockClear();
    mockToast.success.mockClear();
    mockToast.error.mockClear();
    mockToast.info.mockClear();
    mockToast.warning.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('requestAlbum POSTs to /api/requests/album with mbid and toasts success', async () => {
    apiPostMock.mockResolvedValueOnce(makeRow());
    const { result } = renderHook(() =>
      useRequestAction({ revalidateKeys: ['/api/album/abc'] })
    );

    let row: unknown;
    await act(async () => {
      row = await result.current.requestAlbum('abc');
    });

    expect(apiPostMock).toHaveBeenCalledWith('/api/requests/album', {
      mbid: 'abc',
    });
    expect(mockToast.success).toHaveBeenCalledWith('Album requested');
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(row).toMatchObject({ id: 1 });
    // Revalidate the explicit key + the prefix-based /api/requests filter.
    expect(mockMutate).toHaveBeenCalledWith('/api/album/abc');
    expect(mockMutate).toHaveBeenCalledWith(
      expect.any(Function),
      undefined,
      { revalidate: true }
    );
  });

  it('requestArtist POSTs to /api/requests/artist with mbid', async () => {
    apiPostMock.mockResolvedValueOnce(makeRow({ type: 'ARTIST' }));
    const { result } = renderHook(() => useRequestAction());

    await act(async () => {
      await result.current.requestArtist('artist-mbid');
    });

    expect(apiPostMock).toHaveBeenCalledWith('/api/requests/artist', {
      mbid: 'artist-mbid',
    });
    expect(mockToast.success).toHaveBeenCalledWith('Artist requested');
  });

  it('retry POSTs to /api/requests/:id/retry without a body', async () => {
    apiPostMock.mockResolvedValueOnce(makeRow({ id: 42, status: 'PENDING' }));
    const { result } = renderHook(() => useRequestAction());

    await act(async () => {
      await result.current.retry(42);
    });

    expect(apiPostMock).toHaveBeenCalledWith(
      '/api/requests/42/retry',
      undefined
    );
    expect(mockToast.success).toHaveBeenCalledWith('Retrying request');
  });

  it('shows an error toast and resolves to null when the POST throws', async () => {
    apiPostMock.mockRejectedValueOnce(
      new ApiError(503, 'Lidarr unreachable', 'LIDARR_DOWN')
    );
    const { result } = renderHook(() => useRequestAction());

    let row: unknown = 'unset';
    await act(async () => {
      row = await result.current.requestAlbum('abc');
    });

    expect(row).toBeNull();
    expect(mockToast.error).toHaveBeenCalledWith('Lidarr unreachable');
    expect(mockToast.success).not.toHaveBeenCalled();
    // Even on failure we still revalidate so the UI reflects the
    // server-side row state (which may be FAILED).
    expect(mockMutate).toHaveBeenCalled();
  });

  it('flips inFlight while a POST is pending', async () => {
    let resolveFn: (v: unknown) => void = () => undefined;
    apiPostMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        })
    );
    const { result } = renderHook(() => useRequestAction());

    expect(result.current.inFlight).toBe(false);

    let pending: Promise<unknown>;
    act(() => {
      pending = result.current.requestAlbum('abc');
    });
    // After kicking off, inFlight should be true.
    expect(result.current.inFlight).toBe(true);

    await act(async () => {
      resolveFn(makeRow());
      await pending!;
    });

    expect(result.current.inFlight).toBe(false);
  });
});
