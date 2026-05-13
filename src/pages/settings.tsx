import React, { useCallback } from 'react';
import useSWR from 'swr';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';

import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { LastfmConfigCard } from '../components/Settings/LastfmConfigCard';
import { LidarrConfigCard } from '../components/Settings/LidarrConfigCard';
import { useRouteGuard } from '../hooks/useRouteGuard';
import { ApiError, swrFetcher } from '../lib/api';
import { formatUptime } from '../utils/formatters';

interface LidarrSettingsView {
  lidarrUrl: string | null;
  lidarrApiKey: string | null;
  lidarrRootFolderPath: string | null;
  lidarrQualityProfileId: number | null;
  lidarrMetadataProfileId: number | null;
  lastfmApiKey: string | null;
  setupCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

interface HealthResponse {
  status: 'ok' | 'error';
  version: string;
  uptimeSec: number;
  db: 'ok' | 'error';
  lidarrConfigured: boolean;
}

export default function SettingsPage(): JSX.Element {
  const { loading: guardLoading } = useRouteGuard({ require: 'admin' });

  const {
    data: settings,
    error: settingsError,
    isLoading: settingsLoading,
    mutate: mutateSettings,
  } = useSWR<LidarrSettingsView>('/api/settings', swrFetcher);

  const {
    data: health,
    isLoading: healthLoading,
    mutate: mutateHealth,
  } = useSWR<HealthResponse>('/api/health', swrFetcher);

  const handleSettingsSaved = useCallback(async () => {
    await Promise.all([mutateSettings(), mutateHealth()]);
  }, [mutateHealth, mutateSettings]);

  if (guardLoading || settingsLoading) {
    return <SettingsSkeleton />;
  }

  if (settingsError) {
    return (
      <Card>
        <div className="flex items-center gap-2 text-red-300">
          <ExclamationTriangleIcon className="h-5 w-5" />
          <span>
            Could not load settings:{' '}
            {settingsError instanceof ApiError
              ? settingsError.message
              : 'Unknown error'}
          </span>
        </div>
      </Card>
    );
  }

  if (!settings) {
    return <SettingsSkeleton />;
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-[var(--text-primary)]">
          Settings
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Configure Lidarr and Last.fm integrations and inspect system health.
        </p>
      </header>

      <Card header={<div className="flex items-center justify-between">
        <span>System</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => mutateHealth()}
          disabled={healthLoading}
          leftIcon={<ArrowPathIcon className="h-4 w-4" />}
        >
          Refresh
        </Button>
      </div>}>
        {health ? (
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <SystemMetric label="Version" value={health.version} />
            <SystemMetric label="Uptime" value={formatUptime(health.uptimeSec)} />
            <SystemMetric
              label="Database"
              value={
                <span
                  className={
                    health.db === 'ok' ? 'text-emerald-300' : 'text-red-300'
                  }
                >
                  {health.db === 'ok' ? (
                    <CheckCircleIcon className="inline h-4 w-4 align-text-bottom" />
                  ) : (
                    <ExclamationTriangleIcon className="inline h-4 w-4 align-text-bottom" />
                  )}
                  <span className="ml-1">{health.db}</span>
                </span>
              }
            />
            <SystemMetric
              label="Lidarr"
              value={
                health.lidarrConfigured ? (
                  <span className="text-emerald-300">Configured</span>
                ) : (
                  <span className="text-amber-300">Not configured</span>
                )
              }
            />
          </dl>
        ) : (
          <Skeleton className="h-12 w-full" />
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LidarrConfigCard
          settings={settings}
          onSaved={handleSettingsSaved}
        />
        <LastfmConfigCard
          apiKeyRedacted={settings.lastfmApiKey}
          onSaved={handleSettingsSaved}
        />
      </div>
    </div>
  );
}

function SystemMetric({
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

function SettingsSkeleton(): JSX.Element {
  return (
    <div className="space-y-5">
      <Skeleton className="h-8 w-48" />
      <Card>
        <Skeleton className="h-12 w-full" />
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </Card>
        <Card>
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </Card>
      </div>
    </div>
  );
}
