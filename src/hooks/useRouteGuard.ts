import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../context/AuthContext';
import { useSetup } from '../context/SetupContext';
import type { PublicUser } from '../types/api';

export type RouteGuardRequirement =
  | 'auth'
  | 'guest'
  | 'admin'
  | 'setup-incomplete'
  | 'setup-complete';

export interface UseRouteGuardOptions {
  require?: RouteGuardRequirement;
}

export interface UseRouteGuardResult {
  loading: boolean;
  user: PublicUser | null;
}

/**
 * Centralised redirect rules for the app shell.
 *
 * The frontend is *defence in depth* — the backend is still the real guard.
 * This hook only avoids flashing the wrong page at users.
 */
export function useRouteGuard(
  options: UseRouteGuardOptions = {}
): UseRouteGuardResult {
  const { require = 'auth' } = options;
  const router = useRouter();
  const auth = useAuth();
  const setup = useSetup();

  const loading = auth.isLoading || setup.isLoading;

  useEffect(() => {
    if (loading) return;

    const path = router.pathname;
    const isOnSetup = path === '/setup' || path.startsWith('/setup/');
    const isOnLogin = path === '/login';

    switch (require) {
      case 'auth': {
        if (!auth.user) {
          if (!isOnLogin) router.replace('/login');
          return;
        }
        if (!setup.setupCompleted) {
          if (!isOnSetup) router.replace('/setup');
        }
        return;
      }
      case 'guest': {
        if (auth.user) {
          if (!setup.setupCompleted) {
            if (!isOnSetup) router.replace('/setup');
          } else {
            router.replace('/');
          }
        }
        return;
      }
      case 'admin': {
        if (!auth.user) {
          router.replace('/login');
          return;
        }
        if (!setup.setupCompleted) {
          if (!isOnSetup) router.replace('/setup');
          return;
        }
        if (auth.user.role !== 'ADMIN') {
          router.replace('/');
        }
        return;
      }
      case 'setup-incomplete': {
        if (setup.setupCompleted && setup.hasAdmin) {
          router.replace('/');
        }
        return;
      }
      case 'setup-complete': {
        if (!setup.setupCompleted) {
          if (!isOnSetup) router.replace('/setup');
        }
        return;
      }
      default:
        return;
    }
  }, [loading, require, auth.user, setup.setupCompleted, setup.hasAdmin, router]);

  return { loading, user: auth.user };
}
