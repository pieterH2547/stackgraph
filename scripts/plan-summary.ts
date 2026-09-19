/**
 * What a plan actually contains, for the workflow that gates the import on it.
 *
 * This exists because the first version counted recommended rows with
 * `awk -F, '$0 ~ /,true,/'`, which agrees with the real parser right up until
 * a company description contains ", true," — and then it inflates the number
 * that guards a write with no undo. Structured data gets a real parser.
 *
 *   npx tsx scripts/plan-summary.ts data/launchllama-stackgraph-review.csv
 *
 * Prints `recommended=<n>`, `importable=<n>` and `checksum=<hex>` in a shape
 * GitHub Actions can append straight to $GITHUB_OUTPUT, and exits non-zero
 * when there is nothing to import — a plan with nobody in it must stop the
 * pipeline, not sail through it reporting success.
 *
 * Two counts because there are two intakes: `recommended` is the ICP cohort
 * the rubric picked, `importable` is everything the review did not exclude
 * for cause, which is what `--all` writes.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseCsv } from "../src/lib/import/table";

const path = process.argv[2] ?? "data/launchllama-stackgraph-review.csv";

let text: string;
try {
  text = readFileSync(path, "utf8");
} catch {
  console.error(`No plan file at ${path}.`);
  process.exit(1);
}

/** Matches the importer: everything the review did not exclude for cause. */
const intake = process.argv.includes("--all") ? "all" : "recommended";

const rows = parseCsv(text);
const recommended = rows.filter(
  (row) => row.import_recommended?.trim().toLowerCase() === "true",
);
const importable = rows.filter((row) => !row.exclusion_reason?.trim());
const checksum = createHash("sha256").update(text).digest("hex").slice(0, 16);

console.log(`rows=${rows.length}`);
console.log(`recommended=${recommended.length}`);
console.log(`importable=${importable.length}`);
console.log(`checksum=${checksum}`);

const planned = intake === "all" ? importable : recommended;
if (planned.length === 0) {
  console.error(
    intake === "all"
      ? "That plan excludes everybody. Refusing to treat it as a plan."
      : "That plan recommends nobody. Refusing to treat it as a plan.",
  );
  process.exit(1);
}
