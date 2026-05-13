import React, { useCallback, useState } from 'react';
import useSWR from 'swr';
import { PlusIcon, UsersIcon } from '@heroicons/react/24/outline';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Pagination } from '../components/ui/Pagination';
import { Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { CreateUserModal } from '../components/Users/CreateUserModal';
import { DeleteUserConfirm } from '../components/Users/DeleteUserConfirm';
import { EditUserModal } from '../components/Users/EditUserModal';
import { UserRow } from '../components/Users/UserRow';
import { useAuth } from '../context/AuthContext';
import { useRouteGuard } from '../hooks/useRouteGuard';
import { ApiError, apiDelete, apiPatch, swrFetcher } from '../lib/api';
import type { PublicUser } from '../types/api';

const PAGE_SIZE = 50;

interface UsersListResponse {
  users: PublicUser[];
  total: number;
}

export default function UsersPage(): JSX.Element {
  const { loading: guardLoading } = useRouteGuard({ require: 'admin' });
  const { user: currentUser } = useAuth();
  const toast = useToast();

  const [page, setPage] = useState(1);
  const swrKey = `/api/users?limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}`;
  const { data, error, isLoading, mutate } = useSWR<UsersListResponse>(
    swrKey,
    swrFetcher
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<PublicUser | null>(null);
  const [editingPasswordReset, setEditingPasswordReset] = useState(false);
  const [deleting, setDeleting] = useState<PublicUser | null>(null);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  const setBusy = (id: number, busy: boolean) => {
    setBusyIds((cur) => {
      const next = new Set(cur);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleToggleActive = useCallback(
    async (row: PublicUser, next: boolean) => {
      setBusy(row.id, true);
      const optimistic: UsersListResponse | undefined = data
        ? {
            ...data,
            users: data.users.map((u) =>
              u.id === row.id ? { ...u, isActive: next } : u
            ),
          }
        : undefined;
      try {
        await mutate(
          async () => {
            const updated = await apiPatch<PublicUser>(
              `/api/users/${row.id}`,
              { isActive: next }
            );
            if (!data) return data;
            return {
              ...data,
              users: data.users.map((u) => (u.id === row.id ? updated : u)),
            };
          },
          { optimisticData: optimistic, revalidate: true, rollbackOnError: true }
        );
        toast.success(next ? 'User activated' : 'User deactivated');
      } catch (err) {
        const msg =
          err instanceof ApiError ? err.message : 'Failed to update user';
        toast.error(msg);
      } finally {
        setBusy(row.id, false);
      }
    },
    [data, mutate, toast]
  );

  const handleDelete = useCallback(async () => {
    if (!deleting) return;
    setBusy(deleting.id, true);
    try {
      await apiDelete<void>(`/api/users/${deleting.id}`);
      toast.success(`Deleted ${deleting.username}`);
      setDeleting(null);
      await mutate();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : 'Failed to delete user';
      toast.error(msg);
    } finally {
      if (deleting) setBusy(deleting.id, false);
    }
  }, [deleting, mutate, toast]);

  if (guardLoading) {
    return <PageSkeleton />;
  }

  const users = data?.users ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
            Users
          </h1>
          <p className="text-sm text-[var(--text-secondary)]">
            Manage who can sign in and which accounts are admins.
          </p>
        </div>
        <Button
          variant="primary"
          onClick={() => setCreateOpen(true)}
          leftIcon={<PlusIcon className="h-4 w-4" />}
        >
          Create user
        </Button>
      </header>

      <Card padded={false}>
        {error ? (
          <div className="px-5 py-10">
            <EmptyState
              icon={<UsersIcon className="h-10 w-10" />}
              title="Could not load users"
              description={
                error instanceof ApiError ? error.message : 'Unexpected error'
              }
            />
          </div>
        ) : isLoading ? (
          <div className="px-5 py-6">
            <SkeletonRows />
          </div>
        ) : users.length === 0 ? (
          <div className="px-5 py-10">
            <EmptyState
              icon={<UsersIcon className="h-10 w-10" />}
              title="No users yet"
              description="Create your first user to get started."
            />
          </div>
        ) : (
          <>
            <ul className="space-y-3 px-4 py-4 sm:hidden">
              {users.map((row) => (
                <UserRow
                  key={row.id}
                  row={row}
                  isSelf={currentUser?.id === row.id}
                  busy={busyIds.has(row.id)}
                  layout="card"
                  onToggleActive={handleToggleActive}
                  onEdit={(u) => {
                    setEditingPasswordReset(false);
                    setEditing(u);
                  }}
                  onResetPassword={(u) => {
                    setEditingPasswordReset(true);
                    setEditing(u);
                  }}
                  onDelete={(u) => setDeleting(u)}
                />
              ))}
            </ul>

            <div className="hidden sm:block">
              <table className="w-full">
                <thead className="bg-[var(--bg-input)]/40">
                  <tr className="text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                    <th className="px-3 py-2 font-medium">Username</th>
                    <th className="px-3 py-2 font-medium">Role</th>
                    <th className="px-3 py-2 font-medium">Active</th>
                    <th className="px-3 py-2 font-medium">Created</th>
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((row) => (
                    <UserRow
                      key={row.id}
                      row={row}
                      isSelf={currentUser?.id === row.id}
                      busy={busyIds.has(row.id)}
                      layout="table"
                      onToggleActive={handleToggleActive}
                      onEdit={(u) => {
                        setEditingPasswordReset(false);
                        setEditing(u);
                      }}
                      onResetPassword={(u) => {
                        setEditingPasswordReset(true);
                        setEditing(u);
                      }}
                      onDelete={(u) => setDeleting(u)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-3">
              <span className="text-xs text-[var(--text-muted)]">
                {total} user{total === 1 ? '' : 's'}
              </span>
              <Pagination
                page={page}
                total={total}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
              />
            </div>
          </>
        )}
      </Card>

      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => mutate()}
      />

      <EditUserModal
        open={Boolean(editing)}
        user={editing}
        isSelf={currentUser?.id === editing?.id}
        startInPasswordReset={editingPasswordReset}
        onClose={() => {
          setEditing(null);
          setEditingPasswordReset(false);
        }}
        onSaved={() => mutate()}
      />

      <DeleteUserConfirm
        open={Boolean(deleting)}
        user={deleting}
        busy={deleting ? busyIds.has(deleting.id) : false}
        onCancel={() => setDeleting(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}

function SkeletonRows(): JSX.Element {
  return (
    <ul className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <li
          key={i}
          className="flex items-center gap-3 rounded-md border border-[var(--border)] p-3"
        >
          <Skeleton shape="circle" className="h-8 w-8" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-3 w-1/6" />
          </div>
          <Skeleton className="h-6 w-16" />
        </li>
      ))}
    </ul>
  );
}

function PageSkeleton(): JSX.Element {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-32" />
      <Card padded={false}>
        <div className="px-5 py-6">
          <SkeletonRows />
        </div>
      </Card>
    </div>
  );
}
