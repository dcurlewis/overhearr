import React from 'react';
import clsx from 'clsx';
import { Button, type ButtonSize, type ButtonVariant } from '../ui/Button';
import type {
  RequestStatusInfo,
  RequestStatusValue,
} from '../../types/api';
import { useRequestAction } from '../../hooks/useRequestAction';

export type RequestKind = 'album' | 'artist';

export interface RequestButtonProps {
  requestStatus: RequestStatusInfo;
  mbid: string;
  kind: RequestKind;
  size?: ButtonSize;
  /** SWR keys to revalidate after success (e.g. the page's primary key). */
  revalidateKeys?: string[];
  /**
   * Called when the user wants to confirm an artist-level request (modal
   * flow). If provided, clicking the button when `requestStatus.exists` is
   * false invokes this callback instead of POSTing immediately.
   */
  onRequestArtist?: () => void;
  /**
   * Render variant for the button when state is "Request" (no row yet).
   * Default `primary`.
   */
  primaryVariant?: ButtonVariant;
  className?: string;
  /** Compact label-only layout (used inside discography mini-buttons). */
  compact?: boolean;
}

const STATUS_LABEL: Record<RequestStatusValue, string> = {
  PENDING: 'Pending',
  PROCESSING: 'Downloading',
  AVAILABLE: 'Available',
  FAILED: 'Retry',
};

const STATUS_VARIANT: Record<RequestStatusValue, ButtonVariant> = {
  PENDING: 'secondary',
  PROCESSING: 'secondary',
  AVAILABLE: 'secondary',
  FAILED: 'danger',
};

/**
 * Status-aware request button. Shared by the album page, artist page,
 * search results, and Discover cards.
 *
 * - When no row exists: calls `requestAlbum` / `requestArtist` (or
 *   `onRequestArtist` if the consumer wants a confirmation modal).
 * - PENDING / PROCESSING / AVAILABLE: disabled informational state.
 * - FAILED: enabled "Retry" → POSTs `/api/requests/<id>/retry`.
 */
export const RequestButton: React.FC<RequestButtonProps> = ({
  requestStatus,
  mbid,
  kind,
  size = 'md',
  revalidateKeys,
  onRequestArtist,
  primaryVariant = 'primary',
  className,
  compact = false,
}) => {
  const { inFlight, requestAlbum, requestArtist, retry } = useRequestAction({
    revalidateKeys,
  });

  const handleClick = async () => {
    if (!requestStatus.exists) {
      if (kind === 'artist' && onRequestArtist) {
        onRequestArtist();
        return;
      }
      if (kind === 'album') await requestAlbum(mbid);
      else await requestArtist(mbid);
      return;
    }
    if (requestStatus.status === 'FAILED') {
      await retry(requestStatus.id);
    }
  };

  if (!requestStatus.exists) {
    return (
      <Button
        variant={primaryVariant}
        size={size}
        loading={inFlight}
        onClick={handleClick}
        className={clsx(compact && 'w-full', className)}
      >
        Request
      </Button>
    );
  }

  const label = STATUS_LABEL[requestStatus.status];
  const variant = STATUS_VARIANT[requestStatus.status];
  const disabled =
    requestStatus.status === 'PENDING' ||
    requestStatus.status === 'PROCESSING' ||
    requestStatus.status === 'AVAILABLE';

  return (
    <Button
      variant={variant}
      size={size}
      loading={inFlight}
      onClick={handleClick}
      disabled={disabled}
      className={clsx(
        compact && 'w-full',
        requestStatus.status === 'PROCESSING' && 'animate-pulse',
        className
      )}
    >
      {label}
    </Button>
  );
};

export default RequestButton;
