import React from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';

export interface PaginationProps {
  page: number; // 1-indexed
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  className?: string;
}

function pageList(current: number, totalPages: number): Array<number | '...'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const out: Array<number | '...'> = [1];
  if (current > 4) out.push('...');
  const start = Math.max(2, current - 1);
  const end = Math.min(totalPages - 1, current + 1);
  for (let i = start; i <= end; i++) out.push(i);
  if (current < totalPages - 3) out.push('...');
  out.push(totalPages);
  return out;
}

export const Pagination: React.FC<PaginationProps> = ({
  page,
  total,
  pageSize,
  onPageChange,
  className,
}) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;
  const pages = pageList(page, totalPages);

  return (
    <nav
      className={clsx('flex items-center justify-center gap-1', className)}
      aria-label="Pagination"
    >
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="rounded-md p-2 text-[var(--text-secondary)] disabled:opacity-40 hover:bg-[var(--bg-elevated)]"
        aria-label="Previous page"
      >
        <ChevronLeftIcon className="h-4 w-4" />
      </button>
      {pages.map((p, idx) =>
        p === '...' ? (
          <span
            key={`gap-${idx}`}
            className="px-2 text-sm text-[var(--text-muted)]"
          >
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p)}
            aria-current={p === page ? 'page' : undefined}
            className={clsx(
              'h-8 min-w-[2rem] rounded-md px-2 text-sm transition',
              p === page
                ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]'
            )}
          >
            {p}
          </button>
        )
      )}
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className="rounded-md p-2 text-[var(--text-secondary)] disabled:opacity-40 hover:bg-[var(--bg-elevated)]"
        aria-label="Next page"
      >
        <ChevronRightIcon className="h-4 w-4" />
      </button>
    </nav>
  );
};

export default Pagination;
