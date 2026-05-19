import React from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { Badge } from '../ui/Badge';
import { CoverArt } from '../ui/CoverArt';
import { RequestStatusBadge } from '../ui/RequestStatusBadge';
import type { RequestStatusInfo } from '../../types/api';

export interface AlbumCardProps {
  /** Cover art URL. */
  coverArtUrl?: string | null;
  /** Album title. */
  title: string;
  /** Artist display name. */
  artist?: string | null;
  /**
   * MusicBrainz id (release-group preferred). When absent the card falls
   * back to a search link instead of a detail link.
   */
  mbid?: string | null;
  /** Per-user request status — badge is shown only when `exists`. */
  requestStatus?: RequestStatusInfo;
  /**
   * True when the album is already in the configured Lidarr library.
   * Renders a subtle "In library" badge in place of the request-status
   * badge (the request status badge is suppressed when in-library is true,
   * since "already in your library" supersedes any open request row).
   */
  inLibrary?: boolean;
  /** Optional secondary line (year, label, etc.) shown under the artist. */
  meta?: React.ReactNode;
  className?: string;
}

/**
 * A 1:1 cover-art card for browsing surfaces. Click navigates to:
 *   - `/album/<mbid>` when an mbid is present, or
 *   - `/search?q=<artist+title>` as a fallback for Discover rows without one.
 */
export const AlbumCard: React.FC<AlbumCardProps> = ({
  coverArtUrl,
  title,
  artist,
  mbid,
  requestStatus,
  inLibrary,
  meta,
  className,
}) => {
  const href = mbid
    ? `/album/${encodeURIComponent(mbid)}`
    : `/search?q=${encodeURIComponent([artist, title].filter(Boolean).join(' '))}`;

  const titleAttr = mbid ? undefined : 'Search to find this album';

  return (
    <Link
      href={href}
      title={titleAttr}
      className={clsx(
        'group flex flex-col gap-2 rounded-lg p-2 transition hover:bg-[var(--bg-elevated)] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
        className
      )}
    >
      <div className="relative">
        <CoverArt
          src={coverArtUrl ?? undefined}
          alt={title}
          rounded="md"
          className="transition group-hover:-translate-y-0.5 group-hover:shadow-lg"
        />
        {inLibrary ? (
          <div className="absolute right-1.5 top-1.5">
            <Badge variant="success">In library</Badge>
          </div>
        ) : (
          requestStatus?.exists && (
            <div className="absolute right-1.5 top-1.5">
              <RequestStatusBadge status={requestStatus} />
            </div>
          )
        )}
      </div>
      <div className="min-w-0 px-1">
        <p className="truncate text-sm font-medium text-[var(--text-primary)]">
          {title}
        </p>
        {artist && (
          <p className="truncate text-xs text-[var(--text-secondary)]">
            {artist}
          </p>
        )}
        {meta && (
          <p className="truncate text-xs text-[var(--text-muted)]">{meta}</p>
        )}
      </div>
    </Link>
  );
};

export default AlbumCard;
