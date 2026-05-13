/**
 * Static fixture data for Playwright E2E tests.
 *
 * Recognisable artists/albums (Radiohead, Pixies) keep screenshots looking
 * authentic. Every shape matches the real API contract from
 * `src/types/api.ts`. Anything we don't enumerate here is stable enough that
 * the UI doesn't surface it.
 */

import type {
  AlbumDetail,
  ArtistDetail,
  DiscoverPayload,
  MusicRequestRow,
  PublicUser,
  RequestListResponse,
  SearchResponse,
  SetupStatusResponse,
} from '../../../src/types/api';

// ---- Users ----------------------------------------------------------------

// Note: PublicUser is Prisma-derived and types `createdAt`/`updatedAt` as
// Date, but JSON wire format is strings. Cast through unknown for fixtures.
export const adminUser = {
  id: 1,
  username: 'admin',
  role: 'ADMIN',
  isActive: true,
  createdAt: '2026-05-01T12:00:00.000Z',
  updatedAt: '2026-05-13T08:00:00.000Z',
} as unknown as PublicUser;

export const regularUser = {
  id: 2,
  username: 'alice',
  role: 'USER',
  isActive: true,
  createdAt: '2026-05-02T12:00:00.000Z',
  updatedAt: '2026-05-13T08:00:00.000Z',
} as unknown as PublicUser;

export const usersList: PublicUser[] = [adminUser, regularUser];

// ---- Setup status ---------------------------------------------------------

export const virginSetupStatus: SetupStatusResponse = {
  setupCompleted: false,
  hasAdmin: false,
};

export const completedSetupStatus: SetupStatusResponse = {
  setupCompleted: true,
  hasAdmin: true,
};

// ---- Settings -------------------------------------------------------------

export const redactedSettings = {
  lidarrUrl: 'http://lidarr.example.com',
  lidarrApiKey: '••••••••t-key',
  lidarrRootFolderPath: '/data/music',
  lidarrQualityProfileId: 2,
  lidarrMetadataProfileId: 1,
  lastfmApiKey: '••••••••c123',
  setupCompleted: true,
  createdAt: '2026-05-01T12:00:00.000Z',
  updatedAt: '2026-05-13T08:00:00.000Z',
};

export const lidarrTestSuccess = {
  ok: true,
  version: '2.10.4',
  instanceName: 'Lidarr Mock',
};

export const lidarrProfilesResponse = {
  rootFolders: [
    { id: 1, path: '/data/music', freeSpace: 5_368_709_120_000, accessible: true },
    { id: 2, path: '/data/music-archive', freeSpace: 1_099_511_627_776, accessible: true },
  ],
  qualityProfiles: [
    { id: 1, name: 'Any' },
    { id: 2, name: 'Lossless' },
    { id: 3, name: 'Standard' },
  ],
  metadataProfiles: [
    { id: 1, name: 'Standard' },
    { id: 2, name: 'None' },
  ],
};

export const healthResponse = {
  status: 'ok' as const,
  version: '1.0.0',
  uptimeSec: 3621,
  db: 'ok' as const,
  lidarrConfigured: true,
};

// ---- MBIDs (canonical) ----------------------------------------------------

export const RADIOHEAD_MBID = 'a74b1b7f-71a5-4011-9441-d0b5e4122711';
export const IN_RAINBOWS_RG = '94259b94-7e2c-3c81-90a3-4c0a32edb6e0';
export const IN_RAINBOWS_REL = 'b1392450-e666-3926-a536-22c65f834433';
export const OK_COMPUTER_RG = 'b1392450-aaaa-1234-bbbb-22c65f834434';
export const KID_A_RG = '0fdaff5b-eb88-3df9-95dd-3a25c1c82d57';
export const PIXIES_MBID = 'cc197bad-dc9c-440d-a5b5-d52ba2e14234';
export const DOOLITTLE_RG = '8b3c1eef-1111-2222-3333-444455556666';

