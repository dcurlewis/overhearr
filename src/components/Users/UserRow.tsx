import React from 'react';
import {
  EllipsisHorizontalIcon,
  KeyIcon,
  PencilSquareIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { Menu } from '@headlessui/react';
import clsx from 'clsx';

import { Avatar } from '../ui/Avatar';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import type { PublicUser } from '../../types/api';
import { formatRelativeTime } from '../../utils/formatters';

export interface UserRowProps {
  row: PublicUser;
  isSelf: boolean;
  busy?: boolean;
  onToggleActive: (row: PublicUser, next: boolean) => void;
  onEdit: (row: PublicUser) => void;
  onResetPassword: (row: PublicUser) => void;
  onDelete: (row: PublicUser) => void;
  layout?: 'table' | 'card';
}

const ToggleSwitch: React.FC<{
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}> = ({ checked, onChange, disabled, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={clsx(
      'relative inline-flex h-5 w-9 items-center rounded-full transition',
      checked ? 'bg-[var(--success)]' : 'bg-[var(--bg-input)] border border-[var(--border)]',
      disabled && 'cursor-not-allowed opacity-50'
    )}
  >
    <span
      className={clsx(
        'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition',
        checked ? 'translate-x-4' : 'translate-x-0.5'
      )}
    />
  </button>
);

const RoleBadge: React.FC<{ role: PublicUser['role'] }> = ({ role }) => (
  <Badge variant={role === 'ADMIN' ? 'info' : 'neutral'}>
    {role === 'ADMIN' ? 'Admin' : 'User'}
  </Badge>
);

const ActionMenu: React.FC<{
  row: PublicUser;
  isSelf: boolean;
  onEdit: () => void;
  onResetPassword: () => void;
  onDelete: () => void;
  disabled?: boolean;
}> = ({ row, isSelf, onEdit, onResetPassword, onDelete, disabled }) => (
  <Menu as="div" className="relative inline-block text-left">
    <Menu.Button
      as={Button}
      size="sm"
      variant="ghost"
      disabled={disabled}
      aria-label={`Actions for ${row.username}`}
    >
      <EllipsisHorizontalIcon className="h-4 w-4" />
    </Menu.Button>
    <Menu.Items className="absolute right-0 z-10 mt-1 w-44 origin-top-right rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-1 shadow-lg focus:outline-none">
      <Menu.Item>
        {({ active }) => (
          <button
            type="button"
            onClick={onEdit}
            className={clsx(
              'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
              active
                ? 'bg-[var(--bg-input)] text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)]'
            )}
          >
            <PencilSquareIcon className="h-4 w-4" /> Edit
          </button>
        )}
      </Menu.Item>
      <Menu.Item>
        {({ active }) => (
          <button
            type="button"
            onClick={onResetPassword}
            className={clsx(
              'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
              active
                ? 'bg-[var(--bg-input)] text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)]'
            )}
          >
            <KeyIcon className="h-4 w-4" /> Reset password
          </button>
        )}
      </Menu.Item>
      <Menu.Item disabled={isSelf}>
        {({ active, disabled: itemDisabled }) => (
          <button
            type="button"
            onClick={onDelete}
            disabled={itemDisabled}
            className={clsx(
              'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
              itemDisabled && 'cursor-not-allowed opacity-50',
              active && !itemDisabled
                ? 'bg-[var(--danger-bg)] text-[var(--danger)]'
                : 'text-[var(--danger)]'
            )}
          >
            <TrashIcon className="h-4 w-4" /> Delete
          </button>
        )}
      </Menu.Item>
    </Menu.Items>
  </Menu>
);

export const UserRow: React.FC<UserRowProps> = ({
  row,
  isSelf,
  busy = false,
  onToggleActive,
  onEdit,
  onResetPassword,
  onDelete,
  layout = 'table',
}) => {
  const created = formatRelativeTime(row.createdAt);

  if (layout === 'card') {
    return (
      <li className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <Avatar name={row.username} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--text-primary)]">
                {row.username}
              </span>
              {isSelf && <Badge variant="info">You</Badge>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <RoleBadge role={row.role} />
              {!row.isActive && <Badge variant="warning">Inactive</Badge>}
            </div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">
              Created {created}
            </div>
          </div>
          <ActionMenu
            row={row}
            isSelf={isSelf}
            disabled={busy}
            onEdit={() => onEdit(row)}
            onResetPassword={() => onResetPassword(row)}
            onDelete={() => onDelete(row)}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-[var(--text-secondary)]">
          <span>Active</span>
          <ToggleSwitch
            checked={row.isActive}
            disabled={busy || isSelf}
            onChange={(next) => onToggleActive(row, next)}
            label={`Toggle ${row.username} active state`}
          />
        </div>
      </li>
    );
  }

  return (
    <tr className={clsx('border-t border-[var(--border)]', busy && 'opacity-60')}>
      <td className="px-3 py-2">
        <div className="flex items-center gap-3">
          <Avatar name={row.username} size="sm" />
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
              {row.username}
              {isSelf && <Badge variant="info">You</Badge>}
            </div>
          </div>
        </div>
      </td>
      <td className="px-3 py-2">
        <RoleBadge role={row.role} />
      </td>
      <td className="px-3 py-2">
        <ToggleSwitch
          checked={row.isActive}
          disabled={busy || isSelf}
          onChange={(next) => onToggleActive(row, next)}
          label={`Toggle ${row.username} active state`}
        />
      </td>
      <td className="px-3 py-2 text-sm text-[var(--text-muted)]">{created}</td>
      <td className="px-3 py-2 text-right">
        <ActionMenu
          row={row}
          isSelf={isSelf}
          disabled={busy}
          onEdit={() => onEdit(row)}
          onResetPassword={() => onResetPassword(row)}
          onDelete={() => onDelete(row)}
        />
      </td>
    </tr>
  );
};

export default UserRow;
