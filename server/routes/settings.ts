import type { Settings } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

import { LidarrClient } from '../api/lidarr';
import { getLidarrClient } from '../api/lidarr/factory';
import { decryptSecret, redactSecret } from '../lib/crypto';
import {
  AppError,
  LidarrAuthError,
  LidarrError,
  LidarrMetadataUnavailableError,
  LidarrUnreachableError,
  ValidationError,
} from '../lib/errors';
import { getLogger } from '../lib/logger';
import { requireAdmin } from '../middleware/auth';
import { requireCsrfHeader } from '../middleware/csrf';
import { runLibrarySyncOnce } from '../services/librarySyncWorker';
import { settingsService } from '../services/settingsService';

const log = getLogger('settings');

export const settingsRouter = Router();

// Admin-only on every settings route, even GET — settings contain
// infrastructure details we do not want to leak to non-admin users.
settingsRouter.use(requireAdmin);
// CSRF check applies only to mutating methods; safe to mount once.
settingsRouter.use(requireCsrfHeader);

interface RedactedSettings {
  lidarrUrl: string | null;
  lidarrApiKey: string | null;
  lidarrRootFolderPath: string | null;
  lidarrQualityProfileId: number | null;
  lidarrMetadataProfileId: number | null;
  setupCompleted: boolean;
  defaultQuotaActiveLimit: number | null;
  defaultQuotaWeeklyLimit: number | null;
  createdAt: Date;
  updatedAt: Date;
}

function safeDecryptForRedaction(blob: string | null): string | null {
  if (!blob) return null;
  try {
    return decryptSecret(blob);
  } catch (err) {
    log.error({ err }, 'failed to decrypt secret for redaction');
    return null;
  }
}

function toRedacted(s: Settings): RedactedSettings {
  // Redact the PLAINTEXT last-4 (so the UI shows a stable "••••••••f8e9"
  // hint to the admin who set it). Decrypting here is safe: the response is
  // only ever sent to admins.
  const lidarrPlain = safeDecryptForRedaction(s.lidarrApiKeyEncrypted);
  return {
    lidarrUrl: s.lidarrUrl,
    lidarrApiKey: redactSecret(lidarrPlain),
    lidarrRootFolderPath: s.lidarrRootFolderPath,
    lidarrQualityProfileId: s.lidarrQualityProfileId,
    lidarrMetadataProfileId: s.lidarrMetadataProfileId,
    setupCompleted: s.setupCompleted,
    defaultQuotaActiveLimit: s.defaultQuotaActiveLimit,
    defaultQuotaWeeklyLimit: s.defaultQuotaWeeklyLimit,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

settingsRouter.get('/', async (_req, res, next) => {
  try {
    const s = await settingsService.getSettings();
    res.json(toRedacted(s));
  } catch (err) {
    next(err);
  }
});

const lidarrPatchSchema = z
  .object({
    url: z.string().url().optional(),
    // Empty-string apiKey is silently ignored so the UI can resubmit the form
    // without the user re-entering the key.
    apiKey: z.string().optional(),
    rootFolderPath: z.string().min(1).optional(),
    qualityProfileId: z.number().int().positive().optional(),
    metadataProfileId: z.number().int().positive().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field is required',
  });

settingsRouter.patch('/lidarr', async (req, res, next) => {
  try {
    const parsed = lidarrPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? 'Invalid request body'
      );
    }
    const input = { ...parsed.data };
    if (input.apiKey === '' || input.apiKey === undefined) {
      delete input.apiKey;
    }
    const updated = await settingsService.updateLidarrSettings(input);
    res.json(toRedacted(updated));
  } catch (err) {
    next(err);
  }
});

const lidarrTestSchema = z.object({
  url: z.string().url(),
  apiKey: z.string().min(1),
});

/**
 * Verify a Lidarr URL+key reach a real instance. Returns 200 with
 * `{ok:false, error}` for upstream/connection problems so the UI can show
 * the failure inline; only unexpected (non-AppError) crashes propagate as
 * 500. This endpoint NEVER persists anything.
 */
settingsRouter.post('/lidarr/test', async (req, res, next) => {
  try {
    const parsed = lidarrTestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? 'Invalid request body'
      );
    }
    const { url, apiKey } = parsed.data;
    // Construct a fresh client so we can validate un-saved candidate values.
    const client = new LidarrClient({ url, apiKey, timeoutMs: 10_000 });
    try {
      const status = await client.testConnection();
      res.json({
        ok: true,
        version: status.version || null,
        instanceName: status.instanceName ?? null,
      });
    } catch (err) {
      if (err instanceof LidarrAuthError) {
        return res.json({
          ok: false,
          error: 'Lidarr rejected the API key (auth failed)',
        });
      }
      if (err instanceof LidarrUnreachableError) {
        // err.message already starts with "Lidarr is unreachable" — pass
        // through as-is.
        return res.json({ ok: false, error: err.message });
      }
      if (err instanceof LidarrMetadataUnavailableError) {
        return res.json({ ok: false, error: err.message });
      }
      if (err instanceof LidarrError) {
        return res.json({ ok: false, error: err.message });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

settingsRouter.get('/lidarr/profiles', async (_req, res, next) => {
  try {
    const cfg = await settingsService.getSettings();
    if (!cfg.lidarrUrl || !cfg.lidarrApiKeyEncrypted) {
      throw new ValidationError('Lidarr URL and API key must be configured first');
    }
    // The full-config factory requires every Lidarr field; here we only have
    // URL+key (the whole point of this endpoint is to populate the missing
    // dropdowns), so build a one-off client.
    const apiKey = decryptSecret(cfg.lidarrApiKeyEncrypted);
    const client = new LidarrClient({
      url: cfg.lidarrUrl,
      apiKey,
      timeoutMs: 10_000,
    });

    try {
      const [rootFolders, qualityProfiles, metadataProfiles] = await Promise.all([
        client.getRootFolders(),
        client.getQualityProfiles(),
        client.getMetadataProfiles(),
      ]);
      res.json({ rootFolders, qualityProfiles, metadataProfiles });
    } catch (err) {
      // Bubble Lidarr* errors up via the central error handler (502/401).
      if (err instanceof AppError) throw err;
      log.error({ err }, 'unexpected error fetching lidarr profiles');
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// Each quota field accepts a positive integer (a limit) or null (unlimited).
// `nullable()` lets the UI explicitly clear a default; omitting a field
// leaves it untouched.
const quotaPatchSchema = z
  .object({
    defaultQuotaActiveLimit: z.number().int().positive().nullable().optional(),
    defaultQuotaWeeklyLimit: z.number().int().positive().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'At least one field is required',
  });

/**
 * Update the global default request quotas. Admin-only + CSRF-protected
 * (both enforced by the router-level middleware above).
 */
settingsRouter.patch('/quotas', async (req, res, next) => {
  try {
    const parsed = quotaPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? 'Invalid request body'
      );
    }
    const updated = await settingsService.updateQuotaSettings(parsed.data);
    res.json(toRedacted(updated));
  } catch (err) {
    next(err);
  }
});

/**
 * Force a library-sync pass now. Returns the same summary as the periodic
 * worker. Admin-only (already enforced by `settingsRouter.use(requireAdmin)`
 * above) and CSRF-protected.
 */
settingsRouter.post('/library-sync', async (_req, res, next) => {
  try {
    const summary = await runLibrarySyncOnce();
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// Re-export the factory for the rest of the app to use; routes/settings is a
// natural single import surface for "I need a Lidarr client".
export { getLidarrClient };

export default settingsRouter;
