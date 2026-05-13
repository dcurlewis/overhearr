import { useCallback, useState } from 'react';
import { useSWRConfig } from 'swr';
import { ApiError, apiPost } from '../lib/api';
import { useToast } from '../components/ui/Toast';
import type { MusicRequestRow } from '../types/api';

export interface UseRequestActionResult {
  /** Whether a POST is currently in flight (use to disable buttons). */
  inFlight: boolean;
  /** Request a single album by mbid. Resolves to the row on success. */
  requestAlbum: (mbid: string) => Promise<MusicRequestRow | null>;
  /** Request an entire artist (and discography) by mbid. */
  requestArtist: (mbid: string) => Promise<MusicRequestRow | null>;
  /** Retry an existing request by id. */
  retry: (requestId: number) => Promise<MusicRequestRow | null>;
}

export interface UseRequestActionOptions {
  /**
   * SWR keys to revalidate after a successful (or even failed-with-row)
   * mutation. The album / artist detail pages pass their primary key here so
   * the new request status is reflected without a manual refresh.
   */
  revalidateKeys?: string[];
}

/**
 * Centralises the album/artist/retry POSTs that every browse surface needs.
 *
 * Toasts:
 *   - success → "Request added"
 *   - 409/idempotent → still success (the row is unchanged but we tell the
 *     user it's already in flight)
 *   - any other error → error toast with the API message
 *
 * On success we also revalidate the user's request list cache key
 * (`/api/requests`) so the Requests page is fresh next time it's visited.
 */
export function useRequestAction(
  options: UseRequestActionOptions = {}
): UseRequestActionResult {
  const { revalidateKeys = [] } = options;
  const toast = useToast();
  const { mutate } = useSWRConfig();
  const [inFlight, setInFlight] = useState(false);

  const refresh = useCallback(async () => {
    const keys = new Set<string>(revalidateKeys);
    // Also revalidate any list views that might be open elsewhere.
    await Promise.all(
      Array.from(keys).map((k) => mutate(k))
    );
    // Match prefix-based keys for /api/requests via filter mutate.
    await mutate(
      (key) => typeof key === 'string' && key.startsWith('/api/requests'),
      undefined,
      { revalidate: true }
    );
  }, [mutate, revalidateKeys]);

  const handle = useCallback(
    async (
      url: string,
      body: Record<string, unknown> | undefined,
      successMessage: string
    ): Promise<MusicRequestRow | null> => {
      setInFlight(true);
      try {
        const row = await apiPost<MusicRequestRow>(url, body);
        toast.success(successMessage);
        await refresh();
        return row;
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Request failed';
        toast.error(message);
        // Even when the POST fails, the server row may have been written
        // (e.g. Lidarr unreachable → row is FAILED). Revalidate so the UI
        // reflects that.
        await refresh();
        return null;
      } finally {
        setInFlight(false);
      }
    },
    [refresh, toast]
  );

  const requestAlbum = useCallback(
    (mbid: string) =>
      handle('/api/requests/album', { mbid }, 'Album requested'),
    [handle]
  );

  const requestArtist = useCallback(
    (mbid: string) =>
      handle('/api/requests/artist', { mbid }, 'Artist requested'),
    [handle]
  );

  const retry = useCallback(
    (requestId: number) =>
      handle(`/api/requests/${requestId}/retry`, undefined, 'Retrying request'),
    [handle]
  );

  return { inFlight, requestAlbum, requestArtist, retry };
}

export default useRequestAction;
