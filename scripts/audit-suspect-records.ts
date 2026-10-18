/**
 * Read-only audit: which rows in this database are not real companies?
 *
 * Writes nothing. Every statement here is a SELECT, there is no `--write`
 * flag to add later, and the output is a list for a human to act on by hand.
 * That is deliberate: deciding that a profile is fake is a judgement call,
 * and a script that could act on its own guess would eventually delete
 * somebody's real company because its name happened to contain "test".
 *
 * It opens its own connection rather than using `getDb()`, and that is the
 * difference between saying read-only and being it. The shared client applies
 * the schema on first use — `CREATE TABLE IF NOT EXISTS` and three
 * `ALTER TABLE`s. Those are no-ops against a database that is already up to
 * date, which is exactly why they are easy to wave through, but they are DDL
 * and they execute. A tool whose whole purpose is to be safe to point at
 * production should not be issuing statements that would change it if its
 * assumptions were wrong. So: a bare client, SELECTs only, and a missing
 * table is reported rather than created.
 *
 *   npm run audit:suspect              # the configured database
 *   DATABASE_URL=... npm run audit:suspect
 *   npm run audit:suspect -- --json    # machine-readable, for a ticket
 *
 * Four things it looks for, each with the evidence attached:
 *
 *  1. demo rows      — `is_demo = 1`, which only the development fixture sets
 *  2. probe rows     — names and domains shaped like somebody's test record
 *  3. hosted pages   — profiles whose domain belongs to a platform rather
 *                      than to them, the `tally.so` shape
 *  4. hollow claims  — CLAIMED without the two credits the flow requires,
 *                      which the claim flow cannot produce
 */
import "./load-env";
import { createClient, type Client } from "@libsql/client";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { looksLikeTestRecord } from "../src/lib/audit";
import { resolvedDatabaseUrl } from "../src/lib/db/client";
import { REQUIRED_UPSTREAM } from "../src/lib/limits";
import { hostedPage } from "../src/lib/url";

/**
 * A connection of our own, with no schema application anywhere near it.
 *
 * `resolvedDatabaseUrl` is reused because reading the same environment
 * variables as the app is the point — but nothing else from the shared
 * client is, because everything else there is allowed to write.
 */
function readOnlyClient(): Client {
  const url = resolvedDatabaseUrl();
  if (url.startsWith("file:")) {
    /*
     * Checked before connecting, because the driver creates the file on
     * open. An empty database would then be reported as a clean audit, which
     * is the most misleading thing this script could possibly say — and it
     * would have written to disk to say it.
     */
    const path = resolve(url.slice("file:".length).replace(/^\/\//, ""));
    if (!existsSync(path)) {
      throw new Error(
        `No database at ${path}. Nothing was created — check DATABASE_URL.`,
      );
    }
    return createClient({ url: `file:${path}` });
  }
  return createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN,
  });
}

/** `companies` missing means this is not the database you meant. Say so. */
async function requireTables(db: Client): Promise<void> {
  const { rows } = await db.execute(
    `SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name IN ('companies', 'relationships', 'company_members')`,
  );
  const present = new Set(rows.map((row) => String(row.name)));
  const missing = ["companies", "relationships", "company_members"].filter(
    (table) => !present.has(table),
  );
  if (missing.length > 0) {
    throw new Error(
      `This database has no ${missing.join(", ")} table. Nothing was created — ` +
        `point DATABASE_URL at the right database, or run the app once against ` +
        `it if it really is meant to be new.`,
    );
  }
}

interface Suspect {
  category: string;
  slug: string;
  name: string;
  domain: string;
  status: string;
  source: string;
  createdAt: string;
  incoming: number;
  outgoing: number;
  /** Why this row is in the list, in words. */
  evidence: string;
}

function flag(row: Record<string, unknown>, category: string, evidence: string): Suspect {
  return {
    category,
    slug: String(row.slug),
    name: String(row.name),
    domain: String(row.domain),
    status: String(row.status),
    source: String(row.source),
    createdAt: String(row.created_at),
    incoming: Number(row.incoming ?? 0),
    outgoing: Number(row.outgoing ?? 0),
    evidence,
  };
}

