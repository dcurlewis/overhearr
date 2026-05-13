import { Router } from 'express';
import { readFileSync } from 'fs';
import path from 'path';

import { prisma } from '../db/prisma';
import { getLogger } from '../lib/logger';
import { settingsService } from '../services/settingsService';

const log = getLogger('health');

interface PackageJson {
  version: string;
}

// Resolve package.json relative to either possible compiled layout
// (`dist/index.js` or `dist/server/routes/health.js`). Fall back to CWD.
const packageJsonCandidates = [
  path.resolve(__dirname, '../../package.json'),
  path.resolve(__dirname, '../../../package.json'),
  path.resolve(process.cwd(), 'package.json'),
];
let appVersion = '0.0.0';
for (const p of packageJsonCandidates) {
  try {
    const raw = readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as { name?: string } & PackageJson;
    if (parsed.name === 'overhearr' && parsed.version) {
      appVersion = parsed.version;
      break;
    }
  } catch {
    // try next candidate
  }
}
if (appVersion === '0.0.0') {
  log.warn({ candidates: packageJsonCandidates }, 'failed to read package.json version');
}

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  let dbStatus: 'ok' | 'error' = 'ok';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    log.error({ err }, 'db health check failed');
    dbStatus = 'error';
  }

  let lidarrConfigured = false;
  try {
    lidarrConfigured = await settingsService.isLidarrConfigured();
  } catch (err) {
    log.warn({ err }, 'failed to read settings for health check');
  }

  const body = {
    status: dbStatus === 'ok' ? 'ok' : 'error',
    version: appVersion,
    uptimeSec: Math.round(process.uptime()),
    db: dbStatus,
    lidarrConfigured,
  };

  res.status(dbStatus === 'ok' ? 200 : 503).json(body);
});

export default healthRouter;
