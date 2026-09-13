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
  ? "file:/tmp/smallstack.db"
  : "file:./.data/smallstack.db";

type GlobalWithDb = typeof globalThis & {
  __smallstackDb?: Client;
  __smallstackSchema?: Promise<void>;
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

function connect(): Client {
  const url = process.env.DATABASE_URL || DEFAULT_URL;
  const file = localFilePath(url);
  if (file) {
    mkdirSync(dirname(file), { recursive: true });
    return createClient({ url: `file:${file}` });
  }
  return createClient({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });
}

/**
 * One client per process, reused across hot reloads in development.
 * The schema is applied lazily once — every statement is `IF NOT EXISTS`, so
 * this is safe against a database that is already up to date.
 */
export function getDb(): Client {
  if (!g.__smallstackDb) {
    g.__smallstackDb = connect();
    g.__smallstackSchema = undefined;
  }
  if (!g.__smallstackSchema) {
    g.__smallstackSchema = g.__smallstackDb.executeMultiple(SCHEMA_SQL);
  }
  return g.__smallstackDb;
}

/** Awaits the lazy schema application. Call before the first query in a script. */
export async function ensureSchema(): Promise<void> {
  getDb();
  await g.__smallstackSchema;
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
  g.__smallstackDb = undefined;
  g.__smallstackSchema = undefined;
}
