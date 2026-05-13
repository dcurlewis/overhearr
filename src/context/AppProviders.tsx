import React from 'react';
import { SWRConfig } from 'swr';
import { swrFetcher } from '../lib/api';
import { ThemeProvider } from './ThemeContext';
import { AuthProvider } from './AuthContext';
import { SetupProvider } from './SetupContext';
import { ToastProvider } from '../components/ui/Toast';

/**
 * Single mount point for every cross-cutting frontend provider.
 *
 * Order matters:
 *   1. SWRConfig — fetcher used by Auth + Setup contexts.
 *   2. ThemeProvider — independent of auth, but needs to wrap toast/UI.
 *   3. ToastProvider — exposes `useToast`, used by login/setup flows.
 *   4. AuthProvider + SetupProvider — depend on SWR.
 */
export const AppProviders: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <SWRConfig
    value={{
      fetcher: swrFetcher,
      revalidateOnFocus: true,
      shouldRetryOnError: false,
    }}
  >
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <SetupProvider>{children}</SetupProvider>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  </SWRConfig>
);

export default AppProviders;
