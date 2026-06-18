import React, { forwardRef } from 'react';
import clsx from 'clsx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] focus-visible:ring-[var(--accent)]',
  secondary:
    'bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border)] hover:bg-[var(--bg-input)] focus-visible:ring-[var(--accent)]',
  ghost:
    'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] focus-visible:ring-[var(--accent)]',
  danger:
    'bg-[var(--danger)] text-white hover:opacity-90 focus-visible:ring-[var(--danger)]',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm rounded-md',
  md: 'h-10 px-4 text-sm rounded-md',
  lg: 'h-11 px-5 text-base rounded-lg',
};

const Spinner: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={clsx('animate-spin h-4 w-4', className)}
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" className="opacity-25" />
    <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" fill="none" />
  </svg>
);

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    leftIcon,
    disabled,
    children,
    className,
    type,
    ...rest
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 font-medium transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]',
        'disabled:cursor-not-allowed disabled:opacity-60',
        VARIANT[variant],
        SIZE[size],
        className
      )}
      {...rest}
    >
      {loading ? <Spinner /> : leftIcon}
      <span>{children}</span>
    </button>
  );
});

export default Button;
