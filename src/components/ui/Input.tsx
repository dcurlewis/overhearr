import React, { forwardRef, useId } from 'react';
import clsx from 'clsx';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
  leftAddon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, helperText, error, leftAddon, className, id, ...rest },
  ref
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const helpId = `${inputId}-help`;
  const hasError = Boolean(error);

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-[var(--text-secondary)]"
        >
          {label}
        </label>
      )}
      <div
        className={clsx(
          'flex items-stretch overflow-hidden rounded-md border bg-[var(--bg-input)] transition',
          'focus-within:ring-2 focus-within:ring-indigo-500/40',
          hasError
            ? 'border-red-500/60 focus-within:border-red-500'
            : 'border-[var(--border)] focus-within:border-indigo-500'
        )}
      >
        {leftAddon && (
          <span className="flex items-center bg-[var(--bg-elevated)] px-3 text-sm text-[var(--text-muted)]">
            {leftAddon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={hasError || undefined}
          aria-describedby={helperText || error ? helpId : undefined}
          className={clsx(
            'flex-1 bg-transparent px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)]',
            'focus:outline-none',
            className
          )}
          {...rest}
        />
      </div>
      {(helperText || error) && (
        <p
          id={helpId}
          className={clsx(
            'text-xs',
            hasError ? 'text-red-400' : 'text-[var(--text-muted)]'
          )}
        >
          {error ?? helperText}
        </p>
      )}
    </div>
  );
});

export default Input;
