import React, { createContext, useCallback, useContext, useMemo } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { ApiError, apiPost, swrFetcher } from '../lib/api';
import type { PublicUser } from '../types/api';

interface AuthContextValue {
  user: PublicUser | null;
  isLoading: boolean;
  error: ApiError | null;
  mutate: () => Promise<unknown>;
  login: (username: string, password: string) => Promise<PublicUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const ME_KEY = '/api/auth/me';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { mutate: globalMutate } = useSWRConfig();

  // 401 is a normal "not logged in" state — don't treat it as an error.
  const { data, error, isLoading, mutate } = useSWR<PublicUser>(ME_KEY, swrFetcher, {
    shouldRetryOnError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) return false;
      return true;
    },
    // Don't revalidate /api/auth/me on tab focus. Users tab away constantly
    // (e.g. to grab an API key from another app), and a fresh fetch returns
    // a new object reference even when nothing has changed — that ripples
    // through consumers as a context-value change and can clobber unsaved
    // form state. Logout-in-another-tab is detected lazily on the next
    // mutation that returns 401.
    revalidateOnFocus: false,
    refreshInterval: 0,
  });

  const isAuthError = error instanceof ApiError && error.status === 401;
  const user = data ?? null;
  const realError = !isAuthError && error instanceof ApiError ? error : null;

  const login = useCallback(
    async (username: string, password: string) => {
      const next = await apiPost<PublicUser>('/api/auth/login', { username, password });
      // Prime SWR cache + revalidate.
      await globalMutate(ME_KEY, next, { revalidate: false });
      await globalMutate(ME_KEY);
      return next;
    },
    [globalMutate]
  );

  const logout = useCallback(async () => {
    try {
      await apiPost<void>('/api/auth/logout');
    } finally {
      await globalMutate(ME_KEY, null, { revalidate: false });
      await globalMutate(ME_KEY);
    }
  }, [globalMutate]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      error: realError,
      mutate: () => mutate(),
      login,
      logout,
    }),
    [user, isLoading, realError, mutate, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}

export default AuthProvider;
