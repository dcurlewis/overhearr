import { beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../server/db/prisma';
import { ValidationError } from '../../server/lib/errors';
import { SettingsService } from '../../server/services/settingsService';

async function clearDb(): Promise<void> {
  await prisma.session.deleteMany();
  await prisma.musicRequest.deleteMany();
  await prisma.user.deleteMany();
  await prisma.settings.deleteMany();
}

describe('SettingsService', () => {
  let svc: SettingsService;

  beforeEach(async () => {
    await clearDb();
    svc = new SettingsService();
  });

  it('caches the row and avoids re-querying on subsequent reads', async () => {
    // Prisma's delegate methods are exposed via Proxy, which makes vi.spyOn
    // unreliable. Instead we observe caching by mutating the underlying row
    // out-of-band: if the service is hitting the cache, it will NOT see the
    // mutation; if it is re-querying, it WILL.
    const a = await svc.getSettings();
    expect(a.lidarrUrl).toBeNull();
    await prisma.settings.update({
      where: { id: 1 },
      data: { lidarrUrl: 'http://changed-out-of-band' },
    });
    const b = await svc.getSettings();
    // Cache hit: still null, the out-of-band write is invisible.
    expect(b.lidarrUrl).toBeNull();
    expect(b).toEqual(a);
  });

  it('encrypts the Lidarr API key and round-trips it via the service', async () => {
    await svc.updateLidarrSettings({
      url: 'http://lidarr.local:8686',
      apiKey: 'plain-key-abc-9999',
      rootFolderPath: '/music',
      qualityProfileId: 1,
      metadataProfileId: 2,
    });
    // The persisted ciphertext must NOT equal the plaintext, but must
    // decrypt back to it.
    const row = await prisma.settings.findUnique({ where: { id: 1 } });
    expect(row?.lidarrApiKeyEncrypted).toBeTruthy();
    expect(row?.lidarrApiKeyEncrypted).not.toBe('plain-key-abc-9999');
    expect(row?.lidarrApiKeyEncrypted?.startsWith('v1:')).toBe(true);

    const cfg = await svc.getDecryptedLidarrConfig();
    expect(cfg).toEqual({
      url: 'http://lidarr.local:8686',
      apiKey: 'plain-key-abc-9999',
      rootFolderPath: '/music',
      qualityProfileId: 1,
      metadataProfileId: 2,
    });
  });

  it('partial updates preserve previously-saved fields', async () => {
    await svc.updateLidarrSettings({
      url: 'http://lidarr.local:8686',
      apiKey: 'first-key',
      rootFolderPath: '/music',
      qualityProfileId: 1,
      metadataProfileId: 2,
    });
    // Update only qualityProfileId.
    await svc.updateLidarrSettings({ qualityProfileId: 7 });
    const cfg = await svc.getDecryptedLidarrConfig();
    expect(cfg).toEqual({
      url: 'http://lidarr.local:8686',
      apiKey: 'first-key',
      rootFolderPath: '/music',
      qualityProfileId: 7,
      metadataProfileId: 2,
    });
  });

  it('rejects non-http URLs and non-positive integer profiles', async () => {
    await expect(
      svc.updateLidarrSettings({ url: 'ftp://nope' })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      svc.updateLidarrSettings({ qualityProfileId: 0 })
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      svc.updateLidarrSettings({ metadataProfileId: -1 })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('isLidarrConfigured returns true only when ALL fields are set', async () => {
    expect(await svc.isLidarrConfigured()).toBe(false);
    await svc.updateLidarrSettings({
      url: 'http://lidarr.local:8686',
      apiKey: 'k',
      rootFolderPath: '/music',
      qualityProfileId: 1,
    });
    expect(await svc.isLidarrConfigured()).toBe(false);
    await svc.updateLidarrSettings({ metadataProfileId: 2 });
    expect(await svc.isLidarrConfigured()).toBe(true);
  });

  it('markSetupCompleted refuses an incomplete config and accepts a full one', async () => {
    await expect(svc.markSetupCompleted()).rejects.toBeInstanceOf(ValidationError);
    await svc.updateLidarrSettings({
      url: 'http://lidarr.local:8686',
      apiKey: 'k',
      rootFolderPath: '/music',
      qualityProfileId: 1,
      metadataProfileId: 2,
    });
    const updated = await svc.markSetupCompleted();
    expect(updated.setupCompleted).toBe(true);
  });

  it('writes invalidate the cache so the next read sees the new row', async () => {
    const first = await svc.getSettings();
    expect(first.lidarrUrl).toBeNull();
    await svc.updateLidarrSettings({ url: 'http://x.local' });
    const after = await svc.getSettings();
    expect(after.lidarrUrl).toBe('http://x.local');
  });
});
