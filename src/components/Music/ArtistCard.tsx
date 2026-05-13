import React from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { Avatar } from '../ui/Avatar';
import { RequestStatusBadge } from '../ui/RequestStatusBadge';
import type { RequestStatusInfo } from '../../types/api';

export interface ArtistCardProps {
  name: string;
  mbid?: string | null;
  imageUrl?: string | null;
  requestStatus?: RequestStatusInfo;
  meta?: React.ReactNode;
  className?: string;
}

/**
 * Artist tile for browse surfaces. Like `AlbumCard`, falls back to search
 * when no mbid is available.
 */
export const ArtistCard: React.FC<ArtistCardProps> = ({
  name,
  mbid,
  imageUrl,
  requestStatus,
  meta,
  className,
}) => {
  const href = mbid
    ? `/artist/${encodeURIComponent(mbid)}`
    : `/search?q=${encodeURIComponent(name)}&type=artist`;

  const titleAttr = mbid ? undefined : 'Search to find this artist';

  return (
    <Link
      href={href}
      title={titleAttr}
      className={clsx(
        'group flex flex-col gap-2 rounded-lg p-2 transition hover:bg-[var(--bg-elevated)] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400',
        className
      )}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-full bg-[var(--bg-input)]">
        {imageUrl ? (
          // Round image fallback uses Avatar's <img> path for simplicity.
          // eslint-disable-next-line @next/next/no-img-element -- rounded artist avatar
          <img
            src={imageUrl}
            alt={name}
            className="h-full w-full object-cover transition group-hover:-translate-y-0.5"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Avatar name={name} size="lg" className="h-full w-full text-2xl" />
          </div>
        )}
        {requestStatus?.exists && (
          <div className="absolute right-1.5 top-1.5">
            <RequestStatusBadge status={requestStatus} />
          </div>
        )}
      </div>
      <div className="min-w-0 px-1 text-center">
        <p className="truncate text-sm font-medium text-[var(--text-primary)]">
          {name}
        </p>
        {meta && (
          <p className="truncate text-xs text-[var(--text-muted)]">{meta}</p>
        )}
      </div>
    </Link>
  );
};

export default ArtistCard;
