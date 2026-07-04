import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A stray lockfile in the home directory confuses workspace-root inference.
  turbopack: { root: path.join(__dirname) },
  experimental: {
    serverActions: {
      // Receipt-scan uploads: a compressed photo is ~150–450KB, but base64
      // inflates it by a third and the 1MB default counts the raw body.
      bodySizeLimit: "3mb",
    },
  },
};

export default nextConfig;
