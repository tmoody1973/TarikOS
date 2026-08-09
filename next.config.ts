import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Stagehand (and its pino logger with worker-thread transports) breaks
  // when bundled — keep it external so Node resolves it at runtime (MOO-485).
  serverExternalPackages: [
    "@browserbasehq/stagehand",
    "pino",
    "pino-pretty",
    "playwright-core",
  ],
  // The service worker must never be cached (MOO-529): a browser holding a
  // stale sw.js keeps running a worker you have already fixed and shipped.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
