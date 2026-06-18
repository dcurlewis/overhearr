import React, { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { useRouter } from 'next/router';
import { useForm } from 'react-hook-form';
import { AuthLayout } from '../components/Layout/AuthLayout';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useAuth } from '../context/AuthContext';
import { useSetup } from '../context/SetupContext';
import { useToast } from '../components/ui/Toast';
import { ApiError } from '../lib/api';
import type { NextPageWithLayout } from './_app';

interface LoginForm {
  username: string;
  password: string;
}

const LoginPage: NextPageWithLayout = () => {
  const router = useRouter();
  const { user, login } = useAuth();
  const { setupCompleted, hasAdmin, isLoading: setupLoading } = useSetup();
  const toast = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginForm>({ defaultValues: { username: '', password: '' } });

  // If we're already authed, get out of /login.
  useEffect(() => {
    if (user) {
      const next = setupCompleted ? '/' : '/setup';
      router.replace(next);
    }
  }, [user, setupCompleted, router]);

  // No admin yet — login is impossible. Push the user to /setup.
  useEffect(() => {
    if (!setupLoading && !hasAdmin) {
      router.replace('/setup');
    }
  }, [setupLoading, hasAdmin, router]);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setSubmitting(true);
    try {
      await login(values.username, values.password);
      toast.success('Signed in');
      router.replace(setupCompleted ? '/' : '/setup');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setServerError('Invalid username or password.');
        } else if (err.status === 429) {
          setServerError('Too many attempts — please wait and try again.');
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
        error={errors.username?.message}
        {...register('username', { required: 'Username is required' })}
      />
      <Input
        label="Password"
        type="password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...register('password', { required: 'Password is required' })}
      />
      {serverError && (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]"
        >
          {serverError}
        </div>
      )}
      <Button type="submit" variant="primary" loading={submitting} className="w-full">
        Sign in
      </Button>
    </form>
  );
};

LoginPage.getLayout = (page: ReactElement) => (
  <AuthLayout
    title="Sign in to Overhearr"
    subtitle="Music requests for your Lidarr library"
  >
    {page}
  </AuthLayout>
);

export default LoginPage;
