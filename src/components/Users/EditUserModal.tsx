import React, { useEffect, useState } from 'react';

import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Select';
import { useToast } from '../ui/Toast';
import { ApiError, apiPatch } from '../../lib/api';
import type { PublicUser, UserRole } from '../../types/api';

export interface EditUserModalProps {
  open: boolean;
  user: PublicUser | null;
  isSelf: boolean;
  /** When true, the modal opens with the password section already revealed. */
  startInPasswordReset?: boolean;
  onClose: () => void;
  onSaved: (user: PublicUser) => void;
}

export const EditUserModal: React.FC<EditUserModalProps> = ({
  open,
  user,
  isSelf,
  startInPasswordReset = false,
  onClose,
  onSaved,
}) => {
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<UserRole>('USER');
  const [isActive, setIsActive] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) {
      setUsername(user.username);
      setRole(user.role);
      setIsActive(user.isActive);
      setShowPassword(startInPasswordReset);
      setPassword('');
      setError(null);
    }
  }, [startInPasswordReset, user]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setError(null);

    const body: Record<string, unknown> = {};
    if (username && username !== user.username) body.username = username;
    if (role !== user.role) body.role = role;
    if (isActive !== user.isActive) body.isActive = isActive;
    if (showPassword && password) body.password = password;

    if (Object.keys(body).length === 0) {
      setError('No changes to save.');
      return;
    }

    setSubmitting(true);
    try {
      const updated = await apiPatch<PublicUser>(
        `/api/users/${user.id}`,
        body
      );
      toast.success(`Updated ${updated.username}`);
      onSaved(updated);
      onClose();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to update user';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open && Boolean(user)}
      onClose={handleClose}
      title={user ? `Edit ${user.username}` : 'Edit user'}
    >
      {user && (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <Input
            label="Username"
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Select
            label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            disabled={isSelf}
            helperText={
              isSelf ? 'You cannot change your own role.' : undefined
            }
          >
            <option value="USER">User</option>
            <option value="ADMIN">Admin</option>
          </Select>
          <label className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm">
            <span className="text-[var(--text-primary)]">Active</span>
            <input
              type="checkbox"
              checked={isActive}
              disabled={isSelf}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4 rounded border-[var(--border)] bg-[var(--bg-elevated)] text-[var(--accent)] focus:ring-[var(--accent)]"
            />
          </label>
          {isSelf && (
            <p className="text-xs text-[var(--text-muted)]">
              You cannot deactivate your own account.
            </p>
          )}

          <div className="rounded-md border border-[var(--border)] p-3">
            {!showPassword ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowPassword(true)}
              >
                Set new password
              </Button>
            ) : (
              <div className="space-y-2">
                <Input
                  label="New password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  helperText="At least 10 characters with a letter and a digit."
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowPassword(false);
                    setPassword('');
                  }}
                >
                  Cancel password change
                </Button>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-[var(--danger)]">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={handleClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={submitting}
              disabled={submitting}
            >
              Save changes
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};

export default EditUserModal;
