/**
 * Backwards-compatible thin wrapper around `useRouteGuard`.
 *
 * Older call sites import this; new code should prefer `useRouteGuard`
 * directly because it handles setup-incomplete + admin checks too.
 */
import { useRouteGuard } from './useRouteGuard';

export const useRequireAuth = () => {
  const { loading, user } = useRouteGuard({ require: 'auth' });
  return { user, loading };
};
