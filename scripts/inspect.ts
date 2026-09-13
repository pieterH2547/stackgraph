/** Ad-hoc read-only dump of the local graph. Handy while developing. */
import "./load-env";
import { getDb } from "../src/lib/db/client";

async function main() {
  const db = getDb();
  const companies = await db.execute(
    `SELECT name, domain, status, source, generation AS gen, network_eligible AS elig,
            category, detected_from AS det, contact_email AS email,
            CASE WHEN logo_url IS NULL THEN 'no' ELSE 'yes' END AS logo
     FROM companies ORDER BY generation, name`,
  );
  for (const row of companies.rows) console.log(JSON.stringify(row));

  const notifications = await db.execute(
    `SELECT c.name, n.status, n.mention_count_at_send AS mentions, n.to_email AS recipient
     FROM notifications n JOIN companies c ON c.id = n.company_id
     ORDER BY n.created_at`,
  );
  console.log("--- claim notifications ---");
  for (const row of notifications.rows) console.log(JSON.stringify(row));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
