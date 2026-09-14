/**
 * Phase 2: score a LaunchLlama export for Stackgraph fit and write a review
 * file. Touches no database, sends nothing, and creates nothing.
 *
 *   npm run launchllama:score -- --in=data/launchllama.csv
 *   npm run launchllama:score -- --in=data/launchllama.json --enrich --limit=400
 *
 * Offline it can only judge what the export actually says, which is usually
 * "is this software" and "is there a B2B use case". `--enrich` reads each site
 * once and is what answers the other three: alive, reachable, running on other
 * independent products. That is slower and it is the difference between a
 * cohort chosen on evidence and one chosen on vibes.
 */
import "./load-env";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { detectSite, findPublishedContactEmail } from "../src/lib/detect";
import { mapCategory } from "../src/lib/import/category";
import {
  byImportPriority,
  dedupeByDomain,
  IMPORT_THRESHOLD,
  scoreRecord,
  summarize,
  type EnrichedFacts,
  type Scored,
} from "../src/lib/import/launchllama";
import { parseSourceFile, toCsv } from "../src/lib/import/table";
import { suggestPoweredBy } from "../src/lib/signals";
import { tryNormalizeSiteUrl } from "../src/lib/url";

const DEFAULT_OUT = "data/launchllama-stackgraph-review.csv";

interface Options {
  in: string;
  out: string;
  limit: number;
  enrich: boolean;
  concurrency: number;
}

function parseArgs(argv: string[]): Options {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (match) flags.set(match[1], match[2] ?? "true");
  }
  const input = flags.get("in") ?? flags.get("input") ?? "";
  if (!input) {
    throw new Error(
      "Point it at the export: --in=data/launchllama.csv (CSV or JSON).",
    );
  }
  return {
    in: input,
    out: flags.get("out") ?? DEFAULT_OUT,
    limit: Number(flags.get("limit") ?? 0) || 0,
    enrich: flags.get("enrich") === "true",
    concurrency: Number(flags.get("concurrency") ?? 6) || 6,
  };
}

/** One pass over a site, answering the three criteria the export can't. */
async function enrichOne(website: string, domain: string): Promise<EnrichedFacts> {
  try {
    const detected = await detectSite(website);
    if (detected.detectedFrom !== "website") return { reachable: false };

    const [contactEmail, tools] = await Promise.all([
      detected.contactEmail
        ? Promise.resolve(detected.contactEmail)
        : findPublishedContactEmail(website, domain),
      suggestPoweredBy(website, domain),
    ]);

    return {
      reachable: true,
      contactEmail: contactEmail ?? null,
      detectedTools: tools.map((tool) => tool.domain),
    };
  } catch {
    return { reachable: false };
  }
}

/** Bounded concurrency: a few hundred sites, politely. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
      }
    }),
  );

  return results;
}

const COLUMNS = [
  "name",
  "website",
  "domain",
  "description",
  "category",
  "source_category",
  "software_signal",
  "team_signal",
  "activity_signal",
  "b2b_signal",
  "contactability_signal",
  "stack_richness_signal",
  "icp_score",
  "confidence",
  "exclusion_reason",
  "import_recommended",
  "source",
];

function toRow(scored: Scored): Record<string, string | number | boolean> {
  return {
    name: scored.name,
    website: scored.website,
    domain: scored.domain,
    description: scored.description,
    category: scored.category,
    source_category: scored.sourceCategory,
    software_signal: scored.signals.software,
    team_signal: scored.signals.smallTeam,
    activity_signal: scored.signals.active,
    b2b_signal: scored.signals.b2bUseCase,
    contactability_signal: scored.signals.contactable,
    stack_richness_signal: scored.signals.stackRichness,
    icp_score: scored.icpScore,
    confidence: scored.confidence,
    exclusion_reason: scored.exclusionReason,
    import_recommended: scored.importRecommended,
    source: scored.source,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const text = await readFile(options.in, "utf8");
  const records = parseSourceFile(text, options.in);

  console.log(`Read ${records.length} records from ${options.in}`);
  const considered = options.limit ? records.slice(0, options.limit) : records;
  if (considered.length !== records.length) {
    console.log(`Scoring the first ${considered.length} (--limit)`);
  }

  const score = (raw: Record<string, string>, enriched?: EnrichedFacts) =>
    scoreRecord(raw, {
      enriched,
      normalizeSite: tryNormalizeSiteUrl,
      mapCategory,
    });

  let scored: Scored[];

  if (!options.enrich) {
    scored = considered.map((raw) => score(raw));
  } else {
    // Score once to find the usable websites, then read only those.
    const first = considered.map((raw) => score(raw));
    console.log(`Reading ${first.filter((r) => r.website).length} websites…`);

    const facts = await mapLimit(first, options.concurrency, async (row, i) => {
      if (!row.website) return undefined;
      if ((i + 1) % 25 === 0) console.log(`  …${i + 1}/${first.length}`);
      return enrichOne(row.website, row.domain);
    });

    scored = considered.map((raw, i) => score(raw, facts[i]));
  }

  const unique = dedupeByDomain(scored).sort(byImportPriority);
  const duplicates = scored.length - unique.length;
  const summary = summarize(unique);

  await mkdir(dirname(options.out), { recursive: true });
  await writeFile(options.out, toCsv(COLUMNS, unique.map(toRow)), "utf8");

  /* --- the report --------------------------------------------------------- */
  const line = "-".repeat(64);
  console.log(`\n${line}`);
  console.log(`Total records read          ${records.length}`);
  console.log(`Duplicate domains merged    ${duplicates}`);
  console.log(`Unique candidates           ${summary.total}`);
  console.log(`Excluded outright           ${summary.excluded}`);
  console.log(line);
  console.log(`Score 0-3                   ${summary.buckets["0-3"]}`);
  console.log(`Score 4                     ${summary.buckets["4"]}`);
  console.log(`Score 5                     ${summary.buckets["5"]}`);
  console.log(`Score 6                     ${summary.buckets["6"]}`);
  console.log(line);
  console.log(`Contactable                 ${summary.contactable}`);
  console.log(
    `Recommended (>= ${IMPORT_THRESHOLD}/6)        ${summary.recommended}`,
  );
  console.log(line);

  if (summary.topCategories.length > 0) {
    console.log("Top categories among the recommended:");
    for (const { category, count } of summary.topCategories.slice(0, 12)) {
      console.log(`  ${String(count).padStart(4)}  ${category}`);
    }
    console.log(line);
  }

  const top = unique.filter((row) => row.importRecommended).slice(0, 100);
  console.log(`Top ${top.length} recommended, in import order:\n`);
  top.forEach((row, index) => {
    console.log(
      `${String(index + 1).padStart(3)}. ${row.icpScore}/6 ${row.confidence.padEnd(6)} ` +
        `${row.domain.padEnd(28)} ${row.category || "-"}`,
    );
  });

  if (!options.enrich) {
    console.log(
      `\nNote: without --enrich, activity, contactability and stack richness` +
        `\nstay unknown for most rows, so these scores are a floor rather than` +
        `\nan estimate. Re-run with --enrich before trusting the cohort.`,
    );
  }
  console.log(`\nReview file: ${options.out}`);
  console.log("No database was touched and nothing was sent.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
