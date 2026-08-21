import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.resolve(__dirname, '../..'),
  transpilePackages: ['@warhammer-simulator/core'],
  experimental: {
    // Checkpoint saves include the replay timeline and can legitimately be
    // several megabytes once a battle has progressed through many actions.
    proxyClientMaxBodySize: '50mb',
  },
  turbopack: {
    root: path.resolve(__dirname, '../..'),
  },
};

export default nextConfig;