// ---- Discover -------------------------------------------------------------

export const discoverConfigured: DiscoverPayload = {
  configured: true,
  topAlbums: [
    {
      mbid: IN_RAINBOWS_RG,
      name: 'In Rainbows',
      artist: 'Radiohead',
      artistMbid: RADIOHEAD_MBID,
      imageUrl:
        'https://lastfm.freetls.fastly.net/i/u/300x300/c97d2e6dd3334f59abec9ff45e9d6c45.png',
      playcount: 14_300_120,
      listeners: 2_410_000,
      requestStatus: { exists: false },
    },
    {
      mbid: OK_COMPUTER_RG,
      name: 'OK Computer',
      artist: 'Radiohead',
      artistMbid: RADIOHEAD_MBID,
      imageUrl:
        'https://lastfm.freetls.fastly.net/i/u/300x300/3a1a3e1d3f7e4b6e8d2c9e1234567890.png',
      playcount: 21_300_000,
      listeners: 3_010_000,
      requestStatus: { exists: false },
    },
    {
      mbid: KID_A_RG,
      name: 'Kid A',
      artist: 'Radiohead',
      artistMbid: RADIOHEAD_MBID,
      imageUrl:
        'https://lastfm.freetls.fastly.net/i/u/300x300/1234567890abcdef1234567890abcdef.png',
      playcount: 11_900_000,
      listeners: 2_120_000,
      requestStatus: { exists: false },
    },
    {
      mbid: DOOLITTLE_RG,
      name: 'Doolittle',
      artist: 'Pixies',
      artistMbid: PIXIES_MBID,
      imageUrl:
        'https://lastfm.freetls.fastly.net/i/u/300x300/abcdef1234567890abcdef1234567890.png',
      playcount: 6_400_000,
      listeners: 1_200_000,
      requestStatus: { exists: false },
    },
  ],
  topArtists: [
    {
      mbid: RADIOHEAD_MBID,
      name: 'Radiohead',
      imageUrl:
        'https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png',
      playcount: 920_000_000,
      listeners: 5_120_000,
      requestStatus: { exists: false },
    },
    {
      mbid: PIXIES_MBID,
      name: 'Pixies',
      imageUrl:
        'https://lastfm.freetls.fastly.net/i/u/300x300/4c2c12c1aa2c4f7c9d2e9ffa2b5d4f1c.png',
      playcount: 410_000_000,
      listeners: 2_410_000,
      requestStatus: { exists: false },
    },
  ],
  newReleases: [
    {
      mbid: '00000000-0000-0000-0000-100000000001',
      name: 'A Light for Attracting Attention',
      artist: 'The Smile',
      imageUrl:
        'https://lastfm.freetls.fastly.net/i/u/300x300/1111111111111111111111111111aaaa.png',
      playcount: 510_000,
      listeners: 145_000,
      requestStatus: { exists: false },
    },
    {
      mbid: '00000000-0000-0000-0000-100000000002',
      name: 'Wall of Eyes',
      artist: 'The Smile',
      imageUrl:
        'https://lastfm.freetls.fastly.net/i/u/300x300/2222222222222222222222222222bbbb.png',
      playcount: 230_000,
      listeners: 78_000,
      requestStatus: { exists: false },
    },
  ],
};

export const discoverNotConfigured: DiscoverPayload = {
  configured: false,
  topAlbums: [],
  topArtists: [],
  newReleases: [],
};

// ---- Search ---------------------------------------------------------------

