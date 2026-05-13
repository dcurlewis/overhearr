import React from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  ExclamationTriangleIcon,
  RadioIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import { ApiError, swrFetcher } from '../lib/api';
import { useRouteGuard } from '../hooks/useRouteGuard';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { AlbumCard } from '../components/Music/AlbumCard';
import { ArtistCard } from '../components/Music/ArtistCard';
import type {
  DiscoverPayload,
  LastfmAlbumWithStatus,
  LastfmArtistWithStatus,
} from '../types/api';

const DISCOVER_KEY = '/api/discover';
const ROW_LIMIT = 24;

function RowSkeleton(): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 p-2">
          <Skeleton className="aspect-square w-full" />
          <Skeleton shape="text" className="w-3/4" />
          <Skeleton shape="text" className="w-1/2" />
        </div>
      ))}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <h2 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
      {children}
    </h2>
  );
}

function AlbumRow({
  items,
}: {
  items: LastfmAlbumWithStatus[];
}): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {items.slice(0, ROW_LIMIT).map((it, idx) => (
        <AlbumCard
          key={`${it.mbid ?? 'na'}-${it.name}-${idx}`}
          title={it.name}
          artist={it.artist}
          mbid={it.mbid}
          coverArtUrl={it.imageUrl}
          requestStatus={it.requestStatus}
        />
      ))}
    </div>
  );
}

function ArtistRow({
  items,
}: {
  items: LastfmArtistWithStatus[];
}): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {items.slice(0, ROW_LIMIT).map((it, idx) => (
        <ArtistCard
          key={`${it.mbid ?? 'na'}-${it.name}-${idx}`}
          name={it.name}
          mbid={it.mbid}
          imageUrl={it.imageUrl}
          requestStatus={it.requestStatus}
        />
      ))}
    </div>
  );
}

export default function DiscoverPage(): JSX.Element {
  const { user } = useRouteGuard({ require: 'auth' });
  const { data, error, isLoading, mutate } = useSWR<DiscoverPayload>(
    DISCOVER_KEY,
    swrFetcher
  );

  const isLastfmUnreachable =
    error instanceof ApiError &&
    typeof error.message === 'string' &&
    /last\.?fm.*unreachable/i.test(error.message);

  return (
    <div className="space-y-10">
      {/* Hero */}
      <header className="rounded-2xl border border-[var(--border)] bg-gradient-to-br from-indigo-500/10 via-[var(--bg-elevated)] to-[var(--bg-elevated)] px-6 py-10 sm:px-10">
        <div className="flex items-center gap-3">
          <SparklesIcon className="h-6 w-6 text-indigo-400" />
          <span className="text-xs uppercase tracking-widest text-[var(--text-muted)]">
            Discover
          </span>
        </div>
        <h1 className="mt-2 text-3xl font-bold text-[var(--text-primary)] sm:text-4xl">
          Overhearr
        </h1>
        <p className="mt-2 max-w-xl text-sm text-[var(--text-secondary)] sm:text-base">
          Find music. Request albums. Done.
        </p>
      </header>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-10">
          <section className="space-y-4">
            <SectionHeading>Top Albums</SectionHeading>
            <RowSkeleton />
          </section>
          <section className="space-y-4">
            <SectionHeading>Top Artists</SectionHeading>
            <RowSkeleton />
          </section>
          <section className="space-y-4">
            <SectionHeading>New Releases</SectionHeading>
            <RowSkeleton />
          </section>
        </div>
      )}

      {/* Error */}
      {!isLoading && error && (
        <EmptyState
          icon={<ExclamationTriangleIcon className="h-10 w-10" />}
          title={
            isLastfmUnreachable
              ? "Last.fm isn't responding right now"
              : "We couldn't load Discover"
          }
          description={
            isLastfmUnreachable
              ? 'The upstream service is unreachable. Try again in a moment.'
              : error instanceof ApiError
                ? error.message
                : 'Something went wrong loading the Discover feed.'
          }
          cta={
            <Button variant="secondary" onClick={() => mutate()}>
              Try again
            </Button>
          }
        />
      )}

      {/* Not configured */}
      {!isLoading && !error && data && !data.configured && (
        <EmptyState
          icon={<RadioIcon className="h-10 w-10" />}
          title="Set up Last.fm to power Discover"
          description="Add a Last.fm API key in Settings to get top charts and new releases."
          cta={
            user?.role === 'ADMIN' ? (
              <Link href="/settings">
                <Button variant="primary">Open Settings</Button>
              </Link>
            ) : null
          }
        />
      )}

      {/* Configured + data */}
      {!isLoading && !error && data && data.configured && (
        <div className="space-y-10">
          <section className="space-y-4">
            <SectionHeading>Top Albums</SectionHeading>
            {data.topAlbums.length > 0 ? (
              <AlbumRow items={data.topAlbums} />
            ) : (
              <p className="text-sm text-[var(--text-muted)]">
                No top albums right now.
              </p>
            )}
          </section>
          <section className="space-y-4">
            <SectionHeading>Top Artists</SectionHeading>
            {data.topArtists.length > 0 ? (
              <ArtistRow items={data.topArtists} />
            ) : (
              <p className="text-sm text-[var(--text-muted)]">
                No top artists right now.
              </p>
            )}
          </section>
          <section className="space-y-4">
            <SectionHeading>New Releases</SectionHeading>
            {data.newReleases.length > 0 ? (
              <AlbumRow items={data.newReleases} />
            ) : (
              <p className="text-sm text-[var(--text-muted)]">
                No new releases right now.
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
