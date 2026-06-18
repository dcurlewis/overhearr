/**
 * Image-proxy helper.
 *
 * Cover-art and artist images come from upstreams (Cover Art Archive, the
 * Last.fm CDN, MusicBrainz) that can be slow or unreachable. Rather than
 * pointing the browser at them directly, we route every image through the
 * server-side proxy at `/api/image`, which caches the bytes on disk and
 * serves them even when the upstream blips.
 *
 * `proxiedImage` is the single chokepoint. Pass it a raw upstream URL and it
 * returns a same-origin `/api/image?src=...` URL. Anything that isn't an
 * absolute http(s) URL (already-relative paths, blank values) is returned
 * untouched so callers can pass through `undefined`/local assets safely.
 */
export function proxiedImage(
  src: string | null | undefined
): string | undefined {
  if (!src) return undefined;
  // Only proxy absolute http(s) URLs. Local/relative paths and data: URIs are
  // served as-is. The server enforces its own host allowlist on top of this.
  if (!/^https?:\/\//i.test(src)) return src;
  return `/api/image?src=${encodeURIComponent(src)}`;
}

export default proxiedImage;
