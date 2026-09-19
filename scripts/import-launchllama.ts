/**
 * Phase 3: create UNCLAIMED profiles from a reviewed score file.
 *
 *   npm run launchllama:import -- --dry-run --limit=100
 *   npm run launchllama:import -- --write --local --limit=100
 *   npm run launchllama:import -- --all --write --local
 *
 * `--all` widens the intake from the ICP cohort to the whole directory minus
 * what the review file excluded outright. The rubric is still what decides
 * *outreach* — who is worth a mention converting — but a graph you can browse
 * needs more than 136 profiles in it, and a row scoring 2/6 is usually a row
 * whose site we never read, not a row we judged and rejected. What stays out
 * is what was excluded for cause: dead sites, directories, crypto projects,
 * agencies and anything without a domain of its own.
 *
 * and only ever deliberately:
 *
 *   npm run launchllama:import -- --write --remote \
 *     --confirm-whouseswhat-production --limit=100
 *
 * What it refuses to do, by construction rather than by care:
 *
 * - write anything without --write (dry run is the default)
 * - touch a remote database without --remote AND
 *   --confirm-whouseswhat-production, both spelled out
 * - import a row the review file excluded for cause
 * - create a single relationship
 * - mark anything CLAIMED
 * - send any email or notification
 * - overwrite a field on an existing company with weaker imported data
 */
import "./load-env";
import { readFile } from "node:fs/promises";
import { ensureSchema, resolvedDatabaseUrl } from "../src/lib/db/client";
import {
  createCompany,
  getCompanyByDomain,
  updateCompany,
} from "../src/lib/db/queries";
import { parseCsv } from "../src/lib/import/table";
import { nameFromDomain, tryNormalizeSiteUrl } from "../src/lib/url";

const DEFAULT_IN = "data/launchllama-stackgraph-review.csv";

interface Options {
  in: string;
  limit: number;
  all: boolean;
  write: boolean;
  local: boolean;
  remote: boolean;
  confirmed: boolean;
}

function parseArgs(argv: string[]): Options {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (match) flags.set(match[1], match[2] ?? "true");
  }
  return {
    in: flags.get("in") ?? DEFAULT_IN,
    limit: Number(flags.get("limit") ?? 0) || 0,
    all: flags.get("all") === "true",
    // Dry run is not a flag you have to remember; writing is.
    write: flags.get("write") === "true",
    local: flags.get("local") === "true",
    remote: flags.get("remote") === "true",
    confirmed: flags.get("confirm-whouseswhat-production") === "true",
  };
}

/** `libsql://stackgraph-xyz.turso.io` -> `stackgraph-xyz.turso.io`. */
function describeTarget(url: string): { host: string; isRemote: boolean } {
  if (url.startsWith("file:")) {
    return { host: url, isRemote: false };
  }
  try {
    return { host: new URL(url).host, isRemote: true };
  } catch {
    return { host: url, isRemote: true };
  }
}

/**
 * The two gates, checked before the schema is even touched. A remote write
 * needs both flags *and* a database that really is remote, so --remote against
 * a local file fails loudly rather than quietly doing something harmless and
 * teaching you the flag doesn't matter.
 */
function assertTargetAllowed(options: Options, url: string): void {
  const { host, isRemote } = describeTarget(url);

  console.log(`Database: ${host}`);
  console.log(`Mode:     ${options.write ? "WRITE" : "DRY RUN"}`);

  if (!options.write) return;

  if (isRemote) {
    if (!options.remote) {
      throw new Error(
        `${host} is a remote database. Writing to it needs --remote and --confirm-whouseswhat-production.`,
      );
    }
    if (!options.confirmed) {
      throw new Error(
        `Refusing to write to ${host} without --confirm-whouseswhat-production.`,
      );
    }
    console.log("Target:   REMOTE, confirmed twice. Proceeding.");
    return;
  }

  if (options.remote) {
    throw new Error(
      `--remote was passed but ${url} is a local file. Check DATABASE_URL before running this.`,
    );
  }
  if (!options.local) {
    throw new Error(
      "Writing to a local database still needs --local, so that --write alone can never be enough.",
    );
  }
}

interface Row {
  name: string;
  website: string;
  domain: string;
  description: string;
  category: string;
  logoUrl: string;
  audience: string;
  score: string;
}

/**
 * Two intakes, one file. The default is the recommended cohort; `--all` is
 * everything the review file did not exclude for cause. An empty
 * `exclusion_reason` is the test in that case, never a low score: the score
 * says how much we know, and for most rows the answer is "we never looked".
 */
