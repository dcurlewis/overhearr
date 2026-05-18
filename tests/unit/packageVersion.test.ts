/**
 * `readPackageVersion` lookup must work from every plausible runtime
 * layout: tsx-watch dev (`server/...`), compiled (`dist/server/...`), and
 * the Dockerfile's runtime layout where `package.json` sits at `/app/`
 * (matching `process.cwd()` at startup).
 *
 * Regression for a real bug: the original ListenBrainz client did
 * `require('../../../package.json')` at import time, which crashes in
 * production because the compiled client at `dist/server/api/.../index.js`
 * resolves that to `dist/package.json` (which doesn't exist).
 */

import { describe, expect, it } from 'vitest';
import path from 'path';

import { buildUserAgent, readPackageVersion } from '../../server/lib/packageVersion';

const REPO_ROOT = path.resolve(__dirname, '../..');

describe('readPackageVersion', () => {
  it('resolves the real version when called from the live server tree', () => {
    // Equivalent to the location of server/api/musicbrainz/index.ts under tsx watch.
    const fakeDirname = path.join(REPO_ROOT, 'server/api/musicbrainz');
    const v = readPackageVersion(fakeDirname);
    expect(v).not.toBe('0.0.0');
    expect(v).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('resolves the real version from a simulated dist/server/api path', () => {
    // Simulates `dist/server/api/listenbrainz/index.js`. This path does not
    // exist on disk, but the helper's CWD fallback (`process.cwd()` is the
    // repo root during tests) must still find package.json.
    const fakeDist = path.join(REPO_ROOT, 'dist/server/api/listenbrainz');
    const v = readPackageVersion(fakeDist);
    expect(v).not.toBe('0.0.0');
    expect(v).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('falls back to "0.0.0" when no candidate path resolves and CWD is wrong', () => {
    // Use a path so deep that none of the candidate `..`-parents reach
    // anything plausible, AND temporarily move CWD off the repo so the
    // process.cwd() fallback also misses.
    const original = process.cwd();
    try {
      process.chdir('/tmp');
      const v = readPackageVersion('/some/totally/unrelated/path');
      expect(v).toBe('0.0.0');
    } finally {
      process.chdir(original);
    }
  });

  it('buildUserAgent embeds the version in the documented shape', () => {
    const fakeDirname = path.join(REPO_ROOT, 'server/api/musicbrainz');
    const ua = buildUserAgent(fakeDirname);
    expect(ua).toMatch(
      /^Overhearr\/\d+\.\d+\.\d+(?:[^\s]*)? \( https:\/\/github\.com\/dcurlewis\/overhearr \)$/
    );
  });
});
