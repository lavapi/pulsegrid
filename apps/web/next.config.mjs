import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { version } = JSON.parse(readFileSync(join(import.meta.dirname, 'package.json'), 'utf8'));

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  env: { APP_VERSION: version },
  output: 'standalone',
  outputFileTracingRoot: join(import.meta.dirname, '../..'),
  transpilePackages: ['@pulsegrid/shared'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_URL ?? 'http://localhost:4000'}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
