import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import {
  ExclamationTriangleIcon,
  InformationCircleIcon,
  MusicalNoteIcon,
} from '@heroicons/react/24/outline';
import { ApiError, swrFetcher } from '../../lib/api';
import { useRouteGuard } from '../../hooks/useRouteGuard';
import { CoverArt } from '../../components/ui/CoverArt';
import { EmptyState } from '../../components/ui/EmptyState';
import { Skeleton } from '../../components/ui/Skeleton';
import { Badge } from '../../components/ui/Badge';
import { RequestStatusBadge } from '../../components/ui/RequestStatusBadge';
import { RequestButton } from '../../components/Music/RequestButton';
import type { AlbumDetail, RequestStatusInfo } from '../../types/api';

function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return '–';
  const totalSeconds = Math.round(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getRowFailureMessage(
  status: RequestStatusInfo
): string | null {
  if (status.exists && status.status === 'FAILED') {
    // The request row's errorMessage is on the row itself in the requests
    // list, but the per-page status info doesn't carry it. Surface a
    // generic hint and rely on the toast for the precise message after retry.
    return 'The request failed. Try again or check Settings.';
  }
  return null;
}

function HeroSkeleton(): JSX.Element {
  return (
    <div className="grid gap-6 md:grid-cols-[280px_1fr]">
      <Skeleton className="aspect-square w-full max-w-xs rounded-xl" />
      <div className="space-y-3">
        <Skeleton shape="text" className="h-6 w-2/3" />
        <Skeleton shape="text" className="w-1/3" />
        <Skeleton shape="text" className="w-1/4" />
        <div className="pt-4">
          <Skeleton className="h-10 w-32 rounded-md" />
        </div>
      </div>
    </div>
  );
}

function TrackListSkeleton(): JSX.Element {
  return (
    <ul className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/40">
      {Array.from({ length: 8 }).map((_, i) => (
        <li key={i} className="flex items-center gap-4 px-4 py-3">
          <Skeleton className="h-4 w-6" />
          <Skeleton shape="text" className="flex-1" />
          <Skeleton className="h-4 w-10" />
        </li>
      ))}
    </ul>
  );
}

export default function AlbumPage(): JSX.Element {
  useRouteGuard({ require: 'auth' });
  const router = useRouter();
  const rawMbid = router.query.mbid;
  const mbid = typeof rawMbid === 'string' ? rawMbid : undefined;

  const swrKey = mbid ? `/api/album/${encodeURIComponent(mbid)}` : null;
  const { data, error, isLoading } = useSWR<AlbumDetail>(swrKey, swrFetcher);

  if (!router.isReady || isLoading) {
    return (
      <div className="space-y-8">
        <HeroSkeleton />
        <TrackListSkeleton />
      </div>
    );
  }

  if (error instanceof ApiError && error.status === 404) {
    return (
      <EmptyState
        icon={<MusicalNoteIcon className="h-10 w-10" />}
        title="Album not found"
        description="We couldn't find that album in MusicBrainz. It may have been merged or deleted."
      />
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={<ExclamationTriangleIcon className="h-10 w-10" />}
        title="Couldn't load album"
        description={
          error instanceof ApiError
            ? error.message
            : 'Something went wrong loading this album.'
        }
      />
    );
  }

  const albumMbid = data.releaseGroupMbid || data.mbid;
  const failureHint = getRowFailureMessage(data.requestStatus);
  const showArtistBanner =
    data.artistRequestStatus.exists &&
    data.artistRequestStatus.status !== 'AVAILABLE';

  return (
    <div className="space-y-10">
      {/* Hero */}
      <section className="grid gap-6 md:grid-cols-[280px_1fr]">
        <div className="mx-auto w-full max-w-xs md:mx-0">
          <CoverArt
            src={data.coverArtUrl ?? data.thumbnailUrl}
            alt={data.title}
            rounded="xl"
          />
        </div>
        <div className="flex flex-col gap-3">
          <p className="text-xs uppercase tracking-widest text-[var(--text-muted)]">
            Album
          </p>
          <h1 className="text-3xl font-bold text-[var(--text-primary)] sm:text-4xl">
            {data.title}
          </h1>
          <p className="text-base text-[var(--text-secondary)]">
            <Link
              href={`/artist/${encodeURIComponent(data.artistMbid)}`}
              className="font-medium text-[var(--text-primary)] hover:underline"
            >
              {data.artistName}
            </Link>
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
            {data.firstReleaseDate && <span>{data.firstReleaseDate}</span>}
            {data.tracks.length > 0 && (
              <>
                <span aria-hidden>·</span>
                <span>
                  {data.tracks.length} track{data.tracks.length === 1 ? '' : 's'}
                </span>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            {data.inLibrary ? (
              <Badge variant="success">In library</Badge>
            ) : (
              <RequestStatusBadge status={data.requestStatus} />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <RequestButton
              requestStatus={data.requestStatus}
              mbid={albumMbid}
              kind="album"
              size="lg"
              inLibrary={data.inLibrary}
              revalidateKeys={swrKey ? [swrKey] : []}
            />
            {failureHint && (
              <p className="text-sm text-[var(--danger)]">{failureHint}</p>
            )}
          </div>
          {data.artistInLibrary && !data.inLibrary && (
            <div
              role="status"
              className="mt-4 flex items-start gap-3 rounded-lg border border-[var(--success-border)] bg-[var(--success-bg)] px-4 py-3 text-sm text-[var(--text-primary)]"
            >
              <InformationCircleIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--success)]" />
              <span>
                This artist is already in your library — but this album isn&apos;t
                yet. Request it to add this release.
              </span>
            </div>
          )}
          {showArtistBanner && (
            <div
              role="status"
              className="mt-4 flex items-start gap-3 rounded-lg border border-[var(--info-border)] bg-[var(--info-bg)] px-4 py-3 text-sm text-[var(--text-primary)]"
            >
              <InformationCircleIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--info)]" />
              <span>
                You already requested this artist&apos;s full discography — this
                album is being processed as part of that.
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Track list */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          Tracks
        </h2>
        {data.tracks.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            Track list isn&apos;t available for this album.
          </p>
        ) : (
          <ol className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/40">
            {data.tracks.map((t) => (
              <li
                key={`${t.position}-${t.recordingMbid ?? t.title}`}
                className="flex items-center gap-4 px-4 py-3"
              >
                <span className="w-6 text-right text-sm tabular-nums text-[var(--text-muted)]">
                  {t.position}
                </span>
                <span className="flex-1 truncate text-sm text-[var(--text-primary)]">
                  {t.title}
                </span>
                <span className="text-sm tabular-nums text-[var(--text-muted)]">
                  {formatDuration(t.lengthMs)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
