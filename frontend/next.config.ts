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
};

export default nextConfig;
