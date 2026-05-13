import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { useToast } from '../ui/Toast';
import { ApiError, apiPatch } from '../../lib/api';

interface LastfmStepProps {
  onAdvance: () => void;
  onSkip: () => void;
}

interface LastfmForm {
  apiKey: string;
}

export const LastfmStep: React.FC<LastfmStepProps> = ({ onAdvance, onSkip }) => {
  const toast = useToast();

  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LastfmForm>({
    defaultValues: { apiKey: '' },
    mode: 'onTouched',
  });

  const onSubmit = handleSubmit(async (values) => {
    const trimmed = values.apiKey.trim();
    if (!trimmed) {
      // Treat empty submit as skip — gentler than forcing a click on Skip.
      onSkip();
      return;
    }
    setServerError(null);
    setSaving(true);
    try {
      await apiPatch('/api/settings/lastfm', { apiKey: trimmed });
      toast.success('Last.fm key saved');
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

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <p className="text-sm text-[var(--text-secondary)]">
        Last.fm powers Overhearr&apos;s Discover page (top albums, top
        artists, new releases). It&apos;s entirely optional — you can request
        any album or artist without it. You can grab a free API key at{' '}
        <span className="font-mono text-[var(--text-primary)]">
          https://www.last.fm/api/account/create
        </span>
        .
      </p>

      <Input
        label="Last.fm API key"
        type="text"
        autoComplete="off"
        autoFocus
        placeholder="Optional — leave blank to skip"
        helperText="Last.fm keys are 32 hex characters."
        error={errors.apiKey?.message}
        {...register('apiKey', {
          validate: (v) => {
            const t = v.trim();
            if (t.length === 0) return true;
            if (t.length < 8) return 'Key looks too short';
            return true;
          },
        })}
      />

      {serverError && (
        <div
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300"
        >
          {serverError}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button type="button" variant="ghost" onClick={onSkip} disabled={saving}>
          Skip for now
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          Save & continue
        </Button>
      </div>
    </form>
  );
};

export default LastfmStep;
