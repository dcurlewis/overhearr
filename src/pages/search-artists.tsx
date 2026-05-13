import { useEffect } from 'react';
import { useRouter } from 'next/router';

/**
 * Legacy alias from the pre-v1 frontend. Phase 5c folded artist search into
 * the unified `/search` page, so this route just forwards to the type-filtered
 * variant for any bookmarks / external links that still point here.
 */
export default function SearchArtistsRedirect(): null {
  const router = useRouter();
  useEffect(() => {
    void router.replace('/search?type=artist');
  }, [router]);
  return null;
}
