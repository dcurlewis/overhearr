/**
 * Playwright route handlers that intercept every browser-facing /api/*
 * call. The dev server keeps serving the HTML/JS bundles, but no real
 * backend code (Lidarr, MusicBrainz, Last.fm, the SQLite DB) runs during
 * E2E. That keeps tests deterministic, fast, and lets us demonstrate the
 * golden path even though the user's real Lidarr is unreachable from this
 * dev machine.
 *
 * Each helper returns void; mutate the supplied `Page` in-place. The
 * bigger `mockHappyPath` composes the smaller helpers.
 */

import type { Page, Route } from '@playwright/test';
import {
  adminUser,
  albumRequestProcessing,
  artistRequestProcessing,
  asRequestList,
  completedSetupStatus,
  discoverConfigured,
  discoverNotConfigured,
  healthResponse,
  inRainbowsAlbumDetail,
  lidarrProfilesResponse,
  lidarrTestSuccess,
  radioheadArtistDetail,
  reconcileResponse,
  redactedSettings,
  regularUser,
  sampleRequests,
  sampleRequestsWithFailure,
  searchInRainbows,
  usersList,
  virginSetupStatus,
} from './data';
import type { MusicRequestRow, PublicUser, SetupStatusResponse } from '../../../src/types/api';

type RouteState = {
  user: PublicUser | null;
  setupStatus: SetupStatusResponse;
  requests: MusicRequestRow[];
  // Map of album-detail mbid -> override; same for artist
  albumOverrides: Map<string, unknown>;
  artistOverrides: Map<string, unknown>;
  discover: typeof discoverConfigured | typeof discoverNotConfigured;
  // Tracks which fields the wizard has saved, so /api/settings reflects
  // the wizard's progress and the wizard's "computeInitialStep" sees the
  // right resumption point.
  settingsView: typeof redactedSettings;
  // Tracks which album/artist mbids the current user has requested so the
  // detail endpoints can flip their requestStatus accordingly after a POST.
  requestedAlbums: Set<string>;
  requestedArtists: Set<string>;
};

export interface MockHandle {
  state: RouteState;
  setUser(user: PublicUser | null): void;
  setSetupStatus(status: SetupStatusResponse): void;
  setRequests(rows: MusicRequestRow[]): void;
  setDiscover(payload: typeof discoverConfigured | typeof discoverNotConfigured): void;
}

interface MockOptions {
  /** Initial logged-in user. Default: admin. Pass null for guest. */
  user?: PublicUser | null;
  /** Initial setup status. Default: complete. */
  setupStatus?: SetupStatusResponse;
  /** Initial /api/requests payload. Default: empty list. */
  requests?: MusicRequestRow[];
  /** Initial /api/discover payload. Default: configured + populated. */
  discover?: typeof discoverConfigured | typeof discoverNotConfigured;
  /**
   * Initial settings view. Default: fully populated (post-setup). Pass an
   * "empty" view for setup-wizard tests so the wizard starts at the admin
   * step rather than lastfm.
   */
  settingsView?: typeof redactedSettings;
}

const emptySettingsView: typeof redactedSettings = {
  ...redactedSettings,
  lidarrUrl: null as unknown as string,
  lidarrApiKey: null as unknown as string,
  lidarrRootFolderPath: null as unknown as string,
  lidarrQualityProfileId: null as unknown as number,
  lidarrMetadataProfileId: null as unknown as number,
  lastfmApiKey: null as unknown as string,
  setupCompleted: false,
};

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });

const noContent = (route: Route) =>
  route.fulfill({ status: 204, body: '' });

/**
 * Install one route handler per /api/* surface. Returns a handle that lets
 * tests mutate state mid-spec (e.g. log out, swap discover payload).
 */
