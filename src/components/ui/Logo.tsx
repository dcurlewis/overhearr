import React from 'react';
import clsx from 'clsx';

/**
 * Overhearr "Groove" mark — concentric vinyl-groove rings radiating from a
 * centre dot. Drawn entirely in `currentColor` so it inherits the surrounding
 * text colour (the brand accent in the header, neutral elsewhere).
 *
 * This is the official Overhearr mark (brand direction "Groove", see issue
 * #15). The favicon / PWA / OG icon set under `public/` is generated from the
 * same geometry — if you change the <svg> body here, regenerate those assets
 * to match.
 */
export const GrooveMark: React.FC<{ className?: string; title?: string }> = ({
  className,
  title,
}) => (
  <svg
    viewBox="0 0 32 32"
    role={title ? 'img' : 'presentation'}
    aria-hidden={title ? undefined : true}
    aria-label={title}
    fill="none"
    className={className}
  >
    {title ? <title>{title}</title> : null}
    {/* Groove rings — fine concentric circles suggesting a vinyl record */}
    <circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
    <circle cx="16" cy="16" r="10.5" stroke="currentColor" strokeWidth="1.5" opacity="0.55" />
    <circle cx="16" cy="16" r="7" stroke="currentColor" strokeWidth="1.5" opacity="0.8" />
    {/* Centre dot — the spindle */}
    <circle cx="16" cy="16" r="3" fill="currentColor" />
  </svg>
);

/**
 * Full header lockup: the Groove mark plus the "Overhearr" wordmark. The mark
 * inherits `currentColor`; the wordmark uses the display face.
 */
export const Logo: React.FC<{ className?: string; markClassName?: string }> = ({
  className,
  markClassName,
}) => (
  <span className={clsx('inline-flex items-center gap-2.5', className)}>
    <GrooveMark className={clsx('h-8 w-8 text-[var(--accent)]', markClassName)} />
    <span className="font-display text-xl font-semibold tracking-tight text-[var(--text-primary)]">
      Overhearr
    </span>
  </span>
);

export default Logo;