export const searchInRainbows: SearchResponse = {
  albums: [
    {
      mbid: IN_RAINBOWS_REL,
      releaseGroupMbid: IN_RAINBOWS_RG,
      title: 'In Rainbows',
      artistName: 'Radiohead',
      artistMbid: RADIOHEAD_MBID,
      firstReleaseDate: '2007-10-10',
      tracks: [],
      coverArtUrl:
        'https://coverartarchive.org/release-group/' +
        IN_RAINBOWS_RG +
        '/front-500.jpg',
      thumbnailUrl:
        'https://coverartarchive.org/release-group/' +
        IN_RAINBOWS_RG +
        '/front-250.jpg',
      requestStatus: { exists: false },
    },
    {
      mbid: 'rel-okcomputer-aaaa',
      releaseGroupMbid: OK_COMPUTER_RG,
      title: 'OK Computer',
      artistName: 'Radiohead',
      artistMbid: RADIOHEAD_MBID,
      firstReleaseDate: '1997-05-21',
      tracks: [],
      coverArtUrl:
        'https://coverartarchive.org/release-group/' +
        OK_COMPUTER_RG +
        '/front-500.jpg',
      requestStatus: { exists: false },
    },
  ],
  artists: [
    {
      mbid: RADIOHEAD_MBID,
      name: 'Radiohead',
      sortName: 'Radiohead',
      country: 'GB',
      type: 'Group',
      requestStatus: { exists: false },
    },
  ],
};

// ---- Album detail ---------------------------------------------------------

export const inRainbowsAlbumDetail: AlbumDetail = {
  mbid: IN_RAINBOWS_REL,
  releaseGroupMbid: IN_RAINBOWS_RG,
  title: 'In Rainbows',
  artistName: 'Radiohead',
  artistMbid: RADIOHEAD_MBID,
  firstReleaseDate: '2007-10-10',
  coverArtUrl:
    'https://coverartarchive.org/release-group/' +
    IN_RAINBOWS_RG +
    '/front-500.jpg',
  thumbnailUrl:
    'https://coverartarchive.org/release-group/' +
    IN_RAINBOWS_RG +
    '/front-250.jpg',
  tracks: [
    { position: 1, title: '15 Step', lengthMs: 237_000 },
    { position: 2, title: 'Bodysnatchers', lengthMs: 242_000 },
    { position: 3, title: 'Nude', lengthMs: 255_000 },
    { position: 4, title: 'Weird Fishes/Arpeggi', lengthMs: 318_000 },
    { position: 5, title: 'All I Need', lengthMs: 228_000 },
    { position: 6, title: 'Faust Arp', lengthMs: 129_000 },
    { position: 7, title: 'Reckoner', lengthMs: 290_000 },
    { position: 8, title: 'House of Cards', lengthMs: 327_000 },
    { position: 9, title: 'Jigsaw Falling Into Place', lengthMs: 248_000 },
    { position: 10, title: 'Videotape', lengthMs: 280_000 },
  ],
  requestStatus: { exists: false },
  artistRequestStatus: { exists: false },
};

// ---- Artist detail --------------------------------------------------------

export const radioheadArtistDetail: ArtistDetail = {
  mbid: RADIOHEAD_MBID,
  name: 'Radiohead',
  sortName: 'Radiohead',
  country: 'GB',
  type: 'Group',
  disambiguation: 'British rock band',
  requestStatus: { exists: false },
  releaseGroups: [
    {
      mbid: 'rg-pablo-honey',
      title: 'Pablo Honey',
      primaryType: 'Album',
      firstReleaseDate: '1993-02-22',
      coverArtUrl:
        'https://coverartarchive.org/release-group/rg-pablo-honey/front-250.jpg',
      requestStatus: { exists: false },
    },
    {
      mbid: 'rg-the-bends',
      title: 'The Bends',
      primaryType: 'Album',
      firstReleaseDate: '1995-03-13',
      coverArtUrl:
        'https://coverartarchive.org/release-group/rg-the-bends/front-250.jpg',
      requestStatus: { exists: false },
    },
    {
      mbid: OK_COMPUTER_RG,
      title: 'OK Computer',
      primaryType: 'Album',
      firstReleaseDate: '1997-05-21',
      coverArtUrl:
        'https://coverartarchive.org/release-group/' +
        OK_COMPUTER_RG +
        '/front-250.jpg',
      requestStatus: { exists: false },
    },
    {
      mbid: KID_A_RG,
      title: 'Kid A',
      primaryType: 'Album',
      firstReleaseDate: '2000-10-02',
      coverArtUrl:
        'https://coverartarchive.org/release-group/' +
        KID_A_RG +
        '/front-250.jpg',
      requestStatus: { exists: false },
    },
    {
      mbid: 'rg-amnesiac',
      title: 'Amnesiac',
      primaryType: 'Album',
      firstReleaseDate: '2001-06-04',
      coverArtUrl:
        'https://coverartarchive.org/release-group/rg-amnesiac/front-250.jpg',
      requestStatus: { exists: false },
    },
    {
      mbid: IN_RAINBOWS_RG,
      title: 'In Rainbows',
      primaryType: 'Album',
      firstReleaseDate: '2007-10-10',
      coverArtUrl:
        'https://coverartarchive.org/release-group/' +
        IN_RAINBOWS_RG +
        '/front-250.jpg',
      requestStatus: { exists: false },
    },
  ],
};

