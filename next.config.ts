import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone", // a self-contained server for the Docker image (see Dockerfile)
  serverExternalPackages: ["better-sqlite3"],
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
