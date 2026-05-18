/**
 * Resolve the running Overhearr package version for User-Agent strings.
 *
 * The compiled layout is `dist/server/...` (see server/tsconfig.json:outDir),
 * but the runtime image places `package.json` at `/app/package.json` (see
 * Dockerfile stage 3). A single relative path therefore won't reach the
 * file in every layout — local `tsx watch` runs from `server/...` (so
 * `../../package.json` works), the compiled `dist/server/...` runs need
 * `../../../package.json`, and the Dockerfile-mounted layout has it at
 * `/app/package.json` (cwd at startup).
 *
 * Try every plausible candidate; return the first one whose `name` matches
 * `overhearr`. Fall back to `'0.0.0'` if none resolve — UA strings are
 * informational, not load-bearing.
 */

import { readFileSync } from 'fs';
import path from 'path';

const FALLBACK = '0.0.0';

export function readPackageVersion(callerDirname: string): string {
  const candidates = [
    // server/api/<x>/index.ts running under tsx watch
    path.resolve(callerDirname, '../../../package.json'),
    // dist/server/api/<x>/index.js running compiled
    path.resolve(callerDirname, '../../../../package.json'),
    // Direct sibling — covers `dist/index.js` if anyone moves the entry.
    path.resolve(callerDirname, '../package.json'),
    // CWD fallback — Docker runtime starts at /app where package.json lives.
    path.resolve(process.cwd(), 'package.json'),
  ];
  for (const p of candidates) {
    try {
      const raw = readFileSync(p, 'utf8');
      const parsed = JSON.parse(raw) as { name?: string; version?: string };
      if (parsed.name === 'overhearr' && parsed.version) return parsed.version;
    } catch {
      // try next candidate
    }
  }
  return FALLBACK;
}

export function buildUserAgent(callerDirname: string): string {
  return `Overhearr/${readPackageVersion(callerDirname)} ( https://github.com/dcurlewis/overhearr )`;
}