function readRows(csv: string, all: boolean): Row[] {
  return parseCsv(csv)
    .filter((row) =>
      all
        ? !(row.exclusion_reason ?? "").trim()
        : row.import_recommended?.toLowerCase() === "true",
    )
    .map((row) => ({
      name: (row.name ?? "").trim(),
      website: (row.website ?? "").trim(),
      domain: (row.domain ?? "").trim(),
      description: (row.description ?? "").trim(),
      category: (row.category ?? "").trim(),
      logoUrl: (row.logo_url ?? "").trim(),
      // Only carried through when the review file genuinely has one.
      audience: (row.audience ?? "").trim(),
      score: (row.icp_score ?? "").trim(),
    }));
}

/**
 * A profile with no category cannot be browsed to, and browsing is most of
 * what an unclaimed profile is for. `Other` is an honest answer where a guess
 * would not be: the category mapper stays deliberately blunt, and whoever
 * claims the company picks the right one.
 */
function categoryOf(row: Row): string {
  return row.category || "Other";
}

/**
 * A directory's "name" field is sometimes a tagline: "API-first Image Hosting
 * for Developers & AI Agents" is not what to put at the top of a profile. In
 * that case the domain is the better guess, and it is marked as derived, so
 * site detection replaces it with whatever the company actually calls itself.
 * The tagline is not thrown away — it becomes the one-liner if there isn't one.
 */
function profileName(name: string, domain: string): { name: string; tagline: string } {
  const wordCount = name.split(/\s+/).filter(Boolean).length;
  const looksLikeTagline = wordCount > 4 || name.length > 34;
  return looksLikeTagline
    ? { name: nameFromDomain(domain), tagline: name }
    : { name, tagline: "" };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const url = resolvedDatabaseUrl();
  assertTargetAllowed(options, url);

  const rows = readRows(await readFile(options.in, "utf8"), options.all);
  const wanted = options.limit ? rows.slice(0, options.limit) : rows;
  console.log(
    `${options.all ? "Not excluded" : "Recommended"} in ${options.in}: ` +
      `${rows.length}. Taking ${wanted.length}.\n`,
  );

  if (options.write) await ensureSchema();

  const counts = { created: 0, filled: 0, skipped: 0, invalid: 0 };

  for (const row of wanted) {
    const site = row.website ? tryNormalizeSiteUrl(row.website) : null;
    if (!site || !row.name) {
      counts.invalid++;
      console.log(`  invalid  ${row.domain || row.website || "(no website)"}`);
      continue;
    }

    const { name, tagline } = profileName(row.name, site.domain);
    const description = row.description || tagline;

    const existing = options.write
      ? await getCompanyByDomain(site.domain)
      : null;

    if (existing) {
      /*
       * Never overwrite. A value someone confirmed, or that detection read
       * from their own site, beats a directory's copy of it every time; this
       * only fills genuine blanks.
       */
      const patch = {
        ...(existing.description || !description ? {} : { description }),
        ...(existing.category ? {} : { category: categoryOf(row) }),
        ...(existing.logoUrl || !row.logoUrl ? {} : { logoUrl: row.logoUrl }),
        ...(existing.audience || !row.audience
          ? {}
          : { audience: row.audience }),
      };

      if (Object.keys(patch).length === 0) {
        counts.skipped++;
        console.log(`  exists   ${site.domain}`);
      } else {
        await updateCompany(existing.id, patch);
        counts.filled++;
        console.log(
          `  filled   ${site.domain} (${Object.keys(patch).join(", ")})`,
        );
      }
      continue;
    }

    if (!options.write) {
      counts.created++;
      console.log(`  would create  ${site.domain.padEnd(28)} ${name}`);
      continue;
    }

    /*
     * status UNCLAIMED and source "launchllama" — provenance the profile page
     * shows as "sourced from public information". No relationship is created,
     * and notifyMention is never called: an import is not outreach.
     */
    await createCompany({
      name,
      domain: site.domain,
      website: site.website,
      description: description || null,
      category: categoryOf(row),
      logoUrl: row.logoUrl || null,
      audience: row.audience || null,
      source: "LAUNCHLLAMA",
      status: "UNCLAIMED",
      generation: 0,
    });
    counts.created++;
    console.log(`  created  ${site.domain.padEnd(28)} ${name}`);
  }

  const line = "-".repeat(64);
  console.log(`\n${line}`);
  console.log(
    options.write
      ? `Created ${counts.created}, filled blanks on ${counts.filled}, left ${counts.skipped} alone, ${counts.invalid} unusable.`
      : `Would create ${counts.created}, ${counts.invalid} unusable. Nothing was written.`,
  );
  console.log("No relationships, no claims, no notifications.");
  console.log(line);

  if (!options.write) {
    console.log(
      "\nTo write locally:  npm run launchllama:import --" +
        (options.all ? " --all" : "") +
        " --write --local" +
        (options.limit ? ` --limit=${options.limit}` : ""),
    );
  }
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
