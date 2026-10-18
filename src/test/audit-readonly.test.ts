import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

/**
 * The audit calls itself read-only. This is the test that makes that a fact
 * rather than a comment.
 *
 * It runs the real script as a subprocess against a real database file and
 * compares the bytes. A unit test could not do this: the thing being checked
 * is precisely whether the process opens a connection that is allowed to
 * write, and that only shows up at the file.
 */

const SCRIPT = resolve(__dirname, "../../scripts/audit-suspect-records.ts");
const ROOT = resolve(__dirname, "../..");

function runAudit(databaseUrl: string): { ok: boolean; output: string } {
  try {
    const output = execFileSync(
      "npx",
      ["tsx", SCRIPT],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return { ok: true, output };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

function digest(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** The file with comments stripped, so prose about the code is not the code. */
function codeOf(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** A database with the schema and a couple of rows, built by the app itself. */
async function seedFixture(path: string): Promise<void> {
  process.env.DATABASE_URL = `file:${path}`;
  const { resetDbConnection, ensureSchema } = await import("@/lib/db/client");
  resetDbConnection();
  await ensureSchema();
  const { createCompany } = await import("@/lib/db/queries");
  await createCompany({
    name: "Probe 1789743723689",
    domain: "probe.example.com",
    website: "https://probe.example.com",
    source: "LAUNCHLLAMA",
    status: "UNCLAIMED",
  });
  await createCompany({
    name: "Acme",
    domain: "acme.dev",
    website: "https://acme.dev",
    source: "SELF_ADDED",
    status: "UNCLAIMED",
  });
  resetDbConnection();
}

describe("the audit script is read-only in fact, not only in its comment", () => {
  it("leaves the database byte-for-byte identical", async () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-readonly-"));
    const path = join(dir, "graph.db");
    await seedFixture(path);

    const before = digest(path);
    const beforeMtime = statSync(path).mtimeMs;

    const result = runAudit(`file:${path}`);

    expect(result.ok, result.output).toBe(true);
    // It found the probe row, so it really did read the database.
    expect(result.output).toContain("probe.example.com");
    expect(digest(path)).toBe(before);
    expect(statSync(path).mtimeMs).toBe(beforeMtime);
  }, 120_000);

  it("creates nothing when pointed at a database that does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "audit-readonly-"));
    const path = join(dir, "not-there.db");

    const result = runAudit(`file:${path}`);

    // Refusing is the only safe answer: an empty database would otherwise be
    // reported as a clean audit.
    expect(result.ok).toBe(false);
    expect(result.output).toContain("No database at");
    expect(existsSync(path)).toBe(false);
  }, 120_000);

  it("does not import the shared client, which applies the schema", () => {
    // The file explains in a comment why it avoids `getDb()`, so the check
    // has to look at code rather than at prose about the code.
    const source = codeOf(SCRIPT);
    // `resolvedDatabaseUrl` is fine — it only reads environment variables.
    // `getDb` and `ensureSchema` are not: both run DDL on first use.
    expect(source).not.toMatch(/\bensureSchema\b/);
    expect(source).not.toMatch(/\bgetDb\b/);
    expect(source).not.toMatch(/\btruncateAll\b/);
  });

  it("issues no statement that could write", () => {
    const source = codeOf(SCRIPT);
    // Every execute() in the file, with its first SQL keyword.
    const statements = [...source.matchAll(/execute\(\s*`?\s*(\w+)/g)].map(
      (match) => match[1].toUpperCase(),
    );

    expect(statements.length).toBeGreaterThan(0);
    for (const keyword of statements) {
      expect(keyword, `found a ${keyword} statement`).toBe("SELECT");
    }
  });
});
