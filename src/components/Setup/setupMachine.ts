/**
 * Pure state machine for the first-run setup wizard.
 *
 * Lives in its own file (no React imports) so it can be unit-tested without
 * jsdom or React rendering. The wizard component owns the React side via
 * `useReducer(setupReducer, ...)`.
 *
 * Steps:
 *   admin              → create the first admin account
 *   lidarr-connection  → enter URL + API key, must Test before continuing
 *   lidarr-profiles    → pick root folder, quality profile, metadata profile
 *   lastfm             → optional Last.fm API key
 *   done               → auto-runs POST /api/setup/complete + redirects
 *
 * The admin step has no Back button. `lastfm` is the only step you can Skip.
 * Once `setupCompleted=true` arrives via SetupContext, the page guard kicks
 * the user out of /setup entirely.
 */

export type SetupStep =
  | 'admin'
  | 'lidarr-connection'
  | 'lidarr-profiles'
  | 'lastfm'
  | 'done';

/** Visible steps used by the step indicator (4 dots). `done` is implicit. */
export const VISIBLE_STEPS: ReadonlyArray<Exclude<SetupStep, 'done'>> = [
  'admin',
  'lidarr-connection',
  'lidarr-profiles',
  'lastfm',
];

export const STEP_TITLES: Record<SetupStep, string> = {
  admin: 'Create admin account',
  'lidarr-connection': 'Connect to Lidarr',
  'lidarr-profiles': 'Choose Lidarr profiles',
  lastfm: 'Last.fm (optional)',
  done: 'Finishing up',
};

/**
 * Whether the user can Skip a step. We keep this here (not in component)
 * because the wizard footer reads it to decide which buttons to render.
 */
export const STEP_CAN_SKIP: Record<SetupStep, boolean> = {
  admin: false,
  'lidarr-connection': false,
  'lidarr-profiles': false,
  lastfm: true,
  done: false,
};

/**
 * Minimal slice of the SetupContext + saved Lidarr settings that we need to
 * compute the initial step. The wizard fetches the redacted settings row
 * lazily after the admin step (since the endpoint is admin-only) and feeds
 * those fields back in here.
 */
export interface InitialStepInput {
  /** From SetupContext. */
  hasAdmin: boolean;
  /** From SetupContext. */
  setupCompleted: boolean;
  /** From GET /api/settings (redacted). null/undefined when not loaded yet. */
  lidarrConfigured?: {
    /** Whether URL is saved. */
    hasUrl: boolean;
    /** Whether the encrypted API key is saved (redacted form, e.g. `••••aabb`). */
    hasApiKey: boolean;
    hasRootFolderPath: boolean;
    hasQualityProfileId: boolean;
    hasMetadataProfileId: boolean;
  };
}

/**
 * Resume rules:
 *   1. setupCompleted   → done   (page guard will redirect away anyway)
 *   2. !hasAdmin        → admin
 *   3. Lidarr URL+key not yet saved → lidarr-connection
 *   4. Any of root/quality/metadata missing → lidarr-profiles
 *   5. Otherwise        → lastfm
 *
 * The user can still go back from any non-admin step. We deliberately do
 * NOT auto-jump to `done` (that step finalises and redirects); we land
 * them on lastfm so they get one last chance to add the optional key.
 */
export function computeInitialStep(input: InitialStepInput): SetupStep {
  if (input.setupCompleted) return 'done';
  if (!input.hasAdmin) return 'admin';

  const lidarr = input.lidarrConfigured;
  if (!lidarr) {
    // We know there's an admin but haven't fetched settings yet. Best we can
    // do is start at lidarr-connection — the LidarrConnectionStep itself can
    // pre-fill from settings on mount.
    return 'lidarr-connection';
  }

  if (!lidarr.hasUrl || !lidarr.hasApiKey) return 'lidarr-connection';
  if (
    !lidarr.hasRootFolderPath ||
    !lidarr.hasQualityProfileId ||
    !lidarr.hasMetadataProfileId
  ) {
    return 'lidarr-profiles';
  }
  return 'lastfm';
}

// ---- Reducer --------------------------------------------------------------

export interface SetupState {
  step: SetupStep;
}

export type SetupAction =
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'skip' }
  | { type: 'goto'; step: SetupStep }
  | { type: 'reset'; step: SetupStep };

const FORWARD: Record<SetupStep, SetupStep> = {
  admin: 'lidarr-connection',
  'lidarr-connection': 'lidarr-profiles',
  'lidarr-profiles': 'lastfm',
  lastfm: 'done',
  done: 'done',
};

const BACK: Record<SetupStep, SetupStep | null> = {
  admin: null, // can never go back from admin
  'lidarr-connection': null, // also no going back — admin is already created
  'lidarr-profiles': 'lidarr-connection',
  lastfm: 'lidarr-profiles',
  done: 'lastfm',
};

export function setupReducer(state: SetupState, action: SetupAction): SetupState {
  switch (action.type) {
    case 'next': {
      const nextStep = FORWARD[state.step];
      return nextStep === state.step ? state : { step: nextStep };
    }
    case 'back': {
      const prev = BACK[state.step];
      return prev ? { step: prev } : state;
    }
    case 'skip': {
      if (!STEP_CAN_SKIP[state.step]) return state;
      return { step: FORWARD[state.step] };
    }
    case 'goto':
    case 'reset':
      return { step: action.step };
    default:
      return state;
  }
}

export function createInitialState(input: InitialStepInput): SetupState {
  return { step: computeInitialStep(input) };
}
