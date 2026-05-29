/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/status',
        destination: 'http://127.0.0.1:5001/status',
      },
      {
        source: '/auth/:path*',
        destination: 'http://127.0.0.1:5001/auth/:path*',
      },
      {
        source: '/stream/:path*',
        destination: 'http://127.0.0.1:5001/stream/:path*',
      },
      {
        source: '/capture/:path*',
        destination: 'http://127.0.0.1:5001/capture/:path*',
      },
      {
        source: '/ptz/:path*',
        destination: 'http://127.0.0.1:5001/ptz/:path*',
      },
      {
        source: '/audio/:path*',
        destination: 'http://127.0.0.1:5001/audio/:path*',
      },
      {
        source: '/discovery',
        destination: 'http://127.0.0.1:5001/discovery',
      },
      {
        source: '/health',
        destination: 'http://127.0.0.1:5001/health',
      },
      {
        source: '/go2rtc/:path*',
        destination: 'http://127.0.0.1:1984/:path*',
      },
    ];
  },
};

export default nextConfig;
