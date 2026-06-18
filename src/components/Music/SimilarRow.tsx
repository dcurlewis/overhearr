import React from 'react';
import { Skeleton } from '../ui/Skeleton';
import { AlbumCard } from './AlbumCard';
import { ArtistCard } from './ArtistCard';
import { RequestButton } from './RequestButton';
import type {
  DiscoverAlbumWithStatus,
  DiscoverArtistWithStatus,
} from '../../types/api';

/**
 * A "recommendations" row for the detail pages: "More like this" (albums) on
 * the album page and "Similar artists" on the artist page.
 *
 * Each card mirrors the artist-discography layout — an AlbumCard/ArtistCard
 * with a compact, status-aware RequestButton beneath it — so the request
 * affordance and "In library" handling are identical to the rest of the app.
 *
 * The row is self-contained about its own state:
 *   - `isLoading` → a skeleton grid.
 *   - loaded but empty (no recommendations, or both upstream sources degraded)
 *     → renders nothing at all, so a detail page never shows an empty heading.
 */

const SKELETON_COUNT = 6;

function RowSkeleton(): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 p-2">
          <Skeleton className="aspect-square w-full" />
          <Skeleton shape="text" className="w-3/4" />
          <Skeleton shape="text" className="w-1/2" />
        </div>
      ))}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <h2 className="text-lg font-semibold text-[var(--text-primary)]">
      {children}
    </h2>
  );
}

export interface SimilarAlbumsRowProps {
  title: string;
  items: DiscoverAlbumWithStatus[] | undefined;
  isLoading: boolean;
  /** SWR key(s) to revalidate after a successful request. */
  revalidateKeys?: string[];
}

export function SimilarAlbumsRow({
  title,
  items,
  isLoading,
  revalidateKeys,
}: SimilarAlbumsRowProps): JSX.Element | null {
  if (isLoading) {
    return (
      <section className="space-y-4">
        <Heading>{title}</Heading>
        <RowSkeleton />
      </section>
    );
  }
  if (!items || items.length === 0) return null;

  return (
    <section className="space-y-4">
      <Heading>{title}</Heading>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {items.map((it, idx) => (
          <div key={`${it.mbid ?? 'na'}-${idx}`} className="flex flex-col gap-2">
            <AlbumCard
              title={it.name}
              artist={it.artist}
              mbid={it.mbid}
              coverArtUrl={it.imageUrl}
              requestStatus={it.requestStatus}
              inLibrary={it.inLibrary}
              meta={it.firstReleaseDate?.slice(0, 4)}
            />
            {it.mbid && (
              <div className="px-1">
                <RequestButton
                  requestStatus={it.requestStatus ?? { exists: false }}
                  mbid={it.mbid}
                  kind="album"
                  size="sm"
                  inLibrary={it.inLibrary}
                  revalidateKeys={revalidateKeys}
                  compact
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export interface SimilarArtistsRowProps {
  title: string;
  items: DiscoverArtistWithStatus[] | undefined;
  isLoading: boolean;
  revalidateKeys?: string[];
}

export function SimilarArtistsRow({
  title,
  items,
  isLoading,
  revalidateKeys,
}: SimilarArtistsRowProps): JSX.Element | null {
  if (isLoading) {
    return (
      <section className="space-y-4">
        <Heading>{title}</Heading>
        <RowSkeleton />
      </section>
    );
  }
  if (!items || items.length === 0) return null;

  return (
    <section className="space-y-4">
      <Heading>{title}</Heading>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {items.map((it, idx) => (
          <div key={`${it.mbid ?? 'na'}-${idx}`} className="flex flex-col gap-2">
            <ArtistCard
              name={it.name}
              mbid={it.mbid}
              imageUrl={it.imageUrl}
              requestStatus={it.requestStatus}
              inLibrary={it.inLibrary}
            />
            {it.mbid && (
              <div className="px-1">
                {/*
                  Deliberately do NOT pass `inLibrary` to the artist-wide
                  RequestButton. Artist `inLibrary` means "at least one album by
                  this artist is in Lidarr", not "the full catalogue is" — so
                  passing it would wrongly disable a discography request. The
                  badge on ArtistCard still uses it. Mirrors the artist detail
                  page (src/pages/artist/[mbid].tsx).
                */}
                <RequestButton
                  requestStatus={it.requestStatus ?? { exists: false }}
                  mbid={it.mbid}
                  kind="artist"
                  size="sm"
                  revalidateKeys={revalidateKeys}
                  compact
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
