import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import debounce from 'lodash.debounce';
import clsx from 'clsx';
import {
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { ApiError, swrFetcher } from '../lib/api';
import { useRouteGuard } from '../hooks/useRouteGuard';
import { Input } from '../components/ui/Input';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { AlbumCard } from '../components/Music/AlbumCard';
import { ArtistCard } from '../components/Music/ArtistCard';
import type { SearchResponse } from '../types/api';

type SearchType = 'all' | 'album' | 'artist';

const TYPES: SearchType[] = ['all', 'album', 'artist'];
const TYPE_LABEL: Record<SearchType, string> = {
  all: 'All',
  album: 'Albums',
  artist: 'Artists',
};

const MIN_QUERY_LEN = 2;
const DEBOUNCE_MS = 400;
const RESULT_LIMIT = 24;

function isSearchType(v: unknown): v is SearchType {
  return v === 'all' || v === 'album' || v === 'artist';
}

function ResultGridSkeleton(): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 p-2">
          <Skeleton className="aspect-square w-full" />
          <Skeleton shape="text" className="w-3/4" />
          <Skeleton shape="text" className="w-1/2" />
        </div>
      ))}
    </div>
  );
}

export default function SearchPage(): JSX.Element {
  useRouteGuard({ require: 'auth' });
  const router = useRouter();

  // Initial values from URL.
  const initialQ =
    typeof router.query.q === 'string' ? router.query.q : '';
  const initialType: SearchType = isSearchType(router.query.type)
    ? router.query.type
    : 'all';

  const [inputValue, setInputValue] = useState(initialQ);
  const [debouncedQ, setDebouncedQ] = useState(initialQ);
  const [type, setType] = useState<SearchType>(initialType);

  // Sync from URL when it changes (e.g. via back/forward, or Discover deep links).
  useEffect(() => {
    if (!router.isReady) return;
    const q = typeof router.query.q === 'string' ? router.query.q : '';
    const t: SearchType = isSearchType(router.query.type)
      ? router.query.type
      : 'all';
    setInputValue((cur) => (cur === q ? cur : q));
    setDebouncedQ(q);
    setType(t);
  }, [router.isReady, router.query.q, router.query.type]);

  // Debounce the query that drives both the URL and SWR.
  const debouncerRef = useRef(
    debounce((value: string) => setDebouncedQ(value), DEBOUNCE_MS)
  );
  useEffect(() => {
    const d = debouncerRef.current;
    return () => {
      d.cancel();
    };
  }, []);

  const onInputChange = (value: string) => {
    setInputValue(value);
    debouncerRef.current(value);
  };

  // Push URL state when debounced query / type change. Shallow updates
  // keep the page from re-mounting.
  useEffect(() => {
    if (!router.isReady) return;
    const next: Record<string, string> = {};
    if (debouncedQ) next.q = debouncedQ;
    if (type !== 'all') next.type = type;
    const cur = router.query;
    const sameQ = (cur.q ?? '') === (next.q ?? '');
    const sameType = (cur.type ?? '') === (next.type ?? '');
    if (sameQ && sameType) return;
    void router.replace(
      { pathname: '/search', query: next },
      undefined,
      { shallow: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- router intentionally omitted
  }, [debouncedQ, type, router.isReady]);

  const shouldFetch = debouncedQ.trim().length >= MIN_QUERY_LEN;
  const swrKey = useMemo(() => {
    if (!shouldFetch) return null;
    const params = new URLSearchParams({
      q: debouncedQ.trim(),
      type,
      limit: String(RESULT_LIMIT),
    });
    return `/api/search?${params.toString()}`;
  }, [shouldFetch, debouncedQ, type]);

  const { data, error, isLoading, isValidating } = useSWR<SearchResponse>(
    swrKey,
    swrFetcher,
    { keepPreviousData: true }
  );

  const showAlbums = type === 'all' || type === 'album';
  const showArtists = type === 'all' || type === 'artist';

  const albums = data?.albums ?? [];
  const artists = data?.artists ?? [];

  const totalResults = albums.length + artists.length;
  const queryEmpty = inputValue.trim().length === 0;

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <h1 className="text-2xl font-bold text-[var(--text-primary)] sm:text-3xl">
          Search
        </h1>
        <Input
          aria-label="Search music"
          leftAddon={<MagnifyingGlassIcon className="h-4 w-4" />}
          placeholder="Search albums, artists…"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          autoFocus
        />
        {/* Type segmented control */}
        <div
          role="tablist"
          aria-label="Search type"
          className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-1"
        >
          {TYPES.map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={type === t}
              onClick={() => setType(t)}
              className={clsx(
                'rounded-md px-3 py-1 text-sm font-medium transition',
                type === t
                  ? 'bg-[var(--accent)] text-[var(--accent-contrast)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              )}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        {shouldFetch && isValidating && (
          <p className="text-xs text-[var(--text-muted)]" aria-live="polite">
            Searching…
          </p>
        )}
      </header>

      {/* Empty input */}
      {queryEmpty && (
        <EmptyState
          icon={<MagnifyingGlassIcon className="h-10 w-10" />}
          title="Find music to add to your library"
          description="Search by album or artist name. Click any result to see details and request it."
        />
      )}

      {/* Below min length */}
      {!queryEmpty && !shouldFetch && (
        <p className="text-sm text-[var(--text-muted)]">
          Keep typing… (at least {MIN_QUERY_LEN} characters)
        </p>
      )}

      {/* Loading first time */}
      {shouldFetch && isLoading && !data && <ResultGridSkeleton />}

      {/* Error */}
      {error && (
        <EmptyState
          icon={<ExclamationTriangleIcon className="h-10 w-10" />}
          title="Search failed"
          description={
            error instanceof ApiError
              ? error.message
              : 'Something went wrong while searching.'
          }
        />
      )}

      {/* Results */}
      {shouldFetch && data && !error && (
        <>
          {totalResults === 0 ? (
            <EmptyState
              icon={<MagnifyingGlassIcon className="h-10 w-10" />}
              title={`No results for "${debouncedQ}"`}
              description="Try a different spelling, or switch the type filter."
            />
          ) : (
            <div className="space-y-10">
              {showAlbums && albums.length > 0 && (
                <section className="space-y-4">
                  <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                    Albums
                  </h2>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                    {albums.map((a) => (
                      <AlbumCard
                        key={a.mbid}
                        title={a.title}
                        artist={a.artistName}
                        mbid={a.releaseGroupMbid || a.mbid}
                        coverArtUrl={a.coverArtUrl ?? a.thumbnailUrl}
                        requestStatus={a.requestStatus}
                        inLibrary={a.inLibrary}
                        meta={a.firstReleaseDate?.slice(0, 4)}
                      />
                    ))}
                  </div>
                </section>
              )}
              {showArtists && artists.length > 0 && (
                <section className="space-y-4">
                  <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                    Artists
                  </h2>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                    {artists.map((a) => (
                      <ArtistCard
                        key={a.mbid}
                        name={a.name}
                        mbid={a.mbid}
                        requestStatus={a.requestStatus}
                        inLibrary={a.inLibrary}
                        meta={a.disambiguation || a.country}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
