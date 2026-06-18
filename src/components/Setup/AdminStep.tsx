import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useToast } from '../ui/Toast';
import { ApiError, apiPost } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { useSetup } from '../../context/SetupContext';
import type { PublicUser } from '../../types/api';

interface AdminStepProps {
  onAdvance: () => void;
}

interface AdminForm {
  username: string;
  password: string;
  confirmPassword: string;
}

const USERNAME_RE = /^[a-z0-9_-]+$/;

export const AdminStep: React.FC<AdminStepProps> = ({ onAdvance }) => {
  const auth = useAuth();
  const setup = useSetup();
  const toast = useToast();

  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<AdminForm>({
    defaultValues: { username: '', password: '', confirmPassword: '' },
    mode: 'onTouched',
  });

  const passwordValue = watch('password');

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSubmitting(true);
    try {
      await apiPost<PublicUser>('/api/setup/initialize', {
        username: values.username,
        password: values.password,
      });
      // Initialize endpoint logs us in via session cookie. Refresh both
      // contexts so the rest of the wizard sees the new state.
      await Promise.all([auth.mutate(), setup.refresh()]);
      toast.success('Admin account created');
      onAdvance();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          // Setup already initialized — refresh contexts and let the page
          // guard / resume logic handle it.
          await Promise.all([auth.mutate(), setup.refresh()]);
          onAdvance();
          return;
        }
        if (err.status === 429) {
          toast.error('Too many attempts; wait a minute and try again.');
          setServerError('Too many attempts; wait a minute and try again.');
        } else if (err.status === 400) {
          setServerError(err.message);
        } else {
          setServerError(err.message);
        }
      } else {
        setServerError('Unexpected error. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Input
        label="Username"
        type="text"
        autoComplete="username"
        autoFocus
        placeholder="admin"
        helperText="3-32 characters. Lowercase letters, digits, underscores, hyphens."
        error={errors.username?.message}
        {...register('username', {
          required: 'Username is required',
          minLength: { value: 3, message: 'At least 3 characters' },
          maxLength: { value: 32, message: 'At most 32 characters' },
          pattern: {
            value: USERNAME_RE,
            message:
              'Only lowercase letters, digits, underscores and hyphens',
          },
        })}
      />

      <div className="relative">
        <Input
          label="Password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          helperText="At least 10 characters, with at least one letter and one digit."
          error={errors.password?.message}
          {...register('password', {
            required: 'Password is required',
            minLength: { value: 10, message: 'At least 10 characters' },
            validate: (v) => {
              if (!/[A-Za-z]/.test(v)) return 'Must include at least one letter';
              if (!/\d/.test(v)) return 'Must include at least one digit';
              return true;
            },
          })}
        />
        <button
          type="button"
          onClick={() => setShowPassword((s) => !s)}
          aria-label={showPassword ? 'Hide password' : 'Show password'}
          className="absolute right-2 top-7 rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          {showPassword ? (
            <EyeSlashIcon className="h-5 w-5" />
          ) : (
            <EyeIcon className="h-5 w-5" />
          )}
        </button>
      </div>

      <Input
        label="Confirm password"
        type={showPassword ? 'text' : 'password'}
        autoComplete="new-password"
        error={errors.confirmPassword?.message}
        {...register('confirmPassword', {
          required: 'Please confirm your password',
          validate: (v) => v === passwordValue || 'Passwords do not match',
        })}
      />

      {serverError && (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]"
        >
          {serverError}
        </div>
      )}

      <Button
        type="submit"
        variant="primary"
        loading={submitting}
        className="w-full"
      >
        Create admin account
      </Button>
    </form>
  );
};

export default AdminStep;
