import React from 'react';
import {
  ArrowPathIcon,
  EyeIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { CoverArt } from '../ui/CoverArt';
import { RequestStatusBadge } from '../ui/RequestStatusBadge';
import type { MusicRequestRow } from '../../types/api';
import { formatRelativeTime } from '../../utils/formatters';

export interface RequestRowProps {
  row: MusicRequestRow;
  username?: string;
  showRequester?: boolean;
  onView: (row: MusicRequestRow) => void;
  onRetry?: (row: MusicRequestRow) => void;
  onDelete: (row: MusicRequestRow) => void;
  busy?: boolean;
  layout?: 'table' | 'card';
}

/**
 * Single row in the /requests list. Shared between the desktop table layout
 * (`layout="table"` -> renders <tr>) and the mobile stacked card layout
 * (`layout="card"` -> renders a <li>).
 */
export const RequestRow: React.FC<RequestRowProps> = ({
  row,
  username,
  showRequester,
  onView,
  onRetry,
  onDelete,
  busy = false,
  layout = 'table',
}) => {
  const typeLabel = row.type === 'ALBUM' ? 'Album' : 'Artist';
  const requested = formatRelativeTime(row.createdAt);
  const canRetry = row.status === 'FAILED' && Boolean(onRetry);

  const statusBadge = (
    <RequestStatusBadge
      status={{
        exists: true,
        id: row.id,
        status: row.status,
        type: row.type,
        createdAt: row.createdAt,
      }}
      errorMessage={row.errorMessage}
    />
  );

  if (layout === 'card') {
    return (
      <li className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="h-16 w-16 flex-shrink-0">
            <CoverArt
              src={row.coverArtUrl}
              alt={row.name}
              rounded="md"
              sizes="64px"
            />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-[var(--text-primary)]">
              {row.name}
            </div>
            {row.artistName && row.type === 'ALBUM' && (
              <div className="truncate text-xs text-[var(--text-secondary)]">
                {row.artistName}
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge variant="neutral">{typeLabel}</Badge>
              {statusBadge}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
          <span>
            {showRequester && username ? `${username} • ` : ''}
            {requested}
          </span>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onView(row)}
              leftIcon={<EyeIcon className="h-4 w-4" />}
            >
              View
            </Button>
            {canRetry && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onRetry?.(row)}
                disabled={busy}
                leftIcon={<ArrowPathIcon className="h-4 w-4" />}
              >
                Retry
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDelete(row)}
              disabled={busy}
              leftIcon={<TrashIcon className="h-4 w-4" />}
              className="text-[var(--danger)] hover:opacity-80"
            >
              Delete
            </Button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <tr className={clsx('border-t border-[var(--border)]', busy && 'opacity-60')}>
      <td className="px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 flex-shrink-0">
            <CoverArt
              src={row.coverArtUrl}
              alt={row.name}
              rounded="md"
              sizes="48px"
            />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-[var(--text-primary)]">
              {row.name}
            </div>
            {row.artistName && row.type === 'ALBUM' && (
              <div className="truncate text-xs text-[var(--text-secondary)]">
                {row.artistName}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="px-3 py-2">
        <Badge variant="neutral">{typeLabel}</Badge>
      </td>
      <td className="px-3 py-2">{statusBadge}</td>
      {showRequester && (
        <td className="px-3 py-2 text-sm text-[var(--text-secondary)]">
          {username ?? '—'}
        </td>
      )}
      <td className="px-3 py-2 text-sm text-[var(--text-muted)]">{requested}</td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onView(row)}
            aria-label="View details"
            leftIcon={<EyeIcon className="h-4 w-4" />}
          >
            <span className="sr-only">View</span>
          </Button>
          {canRetry && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onRetry?.(row)}
              disabled={busy}
              aria-label="Retry request"
              leftIcon={<ArrowPathIcon className="h-4 w-4" />}
            >
              <span className="sr-only">Retry</span>
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onDelete(row)}
            disabled={busy}
            aria-label="Delete request"
            leftIcon={<TrashIcon className="h-4 w-4" />}
            className="text-[var(--danger)] hover:opacity-80"
          >
            <span className="sr-only">Delete</span>
          </Button>
        </div>
      </td>
    </tr>
  );
};

export default RequestRow;
