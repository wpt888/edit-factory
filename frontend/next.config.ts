import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
