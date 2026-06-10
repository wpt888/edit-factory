import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: "standalone",

  // Pin the workspace root to this folder. The repo has multiple lockfiles
  // (root, electron/, frontend/), so Next.js would otherwise infer a parent
  // workspace root and nest the standalone output under a `frontend/`
  // subdirectory — placing server.js at .next/standalone/frontend/server.js
  // while postbuild.js copies static assets to .next/standalone/.next/static.
  // That one-level mismatch makes every _next/static/* request 404 (white
  // screen in the Electron shell). Forcing the root flat keeps server.js at
  // .next/standalone/server.js so the copied assets line up.
  outputFileTracingRoot: path.join(__dirname),

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "gomagcdn.ro",
        pathname: "/**",
      },
    ],
  },

  // Prevent "missing required error components" on redeploy by ensuring
  // stale cached chunks trigger a full page reload instead of an error.
  // In dev mode, Turbopack uses path-based chunk names (not content hashes),
  // so aggressive caching would serve stale JS forever.
  async headers() {
    const isDev = process.env.NODE_ENV !== "production";
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: isDev
              ? "no-cache, no-store, must-revalidate"
              : "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/((?!_next/static).*)",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
