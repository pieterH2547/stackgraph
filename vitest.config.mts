import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["./src/test/setup.ts"],
    // Every test file talks to the same SQLite file and truncates between
    // tests, so they must not run in parallel. The suite is small.
    pool: "forks",
    fileParallelism: false,
  },
});
