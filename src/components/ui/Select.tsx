import React, { forwardRef, useId } from 'react';
import clsx from 'clsx';

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helperText?: string;
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, helperText, error, className, id, children, ...rest },
  ref
) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const helpId = `${selectId}-help`;
  const hasError = Boolean(error);

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label
          htmlFor={selectId}
          className="text-sm font-medium text-[var(--text-secondary)]"
        >
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        aria-invalid={hasError || undefined}
        aria-describedby={helperText || error ? helpId : undefined}
        className={clsx(
          'rounded-md border bg-[var(--bg-input)] px-3 py-2 text-sm text-[var(--text-primary)]',
          'focus:outline-none focus:ring-2 focus:ring-indigo-500/40',
          hasError
            ? 'border-red-500/60 focus:border-red-500'
            : 'border-[var(--border)] focus:border-indigo-500',
          className
        )}
        {...rest}
      >
        {children}
      </select>
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

export default Select;
