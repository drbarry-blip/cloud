import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // The monorepo root, so the standalone build traces the shared core package.
  outputFileTracingRoot: repoRoot,
  transpilePackages: ["@cgs/core"],
  serverExternalPackages: ["pg", "@electric-sql/pglite", "playwright-core"],
  poweredByHeader: false,
  // Don't write AGENTS.md / CLAUDE.md into the repo on `next dev`.
  agentRules: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Never let intermediaries cache tool responses; they can contain pasted text.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