export async function installApiMocks(
  page: Page,
  opts: MockOptions = {}
): Promise<MockHandle> {
  const state: RouteState = {
    user: opts.user === undefined ? adminUser : opts.user,
    setupStatus: opts.setupStatus ?? completedSetupStatus,
    requests: opts.requests ?? [],
    albumOverrides: new Map(),
    artistOverrides: new Map(),
    discover: opts.discover ?? discoverConfigured,
    settingsView: opts.settingsView ?? redactedSettings,
    requestedAlbums: new Set<string>(),
    requestedArtists: new Set<string>(),
  };

  // ---------- Cover art / next/image / remote images ---------------------
  // Next.js dev's image optimizer fetches remote images server-side, which
  // hangs the request when the test machine can't reach lastfm/CAA. Stub
  // both the client-facing /_next/image proxy AND any direct external image
  // hits with a 1x1 transparent PNG so cards render instantly.
  const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
  const fulfillImage = (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: TINY_PNG,
    });
  await page.route('**/_next/image**', fulfillImage);
  await page.route('https://coverartarchive.org/**', fulfillImage);
  await page.route('https://**.lastfm.freetls.fastly.net/**', fulfillImage);
  await page.route('https://lastfm.freetls.fastly.net/**', fulfillImage);

  // ---------- Setup status ------------------------------------------------
  await page.route('**/api/setup/status', (route) => {
    return json(route, 200, state.setupStatus);
  });

  await page.route('**/api/setup/initialize', (route) => {
    // Promote to "admin exists" so the wizard advances.
    state.user = adminUser;
    state.setupStatus = { setupCompleted: false, hasAdmin: true };
    return json(route, 201, adminUser);
  });

  await page.route('**/api/setup/complete', (route) => {
    state.setupStatus = completedSetupStatus;
    return json(route, 200, { setupCompleted: true });
  });

  // ---------- Auth --------------------------------------------------------
  await page.route('**/api/auth/me', (route) => {
    if (state.user) return json(route, 200, state.user);
    return json(route, 401, { message: 'Not authenticated', code: 'UNAUTHORIZED' });
  });

  await page.route('**/api/auth/login', async (route) => {
    const req = route.request();
    let username = '';
    let password = '';
    try {
      const body = req.postDataJSON() as { username?: string; password?: string };
      username = body?.username ?? '';
      password = body?.password ?? '';
    } catch {
      // ignore
    }
    if (username === 'admin' && password === 'correctpassword1') {
      state.user = adminUser;
      return json(route, 200, adminUser);
    }
    if (username === 'alice' && password === 'correctpassword1') {
      state.user = regularUser;
      return json(route, 200, regularUser);
    }
    return json(route, 401, { message: 'Invalid username or password' });
  });

  await page.route('**/api/auth/logout', (route) => {
    state.user = null;
    return noContent(route);
  });

  // ---------- Settings ----------------------------------------------------
  await page.route('**/api/settings', (route) => {
    if (route.request().method() === 'GET') {
      return json(route, 200, state.settingsView);
    }
    return json(route, 405, { message: 'Method not allowed' });
  });

  await page.route('**/api/settings/lidarr', async (route) => {
    // PATCH — record what the wizard sent so subsequent GETs reflect it.
    try {
      const body = route.request().postDataJSON() as {
        url?: string;
        apiKey?: string;
        rootFolderPath?: string;
        qualityProfileId?: number;
        metadataProfileId?: number;
      };
      if (body?.url !== undefined) state.settingsView.lidarrUrl = body.url;
      if (body?.apiKey !== undefined && body.apiKey)
        state.settingsView.lidarrApiKey = '••••••••' + body.apiKey.slice(-4);
      if (body?.rootFolderPath !== undefined)
        state.settingsView.lidarrRootFolderPath = body.rootFolderPath;
      if (body?.qualityProfileId !== undefined)
        state.settingsView.lidarrQualityProfileId = body.qualityProfileId;
      if (body?.metadataProfileId !== undefined)
        state.settingsView.lidarrMetadataProfileId = body.metadataProfileId;
    } catch {
      // ignore unparseable bodies
    }
    return json(route, 200, state.settingsView);
  });

  await page.route('**/api/settings/lidarr/test', (route) => {
    return json(route, 200, lidarrTestSuccess);
  });

  await page.route('**/api/settings/lidarr/profiles', (route) => {
    return json(route, 200, lidarrProfilesResponse);
  });

  await page.route('**/api/settings/lastfm', async (route) => {
    try {
      const body = route.request().postDataJSON() as { apiKey?: string };
      if (body?.apiKey)
        state.settingsView.lastfmApiKey = '••••••••' + body.apiKey.slice(-4);
    } catch {
      // ignore
    }
    return json(route, 200, state.settingsView);
  });

  // ---------- Health ------------------------------------------------------
  await page.route('**/api/health', (route) => {
    return json(route, 200, healthResponse);
  });

  // ---------- Discover ----------------------------------------------------
  await page.route('**/api/discover', (route) => {
    return json(route, 200, state.discover);
  });

  // ---------- Search ------------------------------------------------------
  await page.route('**/api/search**', (route) => {
    return json(route, 200, searchInRainbows);
  });

  // ---------- Music details ----------------------------------------------
  await page.route('**/api/album/**', (route) => {
    const url = new URL(route.request().url());
    // Path is /api/album/<mbid>
    const mbid = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    const override = state.albumOverrides.get(mbid);
    if (override) return json(route, 200, override);
    const requested = state.requestedAlbums.has(mbid);
    return json(route, 200, {
      ...inRainbowsAlbumDetail,
      mbid,
      releaseGroupMbid: mbid,
      requestStatus: requested
        ? {
            exists: true,
            id: 999,
            status: 'PROCESSING',
            type: 'ALBUM',
            createdAt: new Date().toISOString(),
          }
        : { exists: false },
    });
  });

  await page.route('**/api/artist/**', (route) => {
    const url = new URL(route.request().url());
    const mbid = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    const override = state.artistOverrides.get(mbid);
    if (override) return json(route, 200, override);
    const requested = state.requestedArtists.has(mbid);
    return json(route, 200, {
      ...radioheadArtistDetail,
      mbid,
      requestStatus: requested
        ? {
            exists: true,
            id: 998,
            status: 'PROCESSING',
            type: 'ARTIST',
            createdAt: new Date().toISOString(),
          }
        : { exists: false },
    });
  });

  // ---------- Requests list/CRUD -----------------------------------------
  // Playwright matches routes in REVERSE registration order, so register
  // generic catch-alls FIRST and specific paths LAST. Otherwise the broad
  // pattern intercepts /api/requests/album etc.
  await page.route('**/api/requests**', (route) => {
    return json(route, 200, asRequestList(state.requests));
  });

  await page.route('**/api/requests/*', (route) => {
    if (route.request().method() === 'DELETE') {
      const url = new URL(route.request().url());
      const id = Number(url.pathname.split('/').pop());
      state.requests = state.requests.filter((r) => r.id !== id);
      return noContent(route);
    }
    return json(route, 405, { message: 'Method not allowed' });
  });

  await page.route('**/api/requests/*/retry', (route) => {
    const url = new URL(route.request().url());
    const idStr = url.pathname.split('/').slice(-2)[0];
    const id = Number(idStr);
    let updated: MusicRequestRow | null = null;
    state.requests = state.requests.map((r) => {
      if (r.id === id) {
        updated = {
          ...r,
          status: 'PROCESSING',
          errorMessage: null,
          updatedAt: new Date().toISOString(),
        };
        return updated;
      }
      return r;
    });
    return json(
      route,
      200,
      updated ?? { ...albumRequestProcessing, id }
    );
  });

  await page.route('**/api/requests/_reconcile', (route) => {
    return json(route, 200, reconcileResponse);
  });

  await page.route('**/api/requests/album', async (route) => {
    let mbid = albumRequestProcessing.mbid;
    try {
      const body = route.request().postDataJSON() as { mbid?: string };
      if (body?.mbid) mbid = body.mbid;
    } catch {
      // ignore
    }
    state.requestedAlbums.add(mbid);
    const row = { ...albumRequestProcessing, mbid };
    state.requests = [row, ...state.requests];
    return json(route, 201, row);
  });

  await page.route('**/api/requests/artist', async (route) => {
    let mbid = artistRequestProcessing.mbid;
    try {
      const body = route.request().postDataJSON() as { mbid?: string };
      if (body?.mbid) mbid = body.mbid;
    } catch {
      // ignore
    }
    state.requestedArtists.add(mbid);
    const row = { ...artistRequestProcessing, mbid };
    state.requests = [row, ...state.requests];
    return json(route, 201, row);
  });

  // ---------- Users -------------------------------------------------------
  // Same registration-order trick: generic last, specific first.
  await page.route('**/api/users**', async (route) => {
    if (route.request().method() === 'POST') {
      const req = route.request();
      let body: { username?: string; role?: 'ADMIN' | 'USER' } = {};
      try {
        body = req.postDataJSON();
      } catch {
        // ignore
      }
      const created = {
        id: 99,
        username: body.username ?? 'newuser',
        role: body.role ?? 'USER',
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as unknown as PublicUser;
      return json(route, 201, created);
    }
    return json(route, 200, { users: usersList, total: usersList.length });
  });

  await page.route('**/api/users/*', (route) => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    const id = Number(url.pathname.split('/').pop());
    if (method === 'DELETE') {
      // Disallow self-delete: return 400.
      if (state.user && id === state.user.id) {
        return json(route, 400, {
          message: 'You cannot delete your own account.',
          code: 'SELF_DELETE_FORBIDDEN',
        });
      }
      return noContent(route);
    }
    if (method === 'PATCH') {
      return json(route, 200, { ...adminUser, id });
    }
    return json(route, 405, { message: 'Method not allowed' });
  });

  return {
    state,
    setUser(user) {
      state.user = user;
    },
    setSetupStatus(status) {
      state.setupStatus = status;
    },
    setRequests(rows) {
      state.requests = rows;
    },
    setDiscover(payload) {
      state.discover = payload;
    },
  };
}

