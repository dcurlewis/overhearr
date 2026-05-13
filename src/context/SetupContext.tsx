import React, { createContext, useContext, useMemo } from 'react';
import useSWR from 'swr';
import { swrFetcher } from '../lib/api';
import type { SetupStatusResponse } from '../types/api';

interface SetupContextValue {
  setupCompleted: boolean;
  hasAdmin: boolean;
  isLoading: boolean;
  refresh: () => Promise<unknown>;
}

const SetupContext = createContext<SetupContextValue | null>(null);

const SETUP_KEY = '/api/setup/status';

export const SetupProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { data, isLoading, mutate } = useSWR<SetupStatusResponse>(
    SETUP_KEY,
    swrFetcher,
    { revalidateOnFocus: true, refreshInterval: 0 }
  );

  const value = useMemo<SetupContextValue>(
    () => ({
      setupCompleted: data?.setupCompleted ?? false,
      hasAdmin: data?.hasAdmin ?? false,
      isLoading: isLoading && !data,
      refresh: () => mutate(),
    }),
    [data, isLoading, mutate]
  );

  return <SetupContext.Provider value={value}>{children}</SetupContext.Provider>;
};

export function useSetup(): SetupContextValue {
  const ctx = useContext(SetupContext);
  if (!ctx) {
    throw new Error('useSetup must be used inside <SetupProvider>');
  }
  return ctx;
}
