import React from 'react';
import clsx from 'clsx';

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'h-7 w-7 text-xs',
  md: 'h-9 w-9 text-sm',
  lg: 'h-12 w-12 text-base',
};

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).slice(0, 2);
  return parts
    .map((p) => p[0])
    .filter((c): c is string => Boolean(c))
    .join('')
    .toUpperCase();
}

export const Avatar: React.FC<AvatarProps> = ({
  name,
  src,
  size = 'md',
  className,
}) => {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- avatar image is small + dynamic
      <img
        src={src}
        alt={name}
        className={clsx(
          'rounded-full object-cover ring-1 ring-[var(--border)]',
          SIZE[size],
          className
        )}
      />
    );
  }
  return (
    <span
      aria-label={name}
      className={clsx(
        'inline-flex items-center justify-center rounded-full bg-indigo-500/20 font-semibold text-indigo-200 ring-1 ring-indigo-500/30',
        SIZE[size],
        className
      )}
    >
      {initials(name)}
    </span>
  );
};

export default Avatar;