// ---- Convenience scenarios ------------------------------------------------

/** Default authenticated admin, setup complete, populated discover/requests. */
export async function mockHappyPath(
  page: Page,
  opts: MockOptions = {}
): Promise<MockHandle> {
  return installApiMocks(page, opts);
}

/** Setup wizard initial state — no admin yet, no settings saved. */
export async function mockVirginInstall(page: Page): Promise<MockHandle> {
  return installApiMocks(page, {
    user: null,
    setupStatus: virginSetupStatus,
    settingsView: { ...emptySettingsView },
  });
}

/** Authenticated as a non-admin (alice). */
export async function mockAsRegularUser(page: Page): Promise<MockHandle> {
  return installApiMocks(page, { user: regularUser });
}

/** Authenticated admin, but Last.fm not configured (Discover empty state). */
export async function mockLastfmNotConfigured(page: Page): Promise<MockHandle> {
  return installApiMocks(page, { discover: discoverNotConfigured });
}

/** Logged in admin viewing Requests with one FAILED row visible. */
export async function mockRequestsWithFailure(
  page: Page
): Promise<MockHandle> {
  return installApiMocks(page, { requests: sampleRequestsWithFailure });
}

/** Logged in admin viewing populated Requests (no failures). */
export async function mockRequestsList(page: Page): Promise<MockHandle> {
  return installApiMocks(page, { requests: sampleRequests });
}
