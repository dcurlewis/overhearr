import React, { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import {
  ArrowPathIcon,
  QueueListIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { Pagination } from '../components/ui/Pagination';
import { RequestStatusBadge } from '../components/ui/RequestStatusBadge';
import { Select } from '../components/ui/Select';
import { Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { RequestRow } from '../components/Requests/RequestRow';
import { useRouteGuard } from '../hooks/useRouteGuard';
import {
  ApiError,
  apiDelete,
  apiPost,
  swrFetcher,
} from '../lib/api';
import type {
  MusicRequestRow,
  PublicUser,
  RequestListResponse,
  RequestStatusValue,
  RequestTypeValue,
} from '../types/api';
import { formatRelativeTime } from '../utils/formatters';

const PAGE_SIZE = 25;

type StatusFilter = 'any' | RequestStatusValue;
type TypeFilter = 'any' | RequestTypeValue;
type ScopeValue = 'mine' | 'all';

interface UsersListResponse {
  users: PublicUser[];
  total: number;
}

interface ReconcileResponse {
  checked: number;
  promotedToAvailable: number;
  errors: number;
}

function buildKey(params: URLSearchParams): string {
  return `/api/requests?${params.toString()}`;
}

function readStringParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export default function RequestsPage(): JSX.Element {
  const router = useRouter();
  const { user, loading: guardLoading } = useRouteGuard({ require: 'auth' });
  const toast = useToast();

  const isAdmin = user?.role === 'ADMIN';

  const queryStatus = (readStringParam(router.query.status) ??
    'any') as StatusFilter;
  const queryType = (readStringParam(router.query.type) ?? 'any') as TypeFilter;
  const queryScope = (readStringParam(router.query.scope) ?? 'mine') as ScopeValue;
  const queryPage = Math.max(
    1,
    Number(readStringParam(router.query.page) ?? '1') || 1
  );

  // Coerce: scope=all only meaningful for admin.
  const effectiveScope: ScopeValue = isAdmin ? queryScope : 'mine';

  const swrParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set('limit', String(PAGE_SIZE));
    p.set('offset', String((queryPage - 1) * PAGE_SIZE));
    if (queryStatus !== 'any') p.set('status', queryStatus);
    if (queryType !== 'any') p.set('type', queryType);
    p.set('scope', effectiveScope);
    return p;
  }, [queryPage, queryStatus, queryType, effectiveScope]);

  const swrKey = router.isReady ? buildKey(swrParams) : null;
  const { data, error, isLoading, mutate } = useSWR<RequestListResponse>(
    swrKey,
    swrFetcher
  );

  // For scope=all, fetch a small batch of users to map userId -> username.
  const usersKey = isAdmin && effectiveScope === 'all' ? '/api/users?limit=200' : null;
  const { data: usersData } = useSWR<UsersListResponse>(usersKey, swrFetcher);
  const usernameById = useMemo(() => {
    const map = new Map<number, string>();
    if (usersData?.users) {
      for (const u of usersData.users) map.set(u.id, u.username);
    }
    return map;
  }, [usersData]);

  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [viewing, setViewing] = useState<MusicRequestRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MusicRequestRow | null>(null);
  const [reconciling, setReconciling] = useState(false);

  const updateQuery = useCallback(
    (patch: Record<string, string | undefined>) => {
      const next = { ...router.query, ...patch };
      // Strip undefined values.
      for (const k of Object.keys(next)) {
        if (next[k] === undefined) delete next[k];
      }
      router.replace({ pathname: router.pathname, query: next }, undefined, {
        shallow: true,
      });
    },
    [router]
  );

  const setBusy = (id: number, busy: boolean) => {
    setBusyIds((cur) => {
      const next = new Set(cur);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleRetry = useCallback(
    async (row: MusicRequestRow) => {
      setBusy(row.id, true);
      // Optimistic: bump status to PROCESSING in the cache while we await.
      const optimistic: RequestListResponse | undefined = data
        ? {
            ...data,
            requests: data.requests.map((r) =>
              r.id === row.id ? { ...r, status: 'PROCESSING', errorMessage: null } : r
            ),
          }
        : undefined;
      try {
        await mutate(
          async () => {
            const updated = await apiPost<MusicRequestRow>(
              `/api/requests/${row.id}/retry`
            );
            if (!data) return data;
            return {
              ...data,
              requests: data.requests.map((r) =>
                r.id === row.id ? updated : r
              ),
            };
          },
          { optimisticData: optimistic, revalidate: true, rollbackOnError: true }
        );
        toast.success('Retry queued');
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Retry failed';
        toast.error(msg);
      } finally {
        setBusy(row.id, false);
      }
    },
    [data, mutate, toast]
  );

  const handleDelete = useCallback(
    async (row: MusicRequestRow) => {
      setBusy(row.id, true);
      const optimistic: RequestListResponse | undefined = data
        ? {
            ...data,
            requests: data.requests.filter((r) => r.id !== row.id),
            total: Math.max(0, data.total - 1),
          }
        : undefined;
      try {
        await mutate(
          async () => {
            await apiDelete<void>(`/api/requests/${row.id}`);
            return optimistic;
          },
          { optimisticData: optimistic, revalidate: true, rollbackOnError: true }
        );
        toast.success('Request deleted');
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Delete failed';
        toast.error(msg);
      } finally {
        setBusy(row.id, false);
        setConfirmDelete(null);
      }
    },
    [data, mutate, toast]
  );

  const handleReconcile = useCallback(async () => {
    setReconciling(true);
    try {
      const res = await apiPost<ReconcileResponse>('/api/requests/_reconcile');
      toast.success(
        `Reconciled ${res.checked} request${res.checked === 1 ? '' : 's'} (` +
          `${res.promotedToAvailable} promoted, ${res.errors} error${res.errors === 1 ? '' : 's'})`
      );
      await mutate();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Reconciliation failed';
      toast.error(msg);
    } finally {
      setReconciling(false);
    }
  }, [mutate, toast]);

  if (guardLoading) {
    return <PageSkeleton />;
  }

  const requests = data?.requests ?? [];
  const total = data?.total ?? 0;
  const showRequester = effectiveScope === 'all' && isAdmin;
  const headerTitle = effectiveScope === 'all' ? 'All Requests' : 'My Requests';

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
            {headerTitle}
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Track album and artist requests, retry failures, and remove old
            entries.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <ScopeToggle
              value={effectiveScope}
              onChange={(v) =>
                updateQuery({
                  scope: v === 'mine' ? undefined : 'all',
                  page: undefined,
                })
              }
            />
          )}
          {isAdmin && (
            <Button
              variant="secondary"
              size="sm"
              loading={reconciling}
              disabled={reconciling}
              onClick={handleReconcile}
              leftIcon={<ArrowPathIcon className="h-4 w-4" />}
            >
              Reconcile now
            </Button>
          )}
        </div>
      </header>

      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <Select
            aria-label="Filter by status"
            value={queryStatus}
            onChange={(e) =>
              updateQuery({
                status: e.target.value === 'any' ? undefined : e.target.value,
                page: undefined,
              })
            }
            className="min-w-[10rem]"
          >
            <option value="any">Any status</option>
            <option value="PENDING">Pending</option>
            <option value="PROCESSING">Processing</option>
            <option value="AVAILABLE">Available</option>
            <option value="FAILED">Failed</option>
          </Select>
          <Select
            aria-label="Filter by type"
            value={queryType}
            onChange={(e) =>
              updateQuery({
                type: e.target.value === 'any' ? undefined : e.target.value,
                page: undefined,
              })
            }
            className="min-w-[10rem]"
          >
            <option value="any">Any type</option>
            <option value="ALBUM">Album</option>
            <option value="ARTIST">Artist</option>
          </Select>
          {(queryStatus !== 'any' || queryType !== 'any') && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                updateQuery({
                  status: undefined,
                  type: undefined,
                  page: undefined,
                })
              }
            >
              Clear filters
            </Button>
          )}
        </div>

        {error ? (
          <div className="px-5 py-10">
            <EmptyState
              icon={<QueueListIcon className="h-10 w-10" />}
              title="Could not load requests"
              description={
                error instanceof ApiError
                  ? error.message
                  : 'Unexpected error loading the request list.'
              }
            />
          </div>
        ) : isLoading ? (
          <div className="px-5 py-6">
            <SkeletonRows />
          </div>
        ) : requests.length === 0 ? (
          <div className="px-5 py-10">
            <EmptyState
              icon={<QueueListIcon className="h-10 w-10" />}
              title="No requests yet"
              description="Browse music to start requesting albums and artists."
            />
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <ul className="space-y-3 px-4 py-4 sm:hidden">
              {requests.map((row) => (
                <RequestRow
                  key={row.id}
                  row={row}
                  layout="card"
                  username={usernameById.get(row.userId) ?? `User #${row.userId}`}
                  showRequester={showRequester}
                  busy={busyIds.has(row.id)}
                  onView={(r) => setViewing(r)}
                  onRetry={handleRetry}
                  onDelete={(r) => setConfirmDelete(r)}
                />
              ))}
            </ul>

            {/* Desktop table */}
            <div className="hidden sm:block">
              <table className="w-full">
                <thead className="bg-[var(--bg-input)]/40">
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                    <th className="px-3 py-2 font-medium">Title</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    {showRequester && (
                      <th className="px-3 py-2 font-medium">Requested by</th>
                    )}
                    <th className="px-3 py-2 font-medium">Requested</th>
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((row) => (
                    <RequestRow
                      key={row.id}
                      row={row}
                      layout="table"
                      username={usernameById.get(row.userId) ?? `User #${row.userId}`}
                      showRequester={showRequester}
                      busy={busyIds.has(row.id)}
                      onView={(r) => setViewing(r)}
                      onRetry={handleRetry}
                      onDelete={(r) => setConfirmDelete(r)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-3">
              <span className="text-xs text-[var(--text-muted)]">
                Showing {requests.length} of {total} request
                {total === 1 ? '' : 's'}
              </span>
              <Pagination
                page={queryPage}
                total={total}
                pageSize={PAGE_SIZE}
                onPageChange={(p) =>
                  updateQuery({ page: p === 1 ? undefined : String(p) })
                }
              />
            </div>
          </>
        )}
      </Card>

      {/* View details modal */}
      <Modal
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        title={viewing?.name ?? 'Request details'}
        size="lg"
      >
        {viewing && <RequestDetailBody row={viewing} />}
      </Modal>

      {/* Confirm delete modal */}
      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete request?"
        description={
          confirmDelete
            ? `This removes "${confirmDelete.name}" from your request history. It does not remove anything from Lidarr.`
            : ''
        }
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => setConfirmDelete(null)}
              disabled={confirmDelete ? busyIds.has(confirmDelete.id) : false}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={confirmDelete ? busyIds.has(confirmDelete.id) : false}
              onClick={() => confirmDelete && handleDelete(confirmDelete)}
            >
              Delete
            </Button>
          </>
        }
      />
    </div>
  );
}

