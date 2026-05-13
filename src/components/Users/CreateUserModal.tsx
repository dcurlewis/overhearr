import React, { useState } from 'react';

import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Select';
import { useToast } from '../ui/Toast';
import { ApiError, apiPost } from '../../lib/api';
import type { PublicUser, UserRole } from '../../types/api';

export interface CreateUserModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (user: PublicUser) => void;
}

export const CreateUserModal: React.FC<CreateUserModalProps> = ({
  open,
  onClose,
  onCreated,
}) => {
  const toast = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('USER');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setUsername('');
    setPassword('');
    setRole('USER');
    setError(null);
    setSubmitting(false);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username || !password) {
      setError('Username and password are required.');
      return;
    }
    setSubmitting(true);
    try {
      const created = await apiPost<PublicUser>('/api/users', {
        username,
        password,
        role,
      });
      toast.success(`Created user ${created.username}`);
      onCreated(created);
      reset();
      onClose();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : 'Failed to create user';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Create user"
      description="New users can sign in immediately. Choose Admin to grant full settings access."
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <Input
          label="Username"
          autoComplete="off"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          autoFocus
          helperText="Letters, digits, underscores and hyphens. 3–32 characters."
        />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          helperText="At least 10 characters with a letter and a digit."
        />
        <Select
          label="Role"
          value={role}
          onChange={(e) => setRole(e.target.value as UserRole)}
        >
          <option value="USER">User</option>
          <option value="ADMIN">Admin</option>
        </Select>
        {error && <p className="text-sm text-red-400">{error}</p>}
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
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
};

export default CreateUserModal;
