import { getDb, truncateAll } from "@/lib/db/client";
import { updateCompany } from "@/lib/db/queries";
import { nowIso } from "@/lib/ids";
import { addCompany } from "@/lib/network";
import type { Company } from "@/lib/types";

export async function resetDatabase(): Promise<void> {
  await truncateAll();
}

/**
 * A company that joined under its own steam: identity settled, still unclaimed
 * until it shows both sides. Generation 0.
 */
export async function joinedCompany(
  url: string,
  name: string,
): Promise<Company> {
  const { company } = await addCompany({
    url,
    name,
    source: "SELF_ADDED",
    status: "UNCLAIMED",
    claimVerifiedAt: nowIso(),
  });
  return company;
}

/** The email step of the claim flow, without the Next request context. */
export async function verifyIdentity(company: Company): Promise<Company> {
  const updated = await updateCompany(company.id, {
    claimVerifiedAt: nowIso(),
    claimName: "Test Owner",
    claimRole: "Founder",
  });
  if (!updated) throw new Error("verification failed");
  return updated;
}

/**
 * Shortcut to a fully claimed company, for tests about what happens *after* a
 * claim rather than about the gate itself.
 */
export async function claimProfile(company: Company): Promise<Company> {
  const updated = await updateCompany(company.id, {
    status: "CLAIMED",
    claimVerifiedAt: company.claimVerifiedAt ?? nowIso(),
    claimedAt: nowIso(),
    claimName: "Test Owner",
    claimRole: "Founder",
    contactEmail: `owner@${company.domain}`,
  });
  if (!updated) throw new Error("claim failed");
  return updated;
}

/**
 * Gives every automatically created independent vendor a contact route, the
 * way site detection would in a real run.
 */
export async function makeEveryMentionedVendorContactable(): Promise<void> {
  const { rows } = await getDb().execute(
    `SELECT id, domain FROM companies
     WHERE source = 'MENTIONED' AND network_eligible = 1 AND contact_email IS NULL`,
  );
  for (const row of rows) {
    await updateCompany(String(row.id), {
      contactEmail: `hi@${String(row.domain)}`,
    });
  }
}

export async function countRows(table: string): Promise<number> {
  const { rows } = await getDb().execute(`SELECT COUNT(*) AS n FROM ${table}`);
  return Number(rows[0]?.n ?? 0);
}

export async function notificationsFor(
  companyId: string,
): Promise<{ status: string; subject: string; body: string }[]> {
  const { rows } = await getDb().execute({
    sql: `SELECT status, subject, body FROM notifications WHERE company_id = ? ORDER BY created_at ASC`,
    args: [companyId],
  });
  return rows.map((row) => ({
    status: String(row.status),
    subject: String(row.subject),
    body: String(row.body),
  }));
}
