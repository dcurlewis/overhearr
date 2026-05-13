import React, { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
} from '@heroicons/react/24/outline';

import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { useToast } from '../ui/Toast';
import {
  ApiError,
  apiPatch,
  apiPost,
  swrFetcher,
} from '../../lib/api';
import { formatBytes } from '../../utils/formatters';

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

interface ProfilesResponse {
  rootFolders: Array<{ id: number; path: string; freeSpace?: number }>;
  qualityProfiles: Array<{ id: number; name: string }>;
  metadataProfiles: Array<{ id: number; name: string }>;
}

interface TestResponse {
  ok: boolean;
  version?: string | null;
  instanceName?: string | null;
  error?: string;
}

export interface LidarrConfigCardProps {
  settings: LidarrSettingsView;
  onSaved: () => void;
}

/**
 * Lidarr config card. Lets the admin update URL/API key, pick root folder
 * and profiles, and run an in-place connection test against unsaved values.
 */
export const LidarrConfigCard: React.FC<LidarrConfigCardProps> = ({
  settings,
  onSaved,
}) => {
  const toast = useToast();
  const [url, setUrl] = useState(settings.lidarrUrl ?? '');
  const [editingKey, setEditingKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [rootFolder, setRootFolder] = useState(settings.lidarrRootFolderPath ?? '');
  const [qualityId, setQualityId] = useState<number | ''>(
    settings.lidarrQualityProfileId ?? ''
  );
  const [metadataId, setMetadataId] = useState<number | ''>(
    settings.lidarrMetadataProfileId ?? ''
  );
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResponse | null>(null);

  // Reset local state when parent settings change (e.g. after a save).
  useEffect(() => {
    setUrl(settings.lidarrUrl ?? '');
    setRootFolder(settings.lidarrRootFolderPath ?? '');
    setQualityId(settings.lidarrQualityProfileId ?? '');
    setMetadataId(settings.lidarrMetadataProfileId ?? '');
    setApiKey('');
    setEditingKey(false);
    setTestResult(null);
  }, [settings]);

  // Profiles are only meaningful when URL+key are saved. Skip otherwise so
  // we don't surface a 400 to the user before they've configured anything.
  const hasSaved = Boolean(settings.lidarrUrl) && Boolean(settings.lidarrApiKey);
  const {
    data: profiles,
    error: profilesError,
    isLoading: profilesLoading,
    mutate: refetchProfiles,
  } = useSWR<ProfilesResponse>(
    hasSaved ? '/api/settings/lidarr/profiles' : null,
    swrFetcher
  );

  const rootFolderOptions = profiles?.rootFolders ?? [];
  const qualityOptions = profiles?.qualityProfiles ?? [];
  const metadataOptions = profiles?.metadataProfiles ?? [];

  const handleTest = useCallback(async () => {
    if (!url) {
      toast.error('Set the Lidarr URL before testing.');
      return;
    }
    if (!editingKey) {
      toast.warning('Click "Change" to enter a new API key before testing.');
      return;
    }
    if (!apiKey) {
      toast.error('Enter an API key before testing.');
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiPost<TestResponse>('/api/settings/lidarr/test', {
        url,
        apiKey,
      });
      setTestResult(res);
      if (res.ok) {
        toast.success(
          res.version
            ? `Connected to Lidarr ${res.version}`
            : 'Connected to Lidarr'
        );
      } else {
        toast.error(res.error ?? 'Connection failed');
      }
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Connection test failed';
      setTestResult({ ok: false, error: msg });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  }, [apiKey, editingKey, toast, url]);

  const dirty = useMemo(() => {
    if (url !== (settings.lidarrUrl ?? '')) return true;
    if (editingKey && apiKey) return true;
    if (rootFolder !== (settings.lidarrRootFolderPath ?? '')) return true;
    if ((qualityId || null) !== (settings.lidarrQualityProfileId ?? null))
      return true;
    if ((metadataId || null) !== (settings.lidarrMetadataProfileId ?? null))
      return true;
    return false;
  }, [
    apiKey,
    editingKey,
    metadataId,
    qualityId,
    rootFolder,
    settings.lidarrMetadataProfileId,
    settings.lidarrQualityProfileId,
    settings.lidarrRootFolderPath,
    settings.lidarrUrl,
    url,
  ]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {};
      if (url && url !== (settings.lidarrUrl ?? '')) body.url = url;
      if (editingKey && apiKey) body.apiKey = apiKey;
      if (rootFolder && rootFolder !== (settings.lidarrRootFolderPath ?? '')) {
        body.rootFolderPath = rootFolder;
      }
      if (
        qualityId &&
        qualityId !== (settings.lidarrQualityProfileId ?? '')
      ) {
        body.qualityProfileId = qualityId;
      }
      if (
        metadataId &&
        metadataId !== (settings.lidarrMetadataProfileId ?? '')
      ) {
        body.metadataProfileId = metadataId;
      }
      if (Object.keys(body).length === 0) {
        toast.info('No changes to save.');
        setSaving(false);
        return;
      }
      await apiPatch('/api/settings/lidarr', body);
      toast.success('Lidarr settings saved');
      // If URL or API key changed, the previously cached profiles list may
      // be stale (different Lidarr instance). Refetch.
      if (body.url || body.apiKey) {
        await refetchProfiles();
      }
      onSaved();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : 'Failed to save settings';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }, [
    apiKey,
    editingKey,
    metadataId,
    onSaved,
    qualityId,
    refetchProfiles,
    rootFolder,
    settings.lidarrMetadataProfileId,
    settings.lidarrQualityProfileId,
    settings.lidarrRootFolderPath,
    settings.lidarrUrl,
    toast,
    url,
  ]);

  return (
    <Card header="Lidarr">
      <div className="space-y-4">
        <Input
          label="Lidarr URL"
          placeholder="http://lidarr.local:8686"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoComplete="off"
        />

        <div>
          {!editingKey ? (
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium text-[var(--text-secondary)]">
                API key
              </span>
              <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm">
                <code className="text-[var(--text-primary)]">
                  {settings.lidarrApiKey ?? 'Not configured'}
                </code>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setEditingKey(true)}
                >
                  {settings.lidarrApiKey ? 'Change' : 'Set'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Input
                label="New API key"
                type="password"
                placeholder="Paste new Lidarr API key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditingKey(false);
                  setApiKey('');
                }}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            onClick={handleTest}
            loading={testing}
            disabled={testing || !editingKey || !apiKey || !url}
          >
            Test connection
          </Button>
          {testResult && (
            <span
              className={
                testResult.ok ? 'text-emerald-300' : 'text-red-300'
              }
            >
              {testResult.ok ? (
                <CheckCircleIcon className="inline h-4 w-4 align-text-bottom" />
              ) : (
                <ExclamationCircleIcon className="inline h-4 w-4 align-text-bottom" />
              )}
              <span className="ml-1 text-xs">
                {testResult.ok
                  ? `Connected${testResult.version ? ` (v${testResult.version})` : ''}`
                  : (testResult.error ?? 'Connection failed')}
              </span>
            </span>
          )}
        </div>

        <hr className="border-[var(--border)]" />

        {profilesError && (
          <p className="text-xs text-red-400">
            Could not load profiles:{' '}
            {profilesError instanceof ApiError
              ? profilesError.message
              : 'Unknown error'}
          </p>
        )}

        <Select
          label="Root folder"
          value={rootFolder}
          onChange={(e) => setRootFolder(e.target.value)}
          disabled={profilesLoading || rootFolderOptions.length === 0}
        >
          <option value="">
            {profilesLoading
              ? 'Loading…'
              : rootFolderOptions.length === 0
                ? 'No root folders available'
                : 'Select a root folder'}
          </option>
          {rootFolderOptions.map((rf) => (
            <option key={rf.id} value={rf.path}>
              {rf.path}
              {rf.freeSpace !== undefined ? ` — ${formatBytes(rf.freeSpace)} free` : ''}
            </option>
          ))}
          {/* If saved value isn't in the list (stale), keep it visible. */}
          {rootFolder && !rootFolderOptions.some((rf) => rf.path === rootFolder) && (
            <option value={rootFolder}>{rootFolder} (current)</option>
          )}
        </Select>

        <Select
          label="Quality profile"
          value={qualityId === '' ? '' : String(qualityId)}
          onChange={(e) =>
            setQualityId(e.target.value ? Number(e.target.value) : '')
          }
          disabled={profilesLoading || qualityOptions.length === 0}
        >
          <option value="">
            {profilesLoading
              ? 'Loading…'
              : qualityOptions.length === 0
                ? 'No quality profiles available'
                : 'Select a quality profile'}
          </option>
          {qualityOptions.map((qp) => (
            <option key={qp.id} value={qp.id}>
              {qp.name}
            </option>
          ))}
          {qualityId &&
            !qualityOptions.some((qp) => qp.id === qualityId) && (
              <option value={String(qualityId)}>Profile #{qualityId} (current)</option>
            )}
        </Select>

        <Select
          label="Metadata profile"
          value={metadataId === '' ? '' : String(metadataId)}
          onChange={(e) =>
            setMetadataId(e.target.value ? Number(e.target.value) : '')
          }
          disabled={profilesLoading || metadataOptions.length === 0}
        >
          <option value="">
            {profilesLoading
              ? 'Loading…'
              : metadataOptions.length === 0
                ? 'No metadata profiles available'
                : 'Select a metadata profile'}
          </option>
          {metadataOptions.map((mp) => (
            <option key={mp.id} value={mp.id}>
              {mp.name}
            </option>
          ))}
          {metadataId &&
            !metadataOptions.some((mp) => mp.id === metadataId) && (
              <option value={String(metadataId)}>
                Profile #{metadataId} (current)
              </option>
            )}
        </Select>

        <div className="flex justify-end">
          <Button
            variant="primary"
            onClick={handleSave}
            loading={saving}
            disabled={saving || !dirty}
          >
            Save changes
          </Button>
        </div>
      </div>
    </Card>
  );
};

export default LidarrConfigCard;
