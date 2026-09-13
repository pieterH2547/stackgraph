import { getDb } from "./db/client";
import { newId, newToken, nowIso } from "./ids";
import type { Claim } from "./types";

const TTL_HOURS = 72;

/** Free-mail domains can't prove anything, so they never auto-approve. */
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "aol.com",
  "yandex.com",
  "mail.com",
]);

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value.trim());
}

export function emailDomain(email: string): string {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

/**
 * Lightweight verification, on purpose. A work address on the company's own
 * domain is proof enough for an MVP; anything else still gets a link, but the
 * claim is flagged so a human can look at it in admin.
 */
export function claimDomainMatches(email: string, companyDomain: string): boolean {
  const from = emailDomain(email);
  if (!from || PUBLIC_EMAIL_DOMAINS.has(from)) return false;
  const target = companyDomain.toLowerCase();
  return from === target || from.endsWith(`.${target}`) || target.endsWith(`.${from}`);
}

function mapClaim(row: Record<string, unknown>): Claim {
  return {
    id: String(row.id),
    companyId: String(row.company_id),
    email: String(row.email),
    name: String(row.name),
    role: String(row.role),
    token: String(row.token),
    expiresAt: String(row.expires_at),
    domainMatch: Number(row.domain_match ?? 0) === 1,
    confirmedAt: row.confirmed_at === null ? null : String(row.confirmed_at),
    createdAt: String(row.created_at),
  };
}

export async function createClaim(input: {
  companyId: string;
  email: string;
  name: string;
  role: string;
  domainMatch: boolean;
}): Promise<Claim> {
  const id = newId();
  const token = newToken();
  const expiresAt = new Date(Date.now() + TTL_HOURS * 3600 * 1000).toISOString();

  await getDb().execute({
    sql: `INSERT INTO claims
            (id, company_id, email, name, role, token, expires_at, domain_match, confirmed_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    args: [
      id,
      input.companyId,
      input.email.trim().toLowerCase(),
      input.name.trim(),
      input.role.trim(),
      token,
      expiresAt,
      input.domainMatch ? 1 : 0,
      nowIso(),
    ],
  });

  const claim = await getClaimByToken(token);
  if (!claim) throw new Error("Claim insert did not persist");
  return claim;
}

export async function getClaimByToken(token: string): Promise<Claim | null> {
  const { rows } = await getDb().execute({
    sql: `SELECT * FROM claims WHERE token = ? LIMIT 1`,
    args: [token],
  });
  return rows[0] ? mapClaim(rows[0] as unknown as Record<string, unknown>) : null;
}

export async function confirmClaim(id: string): Promise<void> {
  await getDb().execute({
    sql: `UPDATE claims SET confirmed_at = ? WHERE id = ?`,
    args: [nowIso(), id],
  });
}

export async function listClaimsForCompany(companyId: string): Promise<Claim[]> {
  const { rows } = await getDb().execute({
    sql: `SELECT * FROM claims WHERE company_id = ? ORDER BY created_at DESC`,
    args: [companyId],
  });
  return rows.map((row) => mapClaim(row as unknown as Record<string, unknown>));
}

export function claimExpired(claim: Claim): boolean {
  return new Date(claim.expiresAt).getTime() < Date.now();
}
