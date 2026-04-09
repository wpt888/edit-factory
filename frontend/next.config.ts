import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: "standalone",

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
