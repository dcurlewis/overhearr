import React, { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { Skeleton } from '../ui/Skeleton';
import { useToast } from '../ui/Toast';
import { ApiError, apiGet, apiPatch, swrFetcher } from '../../lib/api';

interface LidarrProfilesStepProps {
  onAdvance: () => void;
}

interface RootFolder {
  id: number;
  path: string;
  freeSpace?: number;
  accessible?: boolean;
}

interface NamedProfile {
  id: number;
  name: string;
}

interface ProfilesResponse {
  rootFolders: RootFolder[];
  qualityProfiles: NamedProfile[];
  metadataProfiles: NamedProfile[];
}

interface RedactedSettings {
  lidarrRootFolderPath: string | null;
  lidarrQualityProfileId: number | null;
  lidarrMetadataProfileId: number | null;
}

function formatFreeSpace(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB free`;
  return `${gb.toFixed(1)} GB free`;
}

export const LidarrProfilesStep: React.FC<LidarrProfilesStepProps> = ({
  onAdvance,
}) => {
  const toast = useToast();

  const { data, error, isLoading } = useSWR<ProfilesResponse>(
    '/api/settings/lidarr/profiles',
    swrFetcher,
    { revalidateOnFocus: false }
  );

  const [rootFolderPath, setRootFolderPath] = useState<string>('');
  const [qualityProfileId, setQualityProfileId] = useState<string>('');
  const [metadataProfileId, setMetadataProfileId] = useState<string>('');
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedDefaults, setSavedDefaults] = useState<RedactedSettings | null>(
    null
  );

  // Load any previously saved defaults so we can pre-select them.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cur = await apiGet<RedactedSettings>('/api/settings');
        if (!cancelled) setSavedDefaults(cur);
      } catch {
        if (!cancelled) setSavedDefaults({} as RedactedSettings);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // When data arrives, pick a sensible default for each select.
  useEffect(() => {
    if (!data || !savedDefaults) return;
    if (!rootFolderPath) {
      const candidate =
        savedDefaults.lidarrRootFolderPath &&
        data.rootFolders.find(
          (r) => r.path === savedDefaults.lidarrRootFolderPath
        )
          ? savedDefaults.lidarrRootFolderPath
          : data.rootFolders[0]?.path ?? '';
      setRootFolderPath(candidate);
    }
    if (!qualityProfileId) {
      const candidate =
        savedDefaults.lidarrQualityProfileId &&
        data.qualityProfiles.find(
          (p) => p.id === savedDefaults.lidarrQualityProfileId
        )
          ? String(savedDefaults.lidarrQualityProfileId)
          : data.qualityProfiles[0]?.id != null
            ? String(data.qualityProfiles[0].id)
            : '';
      setQualityProfileId(candidate);
    }
    if (!metadataProfileId) {
      const candidate =
        savedDefaults.lidarrMetadataProfileId &&
        data.metadataProfiles.find(
          (p) => p.id === savedDefaults.lidarrMetadataProfileId
        )
          ? String(savedDefaults.lidarrMetadataProfileId)
          : data.metadataProfiles[0]?.id != null
            ? String(data.metadataProfiles[0].id)
            : '';
      setMetadataProfileId(candidate);
    }
  }, [
    data,
    savedDefaults,
    rootFolderPath,
    qualityProfileId,
    metadataProfileId,
  ]);

  const errorMessage = useMemo(() => {
    if (!error) return null;
    if (error instanceof ApiError) return error.message;
    return 'Could not load profiles from Lidarr.';
  }, [error]);

  const canSubmit =
    Boolean(data) &&
    Boolean(rootFolderPath) &&
    Boolean(qualityProfileId) &&
    Boolean(metadataProfileId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setServerError(null);
    setSaving(true);
    try {
      await apiPatch('/api/settings/lidarr', {
        rootFolderPath,
        qualityProfileId: Number(qualityProfileId),
        metadataProfileId: Number(metadataProfileId),
      });
      toast.success('Lidarr profiles saved');
      onAdvance();
    } catch (err) {
      if (err instanceof ApiError) {
        setServerError(err.message);
      } else {
        setServerError('Unexpected error. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  if (isLoading || !savedDefaults) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-32" />
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300"
      >
        <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <span>{errorMessage}</span>
      </div>
    );
  }

  if (!data) return null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <Select
        label="Root folder"
        value={rootFolderPath}
        onChange={(e) => setRootFolderPath(e.target.value)}
        helperText="Where Lidarr will store music for new artist additions."
      >
        {data.rootFolders.length === 0 && (
          <option value="" disabled>
            No root folders configured in Lidarr
          </option>
        )}
        {data.rootFolders.map((rf) => {
          const free = formatFreeSpace(rf.freeSpace);
          return (
            <option key={rf.id} value={rf.path}>
              {rf.path}
              {free && ` — ${free}`}
            </option>
          );
        })}
      </Select>

      <Select
        label="Quality profile"
        value={qualityProfileId}
        onChange={(e) => setQualityProfileId(e.target.value)}
      >
        {data.qualityProfiles.length === 0 && (
          <option value="" disabled>
            No quality profiles configured in Lidarr
          </option>
        )}
        {data.qualityProfiles.map((p) => (
          <option key={p.id} value={String(p.id)}>
            {p.name}
          </option>
        ))}
      </Select>

      <Select
        label="Metadata profile"
        value={metadataProfileId}
        onChange={(e) => setMetadataProfileId(e.target.value)}
      >
        {data.metadataProfiles.length === 0 && (
          <option value="" disabled>
            No metadata profiles configured in Lidarr
          </option>
        )}
        {data.metadataProfiles.map((p) => (
          <option key={p.id} value={String(p.id)}>
            {p.name}
          </option>
        ))}
      </Select>

      {serverError && (
        <div
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300"
        >
          {serverError}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          type="submit"
          variant="primary"
          loading={saving}
          disabled={!canSubmit}
        >
          Save & continue
        </Button>
      </div>
    </form>
  );
};

export default LidarrProfilesStep;
