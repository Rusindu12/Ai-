/**
 * Next.js config.
 *
 * Two modes:
 *  - Web (default): proxies /api/* and /socket.io/* to the backend via rewrites
 *    so the browser only talks to one origin.
 *  - Mobile/standalone (NEXT_STATIC_EXPORT=true): produces a static `out/`
 *    bundle for Capacitor. No rewrites (not supported with static export) —
 *    the app talks to the backend via the absolute NEXT_PUBLIC_API_URL /
 *    NEXT_PUBLIC_WS_URL instead.
 */
const staticExport = process.env.NEXT_STATIC_EXPORT === 'true';

const rewrites = async () => {
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
};

const nextConfig = {
  reactStrictMode: true,
  // Don't let Next's automatic trailing-slash redirects mangle the Socket.io
  // handshake path before it can be proxied to the backend.
  skipTrailingSlashRedirect: true,
  ...(staticExport
    ? {
        output: 'export',
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : { rewrites }),
};

export default nextConfig;
