import "./load-env";
import { ensureSchema, getDb, resolvedDatabaseUrl } from "../src/lib/db/client";

async function main() {
  await ensureSchema();
  const { rows } = await getDb().execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  );
  console.log(`Schema applied to ${resolvedDatabaseUrl()}`);
  console.log(`Tables: ${rows.map((row) => row.name).join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
