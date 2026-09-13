import "./load-env";
import { truncateAll } from "../src/lib/db/client";

async function main() {
  const url = process.env.DATABASE_URL ?? "file:./.data/stackgraph.db";
  if (!url.startsWith("file:") && process.env.ALLOW_REMOTE_RESET !== "1") {
    throw new Error(
      `Refusing to empty a remote database (${url}). Set ALLOW_REMOTE_RESET=1 if you really mean it.`,
    );
  }

  await truncateAll();
  console.log(`Emptied every table in ${url}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
