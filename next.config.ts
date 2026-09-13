import type { NextConfig } from "next";

/**
 * Set NEXT_PUBLIC_BASE_PATH (e.g. "/test1") to serve the app under a path
 * instead of a domain root — for a rewrite from another site, say. Leave it
 * unset for a normal deployment.
 */
const base = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/$/, "");

const nextConfig: NextConfig = {
  // Company logos are served from arbitrary vendor domains, so they render with
  // a plain <img> rather than next/image. Nothing to configure here yet.
  ...(base ? { basePath: base, assetPrefix: base } : {}),
};

export default nextConfig;
