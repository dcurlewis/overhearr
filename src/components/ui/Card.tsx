import React from 'react';
import clsx from 'clsx';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  header?: React.ReactNode;
  footer?: React.ReactNode;
  padded?: boolean;
}

export const Card: React.FC<CardProps> = ({
  header,
  footer,
  padded = true,
  className,
  children,
  ...rest
}) => (
  <div
    className={clsx(
      'rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] shadow-sm',
      className
    )}
    {...rest}
  >
    {header && (
      <div className="border-b border-[var(--border)] px-5 py-3 text-sm font-medium text-[var(--text-primary)]">
        {header}
      </div>
    )}
    <div className={clsx(padded && 'px-5 py-4')}>{children}</div>
    {footer && (
      <div className="border-t border-[var(--border)] px-5 py-3 text-sm text-[var(--text-secondary)]">
        {footer}
      </div>
    )}
  </div>
);

export default Card;
