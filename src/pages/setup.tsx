import React, { useEffect, useReducer, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { useRouter } from 'next/router';
import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import { AuthLayout } from '../components/Layout/AuthLayout';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import { useAuth } from '../context/AuthContext';
import { useSetup } from '../context/SetupContext';
import { useRouteGuard } from '../hooks/useRouteGuard';
import { apiGet, ApiError } from '../lib/api';
import { AdminStep } from '../components/Setup/AdminStep';
import { DoneStep } from '../components/Setup/DoneStep';
import { LidarrConnectionStep } from '../components/Setup/LidarrConnectionStep';
import { LidarrProfilesStep } from '../components/Setup/LidarrProfilesStep';
import { WizardShell } from '../components/Setup/WizardShell';
import {
  computeInitialStep,
  setupReducer,
  STEP_TITLES,
  type InitialStepInput,
  type SetupState,
} from '../components/Setup/setupMachine';
import type { NextPageWithLayout } from './_app';

interface RedactedSettings {
  lidarrUrl: string | null;
  lidarrApiKey: string | null; // redacted (e.g. "••••••••aabb") or null
  lidarrRootFolderPath: string | null;
  lidarrQualityProfileId: number | null;
  lidarrMetadataProfileId: number | null;
}

function lidarrConfigFromSettings(
  s: RedactedSettings | null
): InitialStepInput['lidarrConfigured'] {
  if (!s) return undefined;
  return {
    hasUrl: Boolean(s.lidarrUrl),
    hasApiKey: Boolean(s.lidarrApiKey),
    hasRootFolderPath: Boolean(s.lidarrRootFolderPath),
    hasQualityProfileId: s.lidarrQualityProfileId != null,
    hasMetadataProfileId: s.lidarrMetadataProfileId != null,
  };
}

const STEP_DESCRIPTIONS: Record<string, string> = {
  admin:
    'Pick a username and password for the first admin. You can invite more users later.',
  'lidarr-connection':
    "Tell Overhearr where your Lidarr instance lives. We'll verify the connection before saving.",
  'lidarr-profiles':
    'Choose where new music goes and how Lidarr should monitor it.',
  done: 'Wrapping up...',
};

const SetupPage: NextPageWithLayout = () => {
  const router = useRouter();
  const auth = useAuth();
  const setup = useSetup();
  const guard = useRouteGuard({ require: 'setup-incomplete' });

  // Initial step: from SetupContext alone if we don't have settings yet.
  const initialState: SetupState = {
    step: computeInitialStep({
      hasAdmin: setup.hasAdmin,
      setupCompleted: setup.setupCompleted,
    }),
  };
  const [state, dispatch] = useReducer(setupReducer, initialState);

  // Once admin exists (and we are logged in), fetch the redacted settings so
  // we can resume the wizard at the right step.
  const [resumeReady, setResumeReady] = useState(false);
  const resumedRef = useRef(false);

  useEffect(() => {
    if (resumedRef.current) return;
    if (!setup.hasAdmin || !auth.user) return;
    resumedRef.current = true;

    let cancelled = false;
    void (async () => {
      try {
        const cur = await apiGet<RedactedSettings>('/api/settings');
        if (cancelled) return;
        const target = computeInitialStep({
          hasAdmin: true,
          setupCompleted: setup.setupCompleted,
          lidarrConfigured: lidarrConfigFromSettings(cur),
        });
        dispatch({ type: 'reset', step: target });
      } catch (err) {
        // 401/403 here would be surprising (we're admin), but don't crash —
        // just fall through to whatever step we already computed.
        if (!(err instanceof ApiError)) {
          // Swallow non-API errors silently; the user can still proceed.
        }
      } finally {
        if (!cancelled) setResumeReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setup.hasAdmin, setup.setupCompleted, auth.user]);

  // If we don't have an admin yet, we don't need the settings fetch — just
  // mark resume as "done" so the loading skeleton clears.
  useEffect(() => {
    if (!setup.hasAdmin) setResumeReady(true);
  }, [setup.hasAdmin]);

  // If the backend ever flips setupCompleted while we're on this page (e.g.
  // the user opened the wizard in two tabs), bail out.
  useEffect(() => {
    if (!guard.loading && setup.setupCompleted && setup.hasAdmin) {
      router.replace('/');
    }
  }, [guard.loading, setup.setupCompleted, setup.hasAdmin, router]);

  if (guard.loading || !resumeReady) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-32" />
      </div>
    );
  }

  // The page guard handles the redirect; rendering nothing while it runs is
  // fine, but the skeleton above already covers that case.

  const heading = STEP_TITLES[state.step];
  const description = STEP_DESCRIPTIONS[state.step];

  let body: React.ReactNode = null;
  switch (state.step) {
    case 'admin':
      body = <AdminStep onAdvance={() => dispatch({ type: 'next' })} />;
      break;
    case 'lidarr-connection':
      body = (
        <LidarrConnectionStep
          onAdvance={() => dispatch({ type: 'next' })}
        />
      );
      break;
    case 'lidarr-profiles':
      body = (
        <LidarrProfilesStep onAdvance={() => dispatch({ type: 'next' })} />
      );
      break;
    case 'done':
      body = (
        <DoneStep
          onBackToProfiles={() =>
            dispatch({ type: 'goto', step: 'lidarr-profiles' })
          }
        />
      );
      break;
  }

  // Show "Back" on lidarr-profiles only. lidarr-connection has no back
  // button (admin step is irreversible) and `done` is auto-running.
  const canGoBack = state.step === 'lidarr-profiles';

  return (
    <WizardShell
      current={state.step}
      heading={heading}
      description={description}
    >
      {body}
      {canGoBack && (
        <div className="mt-4 flex">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            leftIcon={<ArrowLeftIcon className="h-4 w-4" />}
            onClick={() => dispatch({ type: 'back' })}
          >
            Back
          </Button>
        </div>
      )}
    </WizardShell>
  );
};

SetupPage.getLayout = (page: ReactElement) => (
  <AuthLayout
    title="Welcome to Overhearr"
    subtitle="Let's get your library connected."
  >
    {page}
  </AuthLayout>
);

export default SetupPage;
