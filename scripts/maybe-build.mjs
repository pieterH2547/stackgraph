/**
 * `npm run verify` builds; `npm run verify -- --quick` skips the build and
 * nothing else. CI runs the quick form before a long network job, because a
 * production build proves nothing about whether an import is safe and costs a
 * minute of the timeout.
 */
import { spawnSync } from "node:child_process";

if (process.argv.includes("--quick")) {
  console.log("verify --quick: skipping the production build");
  process.exit(0);
}

const result = spawnSync("npm", ["run", "build"], { stdio: "inherit" });
process.exit(result.status ?? 1);
