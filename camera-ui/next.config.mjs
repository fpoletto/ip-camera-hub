/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/status',
        destination: 'http://127.0.0.1:5001/status',
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
    ];
  },
};

export default nextConfig;
