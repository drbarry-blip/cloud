import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(here, "src"),
      // "server-only" throws outside Next.js's server bundler; tests run on the server anyway.
      "server-only": path.join(here, "test/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // The first in-process database in each file is built and migrated from scratch,
    // which can take several seconds on a busy CI runner.
    testTimeout: 30_000,
    env: { PLAYBOOK_DIR: path.join(here, "../../playbook") },
  },
});