function ScopeToggle({
  value,
  onChange,
}: {
  value: ScopeValue;
  onChange: (v: ScopeValue) => void;
}): JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="Request scope"
      className="inline-flex rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-0.5 text-xs"
    >
      {(['mine', 'all'] as const).map((opt) => (
        <button
          key={opt}
          type="button"
          role="tab"
          aria-selected={value === opt}
          onClick={() => onChange(opt)}
          className={clsx(
            'rounded px-3 py-1 transition',
            value === opt
              ? 'bg-[var(--accent)] text-[var(--accent-contrast)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          )}
        >
          {opt === 'mine' ? 'Mine' : 'Everyone'}
        </button>
      ))}
    </div>
  );
}

function RequestDetailBody({ row }: { row: MusicRequestRow }): JSX.Element {
  return (
    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
      <DetailItem label="Type" value={row.type === 'ALBUM' ? 'Album' : 'Artist'} />
      <DetailItem
        label="Status"
        value={
          <RequestStatusBadge
            status={{
              exists: true,
              id: row.id,
              status: row.status,
              type: row.type,
              createdAt: row.createdAt,
            }}
            errorMessage={row.errorMessage}
          />
        }
      />
      <DetailItem label="Title" value={row.name} />
      <DetailItem label="Artist" value={row.artistName ?? '—'} />
      <DetailItem label="MBID" value={<code className="text-xs">{row.mbid}</code>} />
      <DetailItem label="Release date" value={row.releaseDate ?? '—'} />
      <DetailItem
        label="Lidarr album id"
        value={row.lidarrAlbumId !== null ? String(row.lidarrAlbumId) : '—'}
      />
      <DetailItem
        label="Lidarr artist id"
        value={row.lidarrArtistId !== null ? String(row.lidarrArtistId) : '—'}
      />
      <DetailItem
        label="Created"
        value={`${formatRelativeTime(row.createdAt)} (${new Date(
          row.createdAt
        ).toLocaleString()})`}
      />
      <DetailItem
        label="Updated"
        value={`${formatRelativeTime(row.updatedAt)} (${new Date(
          row.updatedAt
        ).toLocaleString()})`}
      />
      {row.errorMessage && (
        <div className="sm:col-span-2">
          <dt className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
            Error
          </dt>
          <dd className="mt-1 rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-xs text-[var(--danger)]">
            {row.errorMessage}
          </dd>
        </div>
      )}
    </dl>
  );
}

function DetailItem({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}): JSX.Element {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </dt>
      <dd className="mt-1 text-[var(--text-primary)]">{value}</dd>
    </div>
  );
}

function SkeletonRows(): JSX.Element {
  return (
    <ul className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <li
          key={i}
          className="flex items-center gap-3 rounded-md border border-[var(--border)] p-3"
        >
          <Skeleton className="h-12 w-12 flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-6 w-20" />
        </li>
      ))}
    </ul>
  );
}

function PageSkeleton(): JSX.Element {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Card padded={false}>
        <div className="px-5 py-6">
          <SkeletonRows />
        </div>
      </Card>
    </div>
  );
}
