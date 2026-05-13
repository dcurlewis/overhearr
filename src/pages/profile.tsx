import React, { useState } from 'react';

import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { useRouteGuard } from '../hooks/useRouteGuard';
import { ApiError, apiPatch } from '../lib/api';
import { formatRelativeTime } from '../utils/formatters';

interface PasswordValidation {
  ok: boolean;
  message?: string;
}

/** Mirror the backend's `validatePasswordStrength` so we surface the same
 * hint locally before the round-trip. Server is still the source of truth. */
function validateNewPassword(p: string): PasswordValidation {
  if (p.length < 10) {
    return { ok: false, message: 'Password must be at least 10 characters.' };
  }
  if (!/[A-Za-z]/.test(p)) {
    return { ok: false, message: 'Password must include at least one letter.' };
  }
  if (!/\d/.test(p)) {
    return { ok: false, message: 'Password must include at least one digit.' };
  }
  return { ok: true };
}

export default function ProfilePage(): JSX.Element {
  const { loading: guardLoading, user } = useRouteGuard({ require: 'auth' });
  const toast = useToast();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (guardLoading || !user) {
    return <ProfileSkeleton />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentPassword) {
      setError('Enter your current password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    const v = validateNewPassword(newPassword);
    if (!v.ok) {
      setError(v.message ?? 'Password is too weak.');
      return;
    }

    setSubmitting(true);
    try {
      await apiPatch('/api/profile/password', { currentPassword, newPassword });
      toast.success('Password updated');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : 'Failed to change password';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          Profile
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Account details and password.
        </p>
      </header>

      <Card>
        <div className="flex items-center gap-4">
          <Avatar name={user.username} size="lg" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold text-[var(--text-primary)]">
                {user.username}
              </span>
              <Badge variant={user.role === 'ADMIN' ? 'info' : 'neutral'}>
                {user.role === 'ADMIN' ? 'Admin' : 'User'}
              </Badge>
              {!user.isActive && <Badge variant="warning">Inactive</Badge>}
            </div>
            <div className="text-sm text-[var(--text-muted)]">
              Account created {formatRelativeTime(user.createdAt)}
            </div>
          </div>
        </div>
      </Card>

      <Card header="Change password">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <Input
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            helperText="At least 10 characters with a letter and a digit."
            required
          />
          <Input
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            error={
              confirmPassword && confirmPassword !== newPassword
                ? 'Passwords do not match.'
                : undefined
            }
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end">
            <Button
              type="submit"
              variant="primary"
              loading={submitting}
              disabled={submitting}
            >
              Update password
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function ProfileSkeleton(): JSX.Element {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-32" />
      <Card>
        <div className="flex items-center gap-4">
          <Skeleton shape="circle" className="h-12 w-12" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      </Card>
      <Card>
        <div className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </Card>
    </div>
  );
}
