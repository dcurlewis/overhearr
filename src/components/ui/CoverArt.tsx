import React, { useState } from 'react';
import Image from 'next/image';
import { MusicalNoteIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import { proxiedImage } from '../../lib/image';

export interface CoverArtProps {
  src?: string | null;
  alt: string;
  className?: string;
  rounded?: 'md' | 'lg' | 'xl';
  sizes?: string;
}

const ROUNDED: Record<NonNullable<CoverArtProps['rounded']>, string> = {
  md: 'rounded-md',
  lg: 'rounded-lg',
  xl: 'rounded-xl',
};

export const CoverArt: React.FC<CoverArtProps> = ({
  src,
  alt,
  className,
  rounded = 'lg',
  sizes = '(max-width: 768px) 50vw, 200px',
}) => {
  const [errored, setErrored] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Route upstream cover-art through the on-disk image proxy so it keeps
  // rendering when Cover Art Archive / the CDN is slow or down.
  const proxiedSrc = proxiedImage(src);
  const showImage = proxiedSrc && !errored;

  return (
    <div
      className={clsx(
        'relative aspect-square w-full overflow-hidden bg-[var(--bg-input)]',
        ROUNDED[rounded],
        className
      )}
    >
      {showImage ? (
        <>
          {!loaded && (
            <div className="absolute inset-0 animate-pulse bg-[var(--bg-input)]" />
          )}
          <Image
            src={proxiedSrc}
            alt={alt}
            fill
            sizes={sizes}
            // The bytes are already cached + sized upstream by /api/image, and
            // the Next image optimizer (which fetches server-side without the
            // user's session cookie) can't reach our auth-gated proxy. Serve
            // the proxied bytes directly instead.
            unoptimized
            className={clsx(
              'object-cover transition-opacity duration-300',
              loaded ? 'opacity-100' : 'opacity-0'
            )}
            onLoad={() => setLoaded(true)}
            onError={() => setErrored(true)}
          />
        </>
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[var(--text-muted)]">
          <MusicalNoteIcon className="h-1/3 w-1/3" />
        </div>
      )}
    </div>
  );
};

export default CoverArt;
