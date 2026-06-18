import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { useSetup } from '../../context/SetupContext';
import { ApiError, apiPost } from '../../lib/api';

interface DoneStepProps {
  /** "Go back" target if finalising fails because Lidarr isn't fully configured. */
  onBackToProfiles: () => void;
}

type Phase = 'finalizing' | 'success' | 'error';

export const DoneStep: React.FC<DoneStepProps> = ({ onBackToProfiles }) => {
  const router = useRouter();
  const toast = useToast();
  const setup = useSetup();

  const [phase, setPhase] = useState<Phase>('finalizing');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Guard against React 18 strict-mode double effects firing the POST twice.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    let redirectTimer: number | null = null;

    void (async () => {
      try {
        await apiPost('/api/setup/complete');
        if (cancelled) return;
        await setup.refresh();
        if (cancelled) return;
        setPhase('success');
        toast.success('Setup complete — welcome to Overhearr!');
        redirectTimer = window.setTimeout(() => {
          router.replace('/');
        }, 1000);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setErrorMessage(err.message);
        } else {
          setErrorMessage('Unexpected error finalising setup.');
        }
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
      if (redirectTimer != null) window.clearTimeout(redirectTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === 'finalizing') {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <svg
          className="h-8 w-8 animate-spin text-[var(--accent)]"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="3"
            fill="none"
            className="opacity-25"
          />
          <path
            d="M22 12a10 10 0 0 1-10 10"
            stroke="currentColor"
            strokeWidth="3"
            fill="none"
          />
        </svg>
        <p className="text-sm text-[var(--text-secondary)]">
          Finalizing setup...
        </p>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="space-y-4">
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-sm text-[var(--danger)]"
        >
          <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{errorMessage ?? 'Could not finalise setup.'}</span>
        </div>
        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={onBackToProfiles}>
            Go back to Lidarr profiles
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <CheckCircleIcon
        className="h-10 w-10 text-[var(--success)]"
        aria-hidden="true"
      />
      <p className="text-base font-medium text-[var(--text-primary)]">
        You&apos;re all set!
      </p>
      <p className="text-sm text-[var(--text-secondary)]">
        Taking you to Discover...
      </p>
    </div>
  );
};

export default DoneStep;