// ---- Request rows ---------------------------------------------------------

const baseRow: Omit<MusicRequestRow, 'id' | 'status' | 'name'> = {
  userId: 1,
  type: 'ALBUM',
  mbid: IN_RAINBOWS_RG,
  artistName: 'Radiohead',
  coverArtUrl:
    'https://coverartarchive.org/release-group/' +
    IN_RAINBOWS_RG +
    '/front-250.jpg',
  releaseDate: '2007-10-10',
  lidarrAlbumId: 4242,
  lidarrArtistId: 142,
  errorMessage: null,
  createdAt: '2026-05-13T07:30:00.000Z',
  updatedAt: '2026-05-13T07:32:00.000Z',
};

export function makeRequestRow(
  overrides: Partial<MusicRequestRow> & { id: number; name: string }
): MusicRequestRow {
  return {
    ...baseRow,
    status: 'PROCESSING',
    ...overrides,
  } as MusicRequestRow;
}

export const sampleRequests: MusicRequestRow[] = [
  makeRequestRow({
    id: 101,
    name: 'In Rainbows',
    status: 'PROCESSING',
  }),
  makeRequestRow({
    id: 102,
    name: 'OK Computer',
    mbid: OK_COMPUTER_RG,
    status: 'AVAILABLE',
    createdAt: '2026-05-12T18:00:00.000Z',
    updatedAt: '2026-05-13T03:00:00.000Z',
  }),
  makeRequestRow({
    id: 103,
    name: 'Kid A',
    mbid: KID_A_RG,
    status: 'PENDING',
    createdAt: '2026-05-13T08:00:00.000Z',
    updatedAt: '2026-05-13T08:00:00.000Z',
  }),
];

export const sampleRequestsWithFailure: MusicRequestRow[] = [
  makeRequestRow({
    id: 201,
    name: 'Doolittle',
    artistName: 'Pixies',
    mbid: DOOLITTLE_RG,
    status: 'FAILED',
    errorMessage: 'Lidarr search returned no candidates for this release.',
    createdAt: '2026-05-13T06:00:00.000Z',
    updatedAt: '2026-05-13T06:01:30.000Z',
  }),
  ...sampleRequests,
];

export function asRequestList(
  rows: MusicRequestRow[]
): RequestListResponse {
  return { requests: rows, total: rows.length };
}

// ---- Request action responses --------------------------------------------

export const albumRequestProcessing = makeRequestRow({
  id: 999,
  name: 'In Rainbows',
  mbid: IN_RAINBOWS_RG,
  status: 'PROCESSING',
});

export const artistRequestProcessing = makeRequestRow({
  id: 998,
  type: 'ARTIST',
  name: 'Radiohead',
  artistName: null,
  mbid: RADIOHEAD_MBID,
  status: 'PROCESSING',
});

export const reconcileResponse = {
  checked: 3,
  promotedToAvailable: 1,
  errors: 0,
};
