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
 * Prints `recommended=<n>` and `checksum=<hex>` in a shape GitHub Actions can
 * append straight to $GITHUB_OUTPUT, and exits non-zero when there is nothing
 * to import — a plan recommending nobody must stop the pipeline, not sail
 * through it reporting success.
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

const rows = parseCsv(text);
const recommended = rows.filter(
  (row) => row.import_recommended?.trim().toLowerCase() === "true",
);
const checksum = createHash("sha256").update(text).digest("hex").slice(0, 16);

console.log(`rows=${rows.length}`);
console.log(`recommended=${recommended.length}`);
console.log(`checksum=${checksum}`);

if (recommended.length === 0) {
  console.error("That plan recommends nobody. Refusing to treat it as a plan.");
  process.exit(1);
}
