/**
 * DEVELOPMENT FIXTURE — NOT PRODUCTION DATA.
 *
 * Every relationship below is invented so the graph can be looked at: both
 * sides of a profile, claimed/unclaimed states, the local and global graphs,
 * generations and the K-factor maths. The companies are real, the "uses"
 * claims are not, and every row is written with `is_demo = 1` so it can be
 * told apart from anything real.
 *
 *   npm run db:seed                      # local file database only
 *   ALLOW_DEMO_SEED=1 npm run db:seed    # required for any other database
 *
 * Production seeding is a different job: real companies, added in /admin, who
 * then go through the same claim flow as everyone else.
 */
import "./load-env";
import { ensureSchema, getDb, resolvedDatabaseUrl } from "../src/lib/db/client";
import { getCompanyByDomain, updateCompany } from "../src/lib/db/queries";
import { addCompany, submitCustomers, submitStack } from "../src/lib/network";
import { nowIso } from "../src/lib/ids";
import type { Company } from "../src/lib/types";

const url = resolvedDatabaseUrl();
const isLocalFile = url.startsWith("file:");

/** The email step of a claim. The three edges still have to be earned. */
async function verify(company: Company, name: string, role: string) {
  const updated = await updateCompany(company.id, {
    claimVerifiedAt: nowIso(),
    claimName: name,
    claimRole: role,
    contactEmail: `founder@${company.domain}`,
  });
  if (!updated) throw new Error(`could not verify ${company.domain}`);
  return updated;
}

async function need(domain: string): Promise<Company> {
  const company = await getCompanyByDomain(domain);
  if (!company) throw new Error(`Expected ${domain} to exist by now`);
  return company;
}

async function markDemo(domains: string[]) {
  for (const domain of domains) {
    await getDb().execute({
      sql: `UPDATE companies SET is_demo = 1 WHERE domain = ?`,
      args: [domain],
    });
  }
}

async function main() {
  if (!isLocalFile && process.env.ALLOW_DEMO_SEED !== "1") {
    throw new Error(
      `Refusing to write demo data to ${url}. Demo relationships are invented; set ALLOW_DEMO_SEED=1 only for a throwaway database.`,
    );
  }

  await ensureSchema();

  /* Generation 0: a company that joined under its own steam. */
  const { company: created } = await addCompany({
    url: "https://acme.dev",
    name: "Acme",
    description: "AI support for small SaaS teams.",
    category: "Customer support",
    audience: "Small SaaS teams",
    builtBy: "Two founders",
    source: "SEED",
    status: "UNCLAIMED",
  });
  const acme = await verify(created, "Sam Rivera", "Founder");

  // Both halves of the claim. Stripe sits in the stack without counting.
  await submitStack({
    companyId: acme.id,
    tools: [
      { name: "Tally", website: "https://tally.so" },
      { name: "Plausible", website: "https://plausible.io" },
      { name: "Stripe", website: "https://stripe.com" },
    ],
  });
  await submitCustomers({
    companyId: acme.id,
    customers: [
      { name: "Northwind", website: "https://northwind.dev" },
      { name: "Kettle", website: "https://kettle.app" },
    ],
  });

  /* Generation 1: a vendor Acme credited claims, and names its own sides. */
  const tally = await verify(await need("tally.so"), "Marie Martens", "Co-founder");
  await submitStack({
    companyId: tally.id,
    tools: [
      { name: "PostHog", website: "https://posthog.com" },
      { name: "Resend", website: "https://resend.com" },
    ],
  });
  await submitCustomers({
    companyId: tally.id,
    customers: [
      // Acme already said it uses Tally: both ends now agree.
      { existingCompanyId: acme.id },
      { name: "Senja", website: "https://senja.io" },
    ],
  });

  /* Generation 2: and one of those does the same, unprompted. */
  const resend = await verify(await need("resend.com"), "Zeno Rocha", "Founder");
  await submitStack({
    companyId: resend.id,
    tools: [
      { name: "Linear", website: "https://linear.app" },
      { name: "Crisp", website: "https://crisp.chat" },
      { name: "Cal", website: "https://cal.com" },
    ],
  });
  await submitCustomers({
    companyId: resend.id,
    customers: [
      { existingCompanyId: tally.id },
      { name: "Tinybird", website: "https://tinybird.co" },
    ],
  });

  await markDemo([
    "acme.dev",
    "tally.so",
    "plausible.io",
    "stripe.com",
    "northwind.dev",
    "kettle.app",
    "posthog.com",
    "resend.com",
    "senja.io",
    "linear.app",
    "crisp.chat",
    "cal.com",
    "tinybird.co",
  ]);

  const { rows } = await getDb().execute(
    `SELECT
       (SELECT COUNT(*) FROM companies) AS companies,
       (SELECT COUNT(*) FROM relationships) AS relationships,
       (SELECT COUNT(*) FROM companies WHERE status = 'CLAIMED') AS claimed,
       (SELECT COUNT(*) FROM notifications) AS notifications`,
  );
  const summary = rows[0];

  console.log("Demo graph written (is_demo = 1 on every row).");
  console.log(
    `companies=${summary.companies} relationships=${summary.relationships} claimed=${summary.claimed} notifications=${summary.notifications}`,
  );
  console.log("Claimed: Acme, Tally, Resend. Everything else is unclaimed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
