import type { Settings } from '@prisma/client';

import { prisma } from '../db/prisma';
import { decryptSecret, encryptSecret } from '../lib/crypto';
import { ValidationError } from '../lib/errors';

/**
 * Optional invalidation hook the LidarrClient factory registers. We avoid a
 * direct `import` from `../api/lidarr/factory` to keep the dependency edge
 * one-directional (factory → settingsService) and to keep this module
 * importable in test contexts that never touch the Lidarr client.
 */
type InvalidateFn = () => void;
const lidarrClientInvalidators: InvalidateFn[] = [];
export function registerLidarrClientInvalidator(fn: InvalidateFn): void {
  lidarrClientInvalidators.push(fn);
}
function invalidateLidarrClient(): void {
  for (const fn of lidarrClientInvalidators) {
    try {
      fn();
    } catch {
      // Invalidators are best-effort; never let one break a setting save.
    }
  }
}

export interface DecryptedLidarrConfig {
  url: string;
  apiKey: string;
  rootFolderPath: string;
  qualityProfileId: number;
  metadataProfileId: number;
}

export interface UpdateLidarrInput {
  url?: string;
  apiKey?: string;
  rootFolderPath?: string;
  qualityProfileId?: number;
  metadataProfileId?: number;
}

/**
 * Global default request-quota update. Each field is optional (omit to leave
 * unchanged); an explicit `null` clears the default (= unlimited for that
 * axis). See server/services/quotaService.ts for the resolution order.
 */
export interface UpdateQuotaInput {
  defaultQuotaActiveLimit?: number | null;
  defaultQuotaWeeklyLimit?: number | null;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate a quota-limit value: a positive integer, or `null` for unlimited.
 * Returns the normalized value to persist.
 */
function normalizeQuotaLimit(
  value: number | null,
  field: string
): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`${field} must be a positive integer or null`);
  }
  return value;
}

/**
 * SettingsService — singleton wrapper around the singleton Settings row.
 *
 * The row id is always 1. We keep an in-memory cache so high-traffic reads
 * (every authenticated request hits /api/health, every search calls
 * isLidarrConfigured indirectly, etc.) do not round-trip to SQLite. The
 * cache is invalidated on every write within this process. Multi-process
 * deployments are out of scope (Overhearr ships as a single container).
 */
export class SettingsService {
  private cache: Settings | null = null;
  private inflight: Promise<Settings> | null = null;

  private async loadFromDb(): Promise<Settings> {
    return prisma.settings.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });
  }

  /**
   * Returns the cached settings row, loading from DB on first call.
   * Concurrent first-callers share a single in-flight promise.
   */
  async getSettings(): Promise<Settings> {
    if (this.cache) return this.cache;
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      try {
        const row = await this.loadFromDb();
        this.cache = row;
        return row;
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  /** Discard any cached row. Tests and write paths call this. */
  invalidate(): void {
    this.cache = null;
  }

  async getDecryptedLidarrConfig(): Promise<DecryptedLidarrConfig | null> {
    const s = await this.getSettings();
    if (
      !s.lidarrUrl ||
      !s.lidarrApiKeyEncrypted ||
      !s.lidarrRootFolderPath ||
      s.lidarrQualityProfileId == null ||
      s.lidarrMetadataProfileId == null
    ) {
      return null;
    }
    return {
      url: s.lidarrUrl,
      apiKey: decryptSecret(s.lidarrApiKeyEncrypted),
      rootFolderPath: s.lidarrRootFolderPath,
      qualityProfileId: s.lidarrQualityProfileId,
      metadataProfileId: s.lidarrMetadataProfileId,
    };
  }

  async isLidarrConfigured(): Promise<boolean> {
    const cfg = await this.getDecryptedLidarrConfig();
    return cfg !== null;
  }

  async updateLidarrSettings(input: UpdateLidarrInput): Promise<Settings> {
    const data: Record<string, unknown> = {};

    if (input.url !== undefined) {
      if (!isHttpUrl(input.url)) {
        throw new ValidationError('Lidarr URL must start with http:// or https://');
      }
      data.lidarrUrl = input.url;
    }
    if (input.apiKey !== undefined) {
      if (typeof input.apiKey !== 'string' || input.apiKey.length === 0) {
        throw new ValidationError('Lidarr API key must be a non-empty string');
      }
      data.lidarrApiKeyEncrypted = encryptSecret(input.apiKey);
    }
    if (input.rootFolderPath !== undefined) {
      if (typeof input.rootFolderPath !== 'string' || input.rootFolderPath.length === 0) {
        throw new ValidationError('Lidarr root folder path is required');
      }
      data.lidarrRootFolderPath = input.rootFolderPath;
    }
    if (input.qualityProfileId !== undefined) {
      if (!Number.isInteger(input.qualityProfileId) || input.qualityProfileId <= 0) {
        throw new ValidationError('qualityProfileId must be a positive integer');
      }
      data.lidarrQualityProfileId = input.qualityProfileId;
    }
    if (input.metadataProfileId !== undefined) {
      if (!Number.isInteger(input.metadataProfileId) || input.metadataProfileId <= 0) {
        throw new ValidationError('metadataProfileId must be a positive integer');
      }
      data.lidarrMetadataProfileId = input.metadataProfileId;
    }

    const updated = await prisma.settings.upsert({
      where: { id: 1 },
      update: data,
      create: { id: 1, ...data },
    });
    this.cache = updated;
    // Lidarr connection details may have changed; force the client factory
    // to rebuild on next use.
    invalidateLidarrClient();
    return updated;
  }

  /**
   * Update the global default request quotas. Each axis accepts a positive
   * integer (a limit) or `null` (unlimited). Omitted fields are untouched.
   */
  async updateQuotaSettings(input: UpdateQuotaInput): Promise<Settings> {
    const data: Record<string, unknown> = {};

    if (input.defaultQuotaActiveLimit !== undefined) {
      data.defaultQuotaActiveLimit = normalizeQuotaLimit(
        input.defaultQuotaActiveLimit,
        'defaultQuotaActiveLimit'
      );
    }
    if (input.defaultQuotaWeeklyLimit !== undefined) {
      data.defaultQuotaWeeklyLimit = normalizeQuotaLimit(
        input.defaultQuotaWeeklyLimit,
        'defaultQuotaWeeklyLimit'
      );
    }

    const updated = await prisma.settings.upsert({
      where: { id: 1 },
      update: data,
      create: { id: 1, ...data },
    });
    this.cache = updated;
    return updated;
  }

  async markSetupCompleted(): Promise<Settings> {
    const cfg = await this.getDecryptedLidarrConfig();
    if (!cfg) {
      throw new ValidationError(
        'Cannot complete setup: Lidarr is not fully configured'
      );
    }
    const updated = await prisma.settings.update({
      where: { id: 1 },
      data: { setupCompleted: true },
    });
    this.cache = updated;
    return updated;
  }
}

export const settingsService = new SettingsService();
