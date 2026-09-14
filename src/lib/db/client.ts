import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SCHEMA_SQL, TABLES } from "./schema";

/**
 * Local development keeps the database in the project. On a serverless host
 * the filesystem is read-only apart from /tmp, so an unconfigured deployment
 * falls back there: the app runs and the flow is walkable, but the data lives
 * only as long as that instance does. Set DATABASE_URL to a libSQL/Turso URL
 * for anything you want to keep.
 */
const DEFAULT_URL = process.env.VERCEL
  ? "file:/tmp/stackgraph.db"
  : "file:./.data/stackgraph.db";

type GlobalWithDb = typeof globalThis & {
  __stackgraphDb?: Client;
  __stackgraphSchema?: Promise<void>;
};

const g = globalThis as GlobalWithDb;

/**
 * `file:` URLs are a development and test convenience; production points at a
 * libSQL/Turso URL. The path is env-driven by design, so Turbopack's
 * whole-project tracing warning is opted out of here rather than obeyed.
 */
function localFilePath(url: string): string | null {
  if (!url.startsWith("file:")) return null;
  const withoutScheme = url.slice("file:".length).replace(/^\/\//, "");
  return resolve(/* turbopackIgnore: true */ process.cwd(), withoutScheme);
}

/**
 * `DATABASE_URL` is ours. `TURSO_DATABASE_URL` is what Turso's own Vercel
 * integration injects when it provisions a database from the import screen,
 * and accepting it means that button works with nothing typed by hand.
 */
export function resolvedDatabaseUrl(): string {
  return process.env.DATABASE_URL || process.env.TURSO_DATABASE_URL || DEFAULT_URL;
}

function authToken(): string | undefined {
  return process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN;
}

function connect(): Client {
  const url = resolvedDatabaseUrl();
  const file = localFilePath(url);
  if (file) {
    mkdirSync(dirname(file), { recursive: true });
    return createClient({ url: `file:${file}` });
  }
  return createClient({ url, authToken: authToken() });
}

/**
 * One client per process, reused across hot reloads in development.
 * The schema is applied lazily once — every statement is `IF NOT EXISTS`, so
 * this is safe against a database that is already up to date.
 */
export function getDb(): Client {
  if (!g.__stackgraphDb) {
    g.__stackgraphDb = connect();
    g.__stackgraphSchema = undefined;
  }
  if (!g.__stackgraphSchema) {
    g.__stackgraphSchema = g.__stackgraphDb.executeMultiple(SCHEMA_SQL);
  }
  return g.__stackgraphDb;
}

/** Awaits the lazy schema application. Call before the first query in a script. */
export async function ensureSchema(): Promise<void> {
  getDb();
  await g.__stackgraphSchema;
}

/** Test/dev helper: empties every table without dropping the schema. */
export async function truncateAll(): Promise<void> {
  await ensureSchema();
  const db = getDb();
  for (const table of TABLES) {
    await db.execute(`DELETE FROM ${table}`);
  }
}

/** Test helper: forces the next getDb() to reconnect (e.g. after changing env). */
export function resetDbConnection(): void {
  g.__stackgraphDb = undefined;
  g.__stackgraphSchema = undefined;
}
