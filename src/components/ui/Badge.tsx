import React from 'react';
import clsx from 'clsx';

export type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const VARIANT: Record<BadgeVariant, string> = {
  neutral:
    'bg-[var(--bg-input)] text-[var(--text-secondary)] border-[var(--border)]',
  info: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30',
  success: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  warning: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
  danger: 'bg-red-500/10 text-red-300 border-red-500/30',
};

export const Badge: React.FC<BadgeProps> = ({
  variant = 'neutral',
  className,
  children,
  ...rest
}) => (
  <span
    className={clsx(
      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
      VARIANT[variant],
      className
    )}
    {...rest}
  >
    {children}
  </span>
);

export default Badge;
