/**
 * @type {import('next').NextConfig}
 */
module.exports = {
  reactStrictMode: true,
  swcMinify: true,
  output: 'standalone',
  env: {
    commitTag: process.env.COMMIT_TAG || 'local',
  },
  // No `images.remotePatterns` needed: cover-art / artist images are served
  // through the same-origin proxy at /api/image (rendered with `unoptimized`,
  // so Next's optimizer never fetches an upstream host). See server/routes/image.ts.
  experimental: {
    scrollRestoration: true,
    largePageDataBytes: 256000,
  },
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      issuer: /\.(js|ts)x?$/,
      use: ['@svgr/webpack'],
    });

    return config;
  },
};
