/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Don't let Next's automatic trailing-slash redirects mangle the Socket.io
  // handshake path before it can be proxied to the backend.
  skipTrailingSlashRedirect: true,
  // The backend is proxied through Next.js API routes so the browser only ever
  // talks to the same origin (required for the Arena preview environment).
  async rewrites() {
    const backend = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    return [
      { source: '/api/:path*', destination: `${backend}/api/:path*` },
      // Proxy the Socket.io handshake (HTTP long-polling + websocket upgrade).
      // Exact paths first (with a trailing slash on the destination) so the
      // handshake path survives Next's URL normalisation.
      { source: '/socket.io', destination: `${backend}/socket.io/` },
      { source: '/socket.io/', destination: `${backend}/socket.io/` },
      { source: '/socket.io/:path*', destination: `${backend}/socket.io/:path*` },
    ];
  },
};

export default nextConfig;
