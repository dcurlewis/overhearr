import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  EyeSlashIcon,
} from '@heroicons/react/24/outline';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useToast } from '../ui/Toast';
import { ApiError, apiGet, apiPatch, apiPost } from '../../lib/api';

interface LidarrConnectionStepProps {
  onAdvance: () => void;
}

interface LidarrForm {
  url: string;
  apiKey: string;
}

interface RedactedSettings {
  lidarrUrl: string | null;
  lidarrApiKey: string | null; // redacted, e.g. "••••••••aabb"
}

interface LidarrTestResponse {
  ok: boolean;
  version?: string | null;
  instanceName?: string | null;
  error?: string;
}

interface TestSuccess {
  url: string;
  apiKey: string;
  version: string | null;
  instanceName: string | null;
}

const URL_RE = /^https?:\/\/.+/i;

export const LidarrConnectionStep: React.FC<LidarrConnectionStepProps> = ({
  onAdvance,
}) => {
  const toast = useToast();

  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState<TestSuccess | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [savedKeyHint, setSavedKeyHint] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
    getValues,
  } = useForm<LidarrForm>({
    defaultValues: { url: '', apiKey: '' },
    mode: 'onTouched',
  });

  const urlValue = watch('url');
  const apiKeyValue = watch('apiKey');

  // Pre-fill from saved settings on mount. The API key is redacted, so we
  // can't pre-fill the field — but we can show a hint that one is saved.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cur = await apiGet<RedactedSettings>('/api/settings');
        if (cancelled) return;
        if (cur.lidarrUrl) setValue('url', cur.lidarrUrl);
        if (cur.lidarrApiKey) setSavedKeyHint(cur.lidarrApiKey);
      } catch {
        // Non-fatal — endpoint requires admin; if we somehow aren't admin
        // yet the form just stays empty.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setValue]);

  // If the user changes URL or key after a successful test, invalidate it.
  useEffect(() => {
    if (
      testSuccess &&
      (testSuccess.url !== urlValue || testSuccess.apiKey !== apiKeyValue)
    ) {
      setTestSuccess(null);
    }
  }, [urlValue, apiKeyValue, testSuccess]);

  const handleTest = async () => {
    setServerError(null);
    setTestError(null);
    const url = getValues('url').trim();
    const apiKey = getValues('apiKey').trim();
    if (!URL_RE.test(url)) {
      setTestError('Enter a valid http(s) URL before testing.');
      return;
    }
    if (!apiKey) {
      setTestError('Enter the API key before testing.');
      return;
    }

    setTesting(true);
    try {
      const res = await apiPost<LidarrTestResponse>(
        '/api/settings/lidarr/test',
        { url, apiKey }
      );
      if (res.ok) {
        setTestSuccess({
          url,
          apiKey,
          version: res.version ?? null,
          instanceName: res.instanceName ?? null,
        });
        setTestError(null);
      } else {
        setTestSuccess(null);
        setTestError(res.error ?? 'Could not connect to Lidarr.');
      }
    } catch (err) {
      setTestSuccess(null);
      if (err instanceof ApiError) {
        setTestError(err.message);
      } else {
        setTestError('Unexpected error. Please try again.');
      }
    } finally {
      setTesting(false);
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    if (!testSuccess) {
      setServerError('Run a successful Test connection before continuing.');
      return;
    }
    setServerError(null);
    setSaving(true);
    try {
      await apiPatch('/api/settings/lidarr', {
        url: values.url.trim(),
        apiKey: values.apiKey.trim(),
      });
      toast.success('Lidarr connection saved');
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
  });

  const canSave = Boolean(testSuccess) && !saving && !testing;

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Input
        label="Lidarr URL"
        type="url"
        autoComplete="off"
        autoFocus
        placeholder="http://lidarr.local:8686"
        helperText="The base URL of your Lidarr instance. Must start with http:// or https://."
        error={errors.url?.message}
        {...register('url', {
          required: 'Lidarr URL is required',
          pattern: {
            value: URL_RE,
            message: 'Must start with http:// or https://',
          },
        })}
      />

      <div className="relative">
        <Input
          label="API key"
          type={showKey ? 'text' : 'password'}
          autoComplete="off"
          placeholder={savedKeyHint ?? 'Lidarr API key'}
          helperText={
            savedKeyHint
              ? `Saved key on file: ${savedKeyHint}. Re-enter to update.`
              : 'Find this in Lidarr → Settings → General → Security.'
          }
          error={errors.apiKey?.message}
          {...register('apiKey', { required: 'API key is required' })}
        />
        <button
          type="button"
          onClick={() => setShowKey((s) => !s)}
          aria-label={showKey ? 'Hide API key' : 'Show API key'}
          className="absolute right-2 top-7 rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          {showKey ? (
            <EyeSlashIcon className="h-5 w-5" />
          ) : (
            <EyeIcon className="h-5 w-5" />
          )}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={handleTest}
          loading={testing}
        >
          Test connection
        </Button>
        {testSuccess && (
          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-300">
            <CheckCircleIcon className="h-5 w-5" aria-hidden="true" />
            Connected
            {testSuccess.version
              ? ` to Lidarr v${testSuccess.version}`
              : ' to Lidarr'}
            {testSuccess.instanceName && ` (${testSuccess.instanceName})`}
          </span>
        )}
      </div>

      {testError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300"
        >
          <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{testError}</span>
        </div>
      )}

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
          disabled={!canSave}
        >
          Save & continue
        </Button>
      </div>
    </form>
  );
};

export default LidarrConnectionStep;
