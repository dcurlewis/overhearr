import React from 'react';
import clsx from 'clsx';

export type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const VARIANT: Record<BadgeVariant, string> = {
  neutral:
    'bg-[var(--bg-input)] text-[var(--text-secondary)] border-[var(--border)]',
  info: 'bg-[var(--info-bg)] text-[var(--info)] border-[var(--info-border)]',
  success:
    'bg-[var(--success-bg)] text-[var(--success)] border-[var(--success-border)]',
  warning:
    'bg-[var(--warning-bg)] text-[var(--warning)] border-[var(--warning-border)]',
  danger:
    'bg-[var(--danger-bg)] text-[var(--danger)] border-[var(--danger-border)]',
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
