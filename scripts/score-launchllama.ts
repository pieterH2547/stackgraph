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
import { existsSync } from "node:fs";
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
/**
 * Reading 1,200 sites takes about a quarter of an hour of somebody else's
 * bandwidth. The rubric, meanwhile, wants iterating on — the first pass over
 * the real directory put a maker of industrial rubber bellows in the top ten.
 * Caching what each site said makes a rubric change cost seconds instead of
 * another sweep, which is the difference between tuning it and living with it.
 */
const DEFAULT_CACHE = "data/.launchllama-site-cache.json";

interface Options {
  in: string;
  out: string;
  limit: number;
  enrich: boolean;
  /**
   * Read at most this many sites, best offline candidates first. Reading every
   * site in a 3,700-row directory is an hour of somebody else's bandwidth to
   * settle rows that are already excluded, so the default bounds it.
   */
  enrichTop: number;
  concurrency: number;
  cache: string;
  refresh: boolean;
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
    enrichTop: Number(flags.get("enrich-top") ?? 800) || 800,
    concurrency: Number(flags.get("concurrency") ?? 8) || 8,
    cache: flags.get("cache") ?? DEFAULT_CACHE,
    refresh: flags.get("refresh") === "true",
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
    /*
     * Score offline first. That is free and it already rules out the excluded
     * rows and ranks the rest, so the expensive pass reads only the sites that
     * could plausibly make the cohort — best candidates first.
     */
    const first = considered.map((raw) => score(raw));

    const shortlist = new Set(
      first
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => row.website && !row.exclusionReason)
        .sort((a, b) => byImportPriority(a.row, b.row))
        .slice(0, options.enrichTop)
        .map(({ index }) => index),
    );

    console.log(
      `Reading ${shortlist.size} websites (best offline candidates first, --enrich-top=${options.enrichTop})…`,
    );

    const cache: Record<string, EnrichedFacts> =
      !options.refresh && existsSync(options.cache)
        ? JSON.parse(await readFile(options.cache, "utf8"))
        : {};
    const cachedAtStart = Object.keys(cache).length;
    if (cachedAtStart) console.log(`  ${cachedAtStart} already cached`);

    let done = 0;
    let read = 0;
    const facts = await mapLimit(first, options.concurrency, async (row, i) => {
      if (!shortlist.has(i)) return undefined;

      const hit = cache[row.domain];
      if (hit) return hit;

      const result = await enrichOne(row.website, row.domain);
      cache[row.domain] = result;
      read++;
      done++;
      if (done % 50 === 0) console.log(`  …${done}/${shortlist.size}`);
      return result;
    });

    await mkdir(dirname(options.cache), { recursive: true });
    await writeFile(options.cache, JSON.stringify(cache), "utf8");
    console.log(`  read ${read} sites, cache now ${Object.keys(cache).length}`);

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
  } else {
    console.log(
      `\nNote: only the best ${options.enrichTop} offline candidates had their` +
        `\nsites read. Rows below that are a floor, not an estimate.`,
    );
  }
  console.log(`\nReview file: ${options.out}`);
  console.log("No database was touched and nothing was sent.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
