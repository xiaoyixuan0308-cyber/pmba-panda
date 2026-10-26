import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page reads the local SQLite database at request time, so the
  // template's cacheComponents / partial prefetching modes are turned off.
  serverExternalPackages: ["better-sqlite3"],
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
