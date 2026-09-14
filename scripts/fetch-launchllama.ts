/**
 * Phase 1: get the real directory, from the door Launch Llama put out for
 * agents.
 *
 *   npm run launchllama:fetch
 *   npm run launchllama:fetch -- --out=data/launchllama.csv --type=community
 *
 * Provenance, because this matters more than the code:
 *
 * - `tools.launchllama.co/llms.txt` documents an "open REST + MCP API for
 *   agents. No API key for reads", and says to prefer the OpenAPI spec over
 *   HTML when fetching as an agent. This reads that API and nothing else.
 * - `tools.launchllama.co/robots.txt` allows `/` for `User-agent: *` and
 *   disallows `/api/`, `/dashboard`, `/auth`, `/admin`, `/notifications` and
 *   `/reset-password`. The catalog API is a separate host, so that Disallow
 *   does not cover it — and we touch none of those paths on either host.
 * - Reads only: GET /products. Never POST /submissions, which is how an agent
 *   would open a listing draft. We are not submitting anything to anyone.
 * - One request at a time with a pause between, and a User-Agent that says who
 *   we are, because a polite import is the only kind worth running.
 *
 * No login, no paywall, nothing behind either.
 */
import "./load-env";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { toCsv } from "../src/lib/import/table";
import { tryNormalizeSiteUrl } from "../src/lib/url";

const API = "https://kxdushqmihjyuddcwkpw.supabase.co/functions/v1/api-v1";
const USER_AGENT =
  "Stackgraph-import/0.1 (+https://github.com/pieterH2547/stackgraph)";
/** The API caps a page at 50. */
const PAGE = 50;
const PAUSE_MS = 250;

interface ApiProduct {
  id?: string;
  name?: string;
  slug?: string;
  tagline?: string;
  website_url?: string;
  logo_url?: string;
  categories?: string[];
  maker_name?: string;
  upvotes?: number;
  type?: string;
  featured?: boolean;
  created_at?: string;
  url?: string;
}

interface ApiPage {
  results?: ApiProduct[];
  count?: number;
}

function parseArgs(argv: string[]) {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (match) flags.set(match[1], match[2] ?? "true");
  }
  return {
    out: flags.get("out") ?? "data/launchllama.csv",
    /** "community", "product_hunt", or unset for both. */
    type: flags.get("type") ?? "",
    max: Number(flags.get("max") ?? 0) || 0,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getPage(offset: number, type: string): Promise<ApiPage> {
  const url = new URL(`${API}/products`);
  url.searchParams.set("limit", String(PAGE));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("period", "all");
  if (type) url.searchParams.set("type", type);

  for (let attempt = 1; attempt <= 4; attempt++) {
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
    });

    if (response.ok) return (await response.json()) as ApiPage;

    // Back off rather than hammer: 429 and 5xx are the server asking us to wait.
    if (response.status === 429 || response.status >= 500) {
      const wait = 1000 * 2 ** (attempt - 1);
      console.warn(`  ${response.status} at offset ${offset}, retrying in ${wait}ms`);
      await sleep(wait);
      continue;
    }

    throw new Error(`GET ${url.pathname} -> ${response.status}`);
  }

  throw new Error(`Gave up on offset ${offset} after 4 attempts.`);
}

const COLUMNS = [
  "name",
  "website",
  "description",
  "categories",
  "maker_name",
  "created_at",
  "upvotes",
  "type",
  "featured",
  "logo_url",
  "launchllama_url",
];

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const first = await getPage(0, options.type);
  const total = first.count ?? first.results?.length ?? 0;
  const target = options.max ? Math.min(total, options.max) : total;
  console.log(
    `Launch Llama reports ${total} live products${options.type ? ` of type ${options.type}` : ""}. Fetching ${target}.`,
  );

  const products: ApiProduct[] = [...(first.results ?? [])];

  for (let offset = PAGE; offset < target; offset += PAGE) {
    await sleep(PAUSE_MS);
    const page = await getPage(offset, options.type);
    const batch = page.results ?? [];
    if (batch.length === 0) {
      console.log(`  empty page at offset ${offset}, stopping early`);
      break;
    }
    products.push(...batch);
    if (offset % (PAGE * 10) === 0) {
      console.log(`  ${products.length}/${target}`);
    }
  }

  /*
   * Deduplicate here as well as in the scorer. The directory can list the same
   * product twice — a community submission and a Product Hunt mirror — and the
   * graph is keyed on domain, so two rows for one company is one company.
   * Higher upvotes wins, as the more complete of the two rows.
   */
  const byDomain = new Map<string, { row: ApiProduct; domain: string }>();
  let unusable = 0;

  for (const product of products) {
    const site = product.website_url
      ? tryNormalizeSiteUrl(product.website_url)
      : null;
    if (!site || !product.name) {
      unusable++;
      continue;
    }
    const existing = byDomain.get(site.domain);
    if (!existing || (product.upvotes ?? 0) > (existing.row.upvotes ?? 0)) {
      byDomain.set(site.domain, { row: product, domain: site.domain });
    }
  }

  const rows = [...byDomain.values()].map(({ row }) => ({
    name: row.name ?? "",
    website: row.website_url ?? "",
    description: row.tagline ?? "",
    categories: (row.categories ?? []).join(", "),
    maker_name: row.maker_name ?? "",
    created_at: row.created_at ?? "",
    upvotes: row.upvotes ?? 0,
    type: row.type ?? "",
    featured: row.featured ?? false,
    logo_url: row.logo_url ?? "",
    launchllama_url: row.url ?? "",
  }));

  await mkdir(dirname(options.out), { recursive: true });
  await writeFile(options.out, toCsv(COLUMNS, rows), "utf8");

  const line = "-".repeat(64);
  console.log(`\n${line}`);
  console.log(`Fetched            ${products.length}`);
  console.log(`Unusable rows      ${unusable} (no name or no usable website)`);
  console.log(`Unique domains     ${rows.length}`);
  console.log(
    `Community / PH     ${rows.filter((r) => r.type === "community").length} / ${rows.filter((r) => r.type === "product_hunt").length}`,
  );
  console.log(line);
  console.log(`Wrote ${options.out}`);
  console.log("Read-only: no submission, draft or account was created.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
