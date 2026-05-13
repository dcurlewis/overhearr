import { describe, expect, it } from 'vitest';

import {
  computeInitialStep,
  createInitialState,
  setupReducer,
  STEP_CAN_SKIP,
  VISIBLE_STEPS,
  type InitialStepInput,
  type SetupState,
} from '../../../src/components/Setup/setupMachine';

const FULL_LIDARR: NonNullable<InitialStepInput['lidarrConfigured']> = {
  hasUrl: true,
  hasApiKey: true,
  hasRootFolderPath: true,
  hasQualityProfileId: true,
  hasMetadataProfileId: true,
};

describe('setupMachine.computeInitialStep', () => {
  it('returns "admin" when no admin exists', () => {
    expect(
      computeInitialStep({ hasAdmin: false, setupCompleted: false })
    ).toBe('admin');
  });

  it('returns "done" when setup is already completed', () => {
    expect(
      computeInitialStep({ hasAdmin: true, setupCompleted: true })
    ).toBe('done');
  });

  it('returns "done" even without admin if setupCompleted is true (defensive)', () => {
    // setupCompleted should imply hasAdmin, but if the API ever lies we
    // still want to honour the "done" signal — the page guard will redirect.
    expect(
      computeInitialStep({ hasAdmin: false, setupCompleted: true })
    ).toBe('done');
  });

  it('returns "lidarr-connection" when admin exists but settings are unknown', () => {
    expect(
      computeInitialStep({ hasAdmin: true, setupCompleted: false })
    ).toBe('lidarr-connection');
  });

  it('returns "lidarr-connection" when URL is missing', () => {
    expect(
      computeInitialStep({
        hasAdmin: true,
        setupCompleted: false,
        lidarrConfigured: { ...FULL_LIDARR, hasUrl: false },
      })
    ).toBe('lidarr-connection');
  });

  it('returns "lidarr-connection" when API key is missing', () => {
    expect(
      computeInitialStep({
        hasAdmin: true,
        setupCompleted: false,
        lidarrConfigured: { ...FULL_LIDARR, hasApiKey: false },
      })
    ).toBe('lidarr-connection');
  });

  it('returns "lidarr-profiles" when URL+key are saved but a profile is missing', () => {
    expect(
      computeInitialStep({
        hasAdmin: true,
        setupCompleted: false,
        lidarrConfigured: { ...FULL_LIDARR, hasRootFolderPath: false },
      })
    ).toBe('lidarr-profiles');

    expect(
      computeInitialStep({
        hasAdmin: true,
        setupCompleted: false,
        lidarrConfigured: { ...FULL_LIDARR, hasQualityProfileId: false },
      })
    ).toBe('lidarr-profiles');

    expect(
      computeInitialStep({
        hasAdmin: true,
        setupCompleted: false,
        lidarrConfigured: { ...FULL_LIDARR, hasMetadataProfileId: false },
      })
    ).toBe('lidarr-profiles');
  });

  it('returns "lastfm" when Lidarr is fully configured', () => {
    expect(
      computeInitialStep({
        hasAdmin: true,
        setupCompleted: false,
        lidarrConfigured: FULL_LIDARR,
      })
    ).toBe('lastfm');
  });
});

describe('setupMachine.createInitialState', () => {
  it('wraps computeInitialStep in a SetupState shape', () => {
    expect(
      createInitialState({ hasAdmin: false, setupCompleted: false })
    ).toEqual({ step: 'admin' });
  });
});

describe('setupMachine reducer', () => {
  const start = (step: SetupState['step']): SetupState => ({ step });

  it('advances admin → lidarr-connection on next', () => {
    expect(setupReducer(start('admin'), { type: 'next' })).toEqual({
      step: 'lidarr-connection',
    });
  });

  it('advances lidarr-connection → lidarr-profiles on next', () => {
    expect(setupReducer(start('lidarr-connection'), { type: 'next' })).toEqual({
      step: 'lidarr-profiles',
    });
  });

  it('advances lidarr-profiles → lastfm on next', () => {
    expect(setupReducer(start('lidarr-profiles'), { type: 'next' })).toEqual({
      step: 'lastfm',
    });
  });

  it('advances lastfm → done on next', () => {
    expect(setupReducer(start('lastfm'), { type: 'next' })).toEqual({
      step: 'done',
    });
  });

  it('done is terminal — next is a no-op', () => {
    const state = start('done');
    expect(setupReducer(state, { type: 'next' })).toBe(state);
  });

  it('cannot back from admin', () => {
    const state = start('admin');
    expect(setupReducer(state, { type: 'back' })).toBe(state);
  });

  it('cannot back from lidarr-connection (admin is irreversible)', () => {
    const state = start('lidarr-connection');
    expect(setupReducer(state, { type: 'back' })).toBe(state);
  });

  it('back from lidarr-profiles → lidarr-connection', () => {
    expect(setupReducer(start('lidarr-profiles'), { type: 'back' })).toEqual({
      step: 'lidarr-connection',
    });
  });

  it('back from lastfm → lidarr-profiles', () => {
    expect(setupReducer(start('lastfm'), { type: 'back' })).toEqual({
      step: 'lidarr-profiles',
    });
  });

  it('back from done → lastfm (lets the user retry finalising)', () => {
    expect(setupReducer(start('done'), { type: 'back' })).toEqual({
      step: 'lastfm',
    });
  });

  it('skip from lastfm → done', () => {
    expect(setupReducer(start('lastfm'), { type: 'skip' })).toEqual({
      step: 'done',
    });
  });

  it('skip is a no-op on non-skippable steps', () => {
    for (const step of ['admin', 'lidarr-connection', 'lidarr-profiles'] as const) {
      const state = start(step);
      expect(setupReducer(state, { type: 'skip' })).toBe(state);
    }
  });

  it('goto jumps to an arbitrary step', () => {
    expect(setupReducer(start('admin'), { type: 'goto', step: 'lastfm' })).toEqual({
      step: 'lastfm',
    });
  });

  it('reset behaves like goto', () => {
    expect(
      setupReducer(start('lastfm'), { type: 'reset', step: 'lidarr-profiles' })
    ).toEqual({ step: 'lidarr-profiles' });
  });

  it('STEP_CAN_SKIP only allows lastfm', () => {
    expect(STEP_CAN_SKIP.admin).toBe(false);
    expect(STEP_CAN_SKIP['lidarr-connection']).toBe(false);
    expect(STEP_CAN_SKIP['lidarr-profiles']).toBe(false);
    expect(STEP_CAN_SKIP.lastfm).toBe(true);
    expect(STEP_CAN_SKIP.done).toBe(false);
  });

  it('VISIBLE_STEPS lists the four wizard pages in order', () => {
    expect(VISIBLE_STEPS).toEqual([
      'admin',
      'lidarr-connection',
      'lidarr-profiles',
      'lastfm',
    ]);
  });
});
