import "./load-env";
import { ensureSchema, getDb } from "../src/lib/db/client";

async function main() {
  await ensureSchema();
  const { rows } = await getDb().execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  );
  console.log(
    `Schema applied to ${process.env.DATABASE_URL ?? "file:./.data/stackgraph.db"}`,
  );
  console.log(`Tables: ${rows.map((row) => row.name).join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
