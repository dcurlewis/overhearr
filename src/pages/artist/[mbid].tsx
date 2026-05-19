import React, { useState } from 'react';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import {
  ExclamationTriangleIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import { ApiError, swrFetcher } from '../../lib/api';
import { useRouteGuard } from '../../hooks/useRouteGuard';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { RequestStatusBadge } from '../../components/ui/RequestStatusBadge';
import { AlbumCard } from '../../components/Music/AlbumCard';
import { RequestButton } from '../../components/Music/RequestButton';
import { useRequestAction } from '../../hooks/useRequestAction';
import type { ArtistDetail } from '../../types/api';

function HeroSkeleton(): JSX.Element {
  return (
    <div className="space-y-3">
      <Skeleton shape="text" className="h-8 w-1/2" />
      <Skeleton shape="text" className="w-1/4" />
      <Skeleton className="mt-3 h-10 w-48 rounded-md" />
    </div>
  );
}

function DiscographySkeleton(): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 p-2">
          <Skeleton className="aspect-square w-full" />
          <Skeleton shape="text" className="w-3/4" />
          <Skeleton shape="text" className="w-1/3" />
        </div>
      ))}
    </div>
  );
}

export default function ArtistPage(): JSX.Element {
  useRouteGuard({ require: 'auth' });
  const router = useRouter();
  const rawMbid = router.query.mbid;
  const mbid = typeof rawMbid === 'string' ? rawMbid : undefined;

  const swrKey = mbid ? `/api/artist/${encodeURIComponent(mbid)}` : null;
  const { data, error, isLoading } = useSWR<ArtistDetail>(swrKey, swrFetcher);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const { inFlight, requestArtist } = useRequestAction({
    revalidateKeys: swrKey ? [swrKey] : [],
  });

  if (!router.isReady || isLoading) {
    return (
      <div className="space-y-10">
        <HeroSkeleton />
        <DiscographySkeleton />
      </div>
    );
  }

  if (error instanceof ApiError && error.status === 404) {
    return (
      <EmptyState
        icon={<UserIcon className="h-10 w-10" />}
        title="Artist not found"
        description="We couldn't find that artist in MusicBrainz."
      />
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon className="h-10 w-10" />}
        title="Couldn't load artist"
        description={
          error instanceof ApiError
            ? error.message
            : 'Something went wrong loading this artist.'
        }
      />
    );
  }

  const artistMbid = data.mbid;
  const totalAlbums = data.releaseGroups.length;

  const handleConfirmArtist = async () => {
    setConfirmOpen(false);
    await requestArtist(artistMbid);
  };

  return (
    <div className="space-y-10">
      {/* Hero */}
      <section className="space-y-4">
        <p className="text-xs uppercase tracking-widest text-[var(--text-muted)]">
          Artist
        </p>
        <h1 className="text-3xl font-bold text-[var(--text-primary)] sm:text-4xl">
          {data.name}
        </h1>
        {data.disambiguation && (
          <p className="text-sm text-[var(--text-secondary)]">
            {data.disambiguation}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {data.type && <Badge variant="neutral">{data.type}</Badge>}
          {data.country && <Badge variant="neutral">{data.country}</Badge>}
          {data.inLibrary ? (
            <Badge variant="success">In library</Badge>
          ) : (
            <RequestStatusBadge status={data.requestStatus} />
          )}
        </div>
        <div className="pt-2">
          <RequestButton
            requestStatus={data.requestStatus}
            mbid={artistMbid}
            kind="artist"
            size="lg"
            inLibrary={data.inLibrary}
            revalidateKeys={swrKey ? [swrKey] : []}
            onRequestArtist={() => setConfirmOpen(true)}
            primaryVariant="primary"
          />
        </div>
      </section>

      {/* Discography */}
      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">
            Discography
          </h2>
          <span className="text-sm text-[var(--text-muted)]">
            {totalAlbums} release{totalAlbums === 1 ? '' : 's'}
          </span>
        </div>
        {totalAlbums === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            No releases on file for this artist.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {data.releaseGroups.map((rg) => (
              <div key={rg.mbid} className="flex flex-col gap-2">
                <AlbumCard
                  title={rg.title}
                  mbid={rg.mbid}
                  coverArtUrl={rg.coverArtUrl}
                  requestStatus={rg.requestStatus}
                  inLibrary={rg.inLibrary}
                  meta={rg.firstReleaseDate?.slice(0, 4)}
                />
                <div className="px-1">
                  <RequestButton
                    requestStatus={rg.requestStatus}
                    mbid={rg.mbid}
                    kind="album"
                    size="sm"
                    inLibrary={rg.inLibrary}
                    revalidateKeys={swrKey ? [swrKey] : []}
                    compact
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Confirm artist-wide request */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Request entire artist?"
        description={`This will add ${data.name} to your library and download all ${totalAlbums} release${
          totalAlbums === 1 ? '' : 's'
        }. Continue?`}
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={inFlight}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleConfirmArtist}
              loading={inFlight}
            >
              Request artist
            </Button>
          </>
        }
      />
    </div>
  );
}