async function main() {
  const json = process.argv.includes("--json");
  const url = resolvedDatabaseUrl();

  const db = readOnlyClient();
  await requireTables(db);

  const { rows } = await db.execute(
    `SELECT c.id, c.slug, c.name, c.domain, c.status, c.source, c.is_demo,
            c.website, c.created_at, c.claim_verified_at, c.claimed_at,
            (SELECT COUNT(*) FROM relationships r
              WHERE r.target_company_id = c.id AND r.state != 'DISPUTED') AS incoming,
            (SELECT COUNT(*) FROM relationships r
              WHERE r.source_company_id = c.id AND r.state != 'DISPUTED') AS outgoing,
            (SELECT COUNT(*) FROM relationships r
              JOIN companies t ON t.id = r.target_company_id
              WHERE r.source_company_id = c.id
                AND r.state != 'DISPUTED'
                AND t.network_eligible = 1) AS credits,
            (SELECT COUNT(*) FROM company_members m
              WHERE m.company_id = c.id) AS members
       FROM companies c
      ORDER BY c.created_at`,
  );

  const suspects: Suspect[] = [];

  for (const row of rows) {
    const name = String(row.name);
    const domain = String(row.domain);

    if (Number(row.is_demo) === 1) {
      suspects.push(
        flag(row, "demo", "is_demo = 1 — written only by the development fixture"),
      );
    }

    const testRecord = looksLikeTestRecord(name, domain);
    if (testRecord) {
      suspects.push(flag(row, "probe", `${testRecord} reads as a test record`));
    }

    // A profile whose own website is a page on somebody else's platform.
    const page = hostedPage(String(row.website ?? "")) ?? hostedPage(domain);
    if (page) {
      suspects.push(
        flag(
          row,
          "hosted-page",
          `owns ${domain}, but its site is a page on ${page.host} — every company crediting ${page.host} is pointed here`,
        ),
      );
    }

    // The claim flow cannot produce this: it marks a company CLAIMED only
    // once REQUIRED_UPSTREAM eligible credits exist. So either an admin set
    // the status by hand, or an older build claimed on e-mail alone.
    if (
      String(row.status) === "CLAIMED" &&
      Number(row.credits) < REQUIRED_UPSTREAM
    ) {
      suspects.push(
        flag(
          row,
          "hollow-claim",
          `CLAIMED with ${row.credits} of ${REQUIRED_UPSTREAM} required credits, ` +
            `${row.members} membership row(s) — not reachable through the claim flow`,
        ),
      );
    }
  }

  if (json) {
    console.log(JSON.stringify({ database: url, total: rows.length, suspects }, null, 2));
    return;
  }

  const line = "-".repeat(78);
  console.log(`\nRead-only audit · ${rows.length} companies\n${line}`);

  const byCategory = new Map<string, Suspect[]>();
  for (const suspect of suspects) {
    const list = byCategory.get(suspect.category) ?? [];
    list.push(suspect);
    byCategory.set(suspect.category, list);
  }

  if (suspects.length === 0) {
    console.log("Nothing suspect found.");
  }

  for (const [category, list] of byCategory) {
    console.log(`\n${category.toUpperCase()}  (${list.length})`);
    for (const s of list) {
      console.log(
        `  ${s.domain.padEnd(32)} ${s.status.padEnd(9)} ${s.source.padEnd(11)} ` +
          `in:${String(s.incoming).padStart(2)} out:${String(s.outgoing).padStart(2)}  /c/${s.slug}`,
      );
      console.log(`      ${s.evidence}`);
    }
  }

  console.log(`\n${line}`);
  console.log(
    `${suspects.length} row(s) flagged across ${byCategory.size} categor${
      byCategory.size === 1 ? "y" : "ies"
    }. Nothing was changed.`,
  );
  console.log(
    "Each one needs a human decision. A flagged row with incoming edges cannot\n" +
      "simply be deleted: the edges point at it, and deleting it rewrites what\n" +
      "another company said about its own stack.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
