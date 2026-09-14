/**
 * DEVELOPMENT FIXTURE — NOT PRODUCTION DATA.
 *
 * Every relationship below is invented so the graph can be looked at: both
 * sides of a profile, claimed/unclaimed states, the local and global graphs,
 * generations and the K-factor maths. The companies are real, the "uses"
 * claims are not, and every row is written with `is_demo = 1` so it can be
 * told apart from anything real.
 *
 * Note what this no longer does: nobody names their own customers. Every edge
 * below is a company stating its own stack, and the `used by` side of each
 * profile is whatever falls out of that — which is exactly how the real
 * product works.
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
import { addCompany, submitStack } from "../src/lib/network";
import { nowIso } from "../src/lib/ids";
import type { Company } from "../src/lib/types";

const url = resolvedDatabaseUrl();
const isLocalFile = url.startsWith("file:");

/** The email step of a claim. The two credits still have to be earned. */
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

  // The claim itself: two independent tools. Stripe sits in the stack in
  // plain sight without counting towards them.
  await submitStack({
    companyId: acme.id,
    tools: [
      { name: "Tally", website: "https://tally.so" },
      { name: "Plausible", website: "https://plausible.io" },
      { name: "Stripe", website: "https://stripe.com" },
    ],
  });

  /* Generation 1: a vendor Acme credited claims, and names its own stack. */
  const tally = await verify(await need("tally.so"), "Marie Martens", "Co-founder");
  await submitStack({
    companyId: tally.id,
    tools: [
      { name: "PostHog", website: "https://posthog.com" },
      { name: "Resend", website: "https://resend.com" },
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

  /*
   * Three more companies crediting their own stacks, which is the only way a
   * `used by` list is ever populated: Acme and Tally end up with users
   * because these three said so about themselves, not because anyone claimed
   * a customer.
   */
  for (const seed of [
    {
      url: "https://northwind.dev",
      name: "Northwind",
      description: "Shift planning for independent retailers.",
      category: "Productivity" as const,
      person: ["Dana Okafor", "Founder"] as const,
      stack: [
        { existingCompanyId: acme.id },
        { name: "Plausible", website: "https://plausible.io" },
      ],
    },
    {
      url: "https://kettle.app",
      name: "Kettle",
      description: "Invoicing built for one-person studios.",
      category: "Billing & payments" as const,
      person: ["Arno Beits", "Co-founder"] as const,
      stack: [
        { existingCompanyId: acme.id },
        { name: "Resend", website: "https://resend.com" },
      ],
    },
    {
      url: "https://senja.io",
      name: "Senja",
      description: "Collect and show testimonials.",
      category: "Social proof" as const,
      person: ["Wilson Wilson", "Co-founder"] as const,
      stack: [
        { existingCompanyId: tally.id },
        { name: "Framer", website: "https://framer.com" },
      ],
    },
  ]) {
    const existing = await getCompanyByDomain(new URL(seed.url).hostname);
    const company = existing
      ? existing
      : (
          await addCompany({
            url: seed.url,
            name: seed.name,
            description: seed.description,
            category: seed.category,
            source: "SEED",
            status: "UNCLAIMED",
          })
        ).company;

    const verified = await verify(company, seed.person[0], seed.person[1]);
    await submitStack({ companyId: verified.id, tools: seed.stack });
  }

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
    "framer.com",
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
