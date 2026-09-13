/**
 * Next loads `.env` by itself; plain node scripts do not. Without this, a
 * developer with a Turso URL in `.env` would run `db:push` against a local
 * file and wonder why the app can't see the tables.
 *
 * Import this first in every script.
 */
try {
  process.loadEnvFile();
} catch {
  // No .env file, or an unreadable one: the built-in defaults are fine.
}

export {};
