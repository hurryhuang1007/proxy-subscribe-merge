import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  transpilePackages: ['animal-island-ui'],
  async rewrites() {
    return [{ source: '/sub', destination: '/api/sub' }];
  },
};

export default nextConfig;
