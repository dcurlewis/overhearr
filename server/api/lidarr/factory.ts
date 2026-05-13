/**
 * Factory for the LidarrClient.
 *
 * Returns a singleton client built from the persisted (encrypted) Lidarr
 * settings. Cached on `(url, apiKey)` so flipping a setting field that does
 * NOT change the connection (e.g. rootFolderPath) does not rebuild the
 * underlying axios instance.
 *
 * The settings service calls `lidarrClientCache.invalidate()` whenever the
 * Lidarr connection settings are updated, so the next `getLidarrClient()`
 * call returns a fresh instance.
 */

import {
  registerLidarrClientInvalidator,
  settingsService,
} from '../../services/settingsService';
import { LidarrClient } from './index';

interface CachedClient {
  url: string;
  apiKey: string;
  client: LidarrClient;
}

class LidarrClientCache {
  private cached: CachedClient | null = null;

  get(url: string, apiKey: string): LidarrClient | null {
    if (
      this.cached &&
      this.cached.url === url &&
      this.cached.apiKey === apiKey
    ) {
      return this.cached.client;
    }
    return null;
  }

  set(url: string, apiKey: string, client: LidarrClient): void {
    this.cached = { url, apiKey, client };
  }

  invalidate(): void {
    this.cached = null;
  }
}

export const lidarrClientCache = new LidarrClientCache();

// Wire up the settings-service invalidation hook so an admin updating Lidarr
// URL/key produces a fresh client on the next request. Idempotent at module
// load; running it twice (e.g. ESM hot-reload) just adds an extra no-op
// invalidator.
registerLidarrClientInvalidator(() => lidarrClientCache.invalidate());

/**
 * Returns a configured `LidarrClient`, or `null` when Lidarr is not yet
 * configured. Routes that need Lidarr should treat `null` as a 400/precondition
 * failure.
 */
export async function getLidarrClient(): Promise<LidarrClient | null> {
  const cfg = await settingsService.getDecryptedLidarrConfig();
  if (!cfg) return null;
  const hit = lidarrClientCache.get(cfg.url, cfg.apiKey);
  if (hit) return hit;
  const client = new LidarrClient({ url: cfg.url, apiKey: cfg.apiKey });
  lidarrClientCache.set(cfg.url, cfg.apiKey, client);
  return client;
}
