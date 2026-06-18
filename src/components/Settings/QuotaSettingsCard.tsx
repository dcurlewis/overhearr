import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { ApiError, apiPatch } from '../../lib/api';
import { useToast } from '../ui/Toast';

export interface QuotaSettingsView {
  defaultQuotaActiveLimit: number | null;
  defaultQuotaWeeklyLimit: number | null;
}

export interface QuotaSettingsCardProps {
  settings: QuotaSettingsView;
  onSaved: () => void;
}

/**
 * Optional per-user request quotas (global defaults). Leaving a field empty
 * means "unlimited" for that axis; a positive integer caps it. Quotas only
 * apply to non-admin users, and a per-user override (set on the Users page)
 * takes precedence over these defaults.
 */
export const QuotaSettingsCard: React.FC<QuotaSettingsCardProps> = ({
  settings,
  onSaved,
}) => {
  const toast = useToast();
  const [active, setActive] = useState<string>(
    settings.defaultQuotaActiveLimit?.toString() ?? ''
  );
  const [weekly, setWeekly] = useState<string>(
    settings.defaultQuotaWeeklyLimit?.toString() ?? ''
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setActive(settings.defaultQuotaActiveLimit?.toString() ?? '');
    setWeekly(settings.defaultQuotaWeeklyLimit?.toString() ?? '');
  }, [settings]);

  // Empty string → null (unlimited); otherwise a parsed integer.
  const parse = (v: string): number | null => {
    const t = v.trim();
    if (t === '') return null;
    return Number(t);
  };

  const dirty = useMemo(() => {
    return (
      parse(active) !== (settings.defaultQuotaActiveLimit ?? null) ||
      parse(weekly) !== (settings.defaultQuotaWeeklyLimit ?? null)
    );
  }, [active, weekly, settings]);

  const handleSave = useCallback(async () => {
    const activeVal = parse(active);
    const weeklyVal = parse(weekly);
    if (
      (activeVal !== null && (!Number.isInteger(activeVal) || activeVal <= 0)) ||
      (weeklyVal !== null && (!Number.isInteger(weeklyVal) || weeklyVal <= 0))
    ) {
      toast.error('Limits must be positive whole numbers (or empty for unlimited).');
      return;
    }
    setSaving(true);
    try {
      await apiPatch('/api/settings/quotas', {
        defaultQuotaActiveLimit: activeVal,
        defaultQuotaWeeklyLimit: weeklyVal,
      });
      toast.success('Quota settings saved');
      onSaved();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : 'Failed to save quota settings';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }, [active, weekly, onSaved, toast]);

  return (
    <Card header="Request quotas">
      <div className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">
          Optional limits for non-admin users. Leave a field empty for
          unlimited. A per-user override on the Users page takes precedence
          over these defaults. Admins are never limited.
        </p>
        <Input
          type="number"
          min={1}
          label="Max active requests"
          placeholder="Unlimited"
          helperText="Simultaneous pending or processing requests per user."
          value={active}
          onChange={(e) => setActive(e.target.value)}
        />
        <Input
          type="number"
          min={1}
          label="Max new requests per week"
          placeholder="Unlimited"
          helperText="New requests created in the trailing 7 days, per user."
          value={weekly}
          onChange={(e) => setWeekly(e.target.value)}
        />
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

export default QuotaSettingsCard;
