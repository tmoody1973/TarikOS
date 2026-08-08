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
};

export default nextConfig;
