import React, { useCallback, useEffect, useState } from 'react';

import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { useToast } from '../ui/Toast';
import { ApiError, apiPatch } from '../../lib/api';

export interface LastfmConfigCardProps {
  apiKeyRedacted: string | null;
  onSaved: () => void;
}

/**
 * Last.fm config card. Optional integration: when not configured the
 * Discover page shows an empty state. Admin can paste a key, save, or
 * clear the existing one.
 */
export const LastfmConfigCard: React.FC<LastfmConfigCardProps> = ({
  apiKeyRedacted,
  onSaved,
}) => {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    setEditing(false);
    setApiKey('');
  }, [apiKeyRedacted]);

  const handleSave = useCallback(async () => {
    if (!apiKey) {
      toast.error('Enter an API key before saving.');
      return;
    }
    setSaving(true);
    try {
      await apiPatch('/api/settings/lastfm', { apiKey });
      toast.success('Last.fm key saved');
      onSaved();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : 'Failed to save Last.fm key';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }, [apiKey, onSaved, toast]);

  const handleClear = useCallback(async () => {
    setClearing(true);
    try {
      await apiPatch('/api/settings/lastfm', { apiKey: null });
      toast.success('Last.fm key cleared');
      onSaved();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : 'Failed to clear Last.fm key';
      toast.error(msg);
    } finally {
      setClearing(false);
    }
  }, [onSaved, toast]);

  return (
    <Card header="Last.fm">
      <div className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">
          Optional. The Last.fm API key powers the Discover page (top albums,
          top artists, new releases). Leave it unset to skip Discover.{' '}
          <a
            className="text-indigo-300 hover:underline"
            href="https://www.last.fm/api/account/create"
            target="_blank"
            rel="noopener noreferrer"
          >
            Get an API key
          </a>
          .
        </p>

        {!editing ? (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-[var(--text-secondary)]">
              API key
            </span>
            <div className="flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--bg-input)] px-3 py-2 text-sm">
              <code className="text-[var(--text-primary)]">
                {apiKeyRedacted ?? 'Not configured'}
              </code>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setEditing(true)}
              >
                {apiKeyRedacted ? 'Change' : 'Set'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Input
              label="New API key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
            />
            <div className="flex gap-2">
              <Button
                variant="primary"
                onClick={handleSave}
                loading={saving}
                disabled={saving || !apiKey}
              >
                Save
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setApiKey('');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {apiKeyRedacted && !editing && (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              loading={clearing}
              disabled={clearing}
              className="text-red-400 hover:text-red-300"
            >
              Clear key
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
};

export default LastfmConfigCard;
