import React from 'react';
import clsx from 'clsx';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  cta?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  cta,
  className,
}) => (
  <div
    className={clsx(
      'flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg-elevated)]/40 px-6 py-12 text-center',
      className
    )}
  >
    {icon && <div className="text-[var(--text-muted)]">{icon}</div>}
    <h3 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h3>
    {description && (
      <p className="max-w-md text-sm text-[var(--text-secondary)]">{description}</p>
    )}
    {cta && <div className="mt-2">{cta}</div>}
  </div>
);

export default EmptyState;
