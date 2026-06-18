/**
 * /api/image — cover-art / artist-image proxy + on-disk cache.
 *
 * `GET /api/image?src=<encoded-upstream-url>` fetches the upstream image,
 * caches the bytes on disk (see `imageCacheService`), and streams them back.
 * The frontend references every cover-art / artist image through this
 * endpoint rather than hitting the upstream directly, so images keep
 * rendering even when Cover Art Archive / the Last.fm CDN is slow.
 *
 * Auth: the endpoint requires a logged-in user (same posture as search /
 * discover). It is NOT setup-gated — images are served on every post-login
 * surface and there's no reason to couple it to Lidarr config.
 *
 * SSRF safety lives in `imageCacheService.assertAllowedImageUrl`: only
 * http/https and only the allowlist of hosts the app actually renders.
 */

import { createReadStream } from 'fs';

import { Router } from 'express';
import { z } from 'zod';

import { ValidationError } from '../lib/errors';
import { getLogger } from '../lib/logger';
import { requireAuth } from '../middleware/auth';
import { imageCache } from '../services/imageCacheService';

const log = getLogger('image');

// Browsers may cache the proxied bytes for a day; the on-disk cache keeps
// them for ~7d, so a re-fetch from the browser still skips the upstream.
const BROWSER_CACHE_SECONDS = 24 * 60 * 60;

const querySchema = z.object({
  src: z.string().min(1, 'src is required').max(2048, 'src is too long'),
});

export const imageRouter = Router();

imageRouter.use(requireAuth);

imageRouter.get('/', async (req, res, next) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? 'Invalid query parameters'
      );
    }

    const result = await imageCache.get(parsed.data.src);

    res.set('Content-Type', result.contentType);
    res.set('Content-Length', String(result.size));
    res.set('Cache-Control', `private, max-age=${BROWSER_CACHE_SECONDS}`);
    res.set('X-Overhearr-Image-Cache', result.fromCache ? 'HIT' : 'MISS');

    const stream = createReadStream(result.filePath);
    stream.on('error', (err) => {
      log.warn({ err }, 'image stream failed');
      if (!res.headersSent) {
        next(err);
      } else {
        res.destroy(err);
      }
    });
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

export default imageRouter;
