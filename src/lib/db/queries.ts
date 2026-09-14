import type { Row } from "@libsql/client";
import { getDb } from "./client";
import { newId, newToken, nowIso } from "../ids";
import { assessEligibility } from "../eligibility";
import { uniqueSlug } from "../slug";
import type {
  Company,
  CompanySource,
  CompanyStatus,
  DetectedTool,
  EdgeKind,
  EligibilityReason,
  Relationship,
  RelationshipEdge,
  RelationshipState,
} from "../types";

/* -------------------------------------------------------------------------- */
/* row mapping                                                                */
/* -------------------------------------------------------------------------- */

function str(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function optStr(value: unknown): string | null {
  return value === null || value === undefined ? null : str(value);
}

function bool(value: unknown): boolean {
  return Number(value ?? 0) === 1;
}

/** Deliberately excludes `edit_token`, so it can never ride along into a page. */
const COMPANY_COLUMNS = `
  id, slug, name, domain, website, logo_url, description, category, audience,
  built_by, status, network_eligible, eligibility_reason, source, generation,
  detected_at, detected_from, detected_stack, contact_email, claim_name,
  claim_role,
  claim_verified_at, claimed_at, is_demo, created_at, updated_at
`;

const COMPANY_COLUMN_NAMES = COMPANY_COLUMNS.split(",")
  .map((column) => column.trim())
  .filter(Boolean);

function prefixedColumns(prefix: string): string {
  return COMPANY_COLUMN_NAMES.map((column) => `${prefix}.${column}`).join(", ");
}

function parseDetectedStack(value: unknown): DetectedTool[] | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const tools = parsed.flatMap((entry): DetectedTool[] => {
      if (typeof entry !== "object" || entry === null) return [];
      const { domain, name } = entry as Record<string, unknown>;
      if (typeof domain !== "string" || !domain) return [];
      return [{ domain, name: typeof name === "string" && name ? name : domain }];
    });
    return tools.length > 0 ? tools : null;
  } catch {
    return null;
  }
}

export function mapCompany(row: Row): Company {
  return {
    id: str(row.id),
    slug: str(row.slug),
    name: str(row.name),
    domain: str(row.domain),
    website: str(row.website),
    logoUrl: optStr(row.logo_url),
    description: optStr(row.description),
    category: optStr(row.category),
    audience: optStr(row.audience),
    builtBy: optStr(row.built_by),
    status: str(row.status) as CompanyStatus,
    networkEligible: bool(row.network_eligible),
    eligibilityReason: str(row.eligibility_reason) as EligibilityReason,
    source: str(row.source) as CompanySource,
    generation: Number(row.generation ?? 0),
    detectedAt: optStr(row.detected_at),
    detectedFrom: optStr(row.detected_from),
    detectedStack: parseDetectedStack(row.detected_stack),
    contactEmail: optStr(row.contact_email),
    claimName: optStr(row.claim_name),
    claimRole: optStr(row.claim_role),
    claimVerifiedAt: optStr(row.claim_verified_at),
    claimedAt: optStr(row.claimed_at),
    isDemo: bool(row.is_demo),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

/** The company's edit token, kept out of the `Company` type and out of
 * `COMPANY_COLUMNS` so it is never accidentally serialized into a page. */
function editTokenOf(row: Row): string {
  return str(row.edit_token);
}

/* -------------------------------------------------------------------------- */
/* reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function getCompanyById(id: string): Promise<Company | null> {
  const { rows } = await getDb().execute({
    sql: `SELECT ${COMPANY_COLUMNS} FROM companies WHERE id = ? LIMIT 1`,
    args: [id],
  });
  return rows[0] ? mapCompany(rows[0]) : null;
}

export async function getCompanyBySlug(slug: string): Promise<Company | null> {
  const { rows } = await getDb().execute({
    sql: `SELECT ${COMPANY_COLUMNS} FROM companies WHERE slug = ? LIMIT 1`,
    args: [slug],
  });
  return rows[0] ? mapCompany(rows[0]) : null;
}

export async function getCompanyByDomain(
  domain: string,
): Promise<Company | null> {
  const { rows } = await getDb().execute({
    sql: `SELECT ${COMPANY_COLUMNS} FROM companies WHERE domain = ? LIMIT 1`,
    args: [domain.toLowerCase()],
  });
  return rows[0] ? mapCompany(rows[0]) : null;
}

export async function getEditToken(companyId: string): Promise<string | null> {
  const { rows } = await getDb().execute({
    sql: `SELECT edit_token FROM companies WHERE id = ? LIMIT 1`,
    args: [companyId],
  });
  return rows[0] ? editTokenOf(rows[0]) : null;
}

/** Of these companies, the ones whose edit token the caller holds. */
export async function getEditableCompanyIds(
  companyIds: string[],
  tokens: string[],
): Promise<string[]> {
  if (companyIds.length === 0 || tokens.length === 0) return [];

  const { rows } = await getDb().execute({
    sql: `SELECT id FROM companies
          WHERE id IN (${companyIds.map(() => "?").join(", ")})
            AND edit_token IN (${tokens.map(() => "?").join(", ")})`,
    args: [...companyIds, ...tokens],
  });
  return rows.map((row) => str(row.id));
}

/* -------------------------------------------------------------------------- */
/* writes                                                                     */
/* -------------------------------------------------------------------------- */

export interface CreateCompanyInput {
  name: string;
  domain: string;
  website: string;
  logoUrl?: string | null;
  description?: string | null;
  category?: string | null;
  audience?: string | null;
  builtBy?: string | null;
  status?: CompanyStatus;
  source: CompanySource;
  generation?: number;
  detectedAt?: string | null;
  detectedFrom?: string | null;
  contactEmail?: string | null;
  networkEligible?: boolean;
  eligibilityReason?: EligibilityReason;
  claimVerifiedAt?: string | null;
  claimedAt?: string | null;
  isDemo?: boolean;
}

export async function createCompany(
  input: CreateCompanyInput,
): Promise<Company> {
  const db = getDb();
  const domain = input.domain.toLowerCase();
  const verdict = assessEligibility(domain);

  const slug = await uniqueSlug(input.name || domain, async (candidate) => {
    const { rows } = await db.execute({
      sql: `SELECT 1 FROM companies WHERE slug = ? LIMIT 1`,
      args: [candidate],
    });
    return rows.length > 0;
  });

  const id = newId();
  await db.execute({
    sql: `INSERT INTO companies (
            id, slug, name, domain, website, logo_url, description, category,
            audience, built_by, status, network_eligible, eligibility_reason,
            source, generation, detected_at, detected_from, contact_email,
            claim_verified_at, claimed_at, edit_token, is_demo, created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      slug,
      input.name || domain,
      domain,
      input.website,
      input.logoUrl ?? null,
      input.description ?? null,
      input.category ?? null,
      input.audience ?? null,
      input.builtBy ?? null,
      input.status ?? "UNCLAIMED",
      (input.networkEligible ?? verdict.networkEligible) ? 1 : 0,
      input.eligibilityReason ?? verdict.eligibilityReason,
      input.source,
      input.generation ?? 0,
      input.detectedAt ?? null,
      input.detectedFrom ?? null,
      input.contactEmail ?? null,
      input.claimVerifiedAt ?? (input.status === "CLAIMED" ? nowIso() : null),
      input.claimedAt ?? (input.status === "CLAIMED" ? nowIso() : null),
      newToken(),
      input.isDemo ? 1 : 0,
      nowIso(),
      nowIso(),
    ],
  });

  const company = await getCompanyById(id);
  if (!company) throw new Error("Company insert did not persist");
  return company;
}

/**
 * The single door through which every company enters the network. Returning
 * `created: false` for an existing domain is what stops the graph filling up
 * with duplicate vendor profiles.
 */
export async function findOrCreateCompanyByDomain(
  input: CreateCompanyInput,
): Promise<{ company: Company; created: boolean }> {
  const existing = await getCompanyByDomain(input.domain);
  if (existing) return { company: existing, created: false };
  return { company: await createCompany(input), created: true };
}

export interface UpdateCompanyPatch {
  name?: string;
  description?: string | null;
  category?: string | null;
  audience?: string | null;
  builtBy?: string | null;
  logoUrl?: string | null;
  website?: string;
  status?: CompanyStatus;
  networkEligible?: boolean;
  eligibilityReason?: EligibilityReason;
  contactEmail?: string | null;
  claimName?: string | null;
  claimRole?: string | null;
  claimVerifiedAt?: string | null;
  claimedAt?: string | null;
  detectedAt?: string | null;
  detectedFrom?: string | null;
  detectedStack?: DetectedTool[] | null;
}

const PATCH_COLUMNS: Record<keyof UpdateCompanyPatch, string> = {
  name: "name",
  description: "description",
  category: "category",
  audience: "audience",
  builtBy: "built_by",
  logoUrl: "logo_url",
  website: "website",
  status: "status",
  networkEligible: "network_eligible",
  eligibilityReason: "eligibility_reason",
  contactEmail: "contact_email",
  claimName: "claim_name",
  claimRole: "claim_role",
  claimVerifiedAt: "claim_verified_at",
  claimedAt: "claimed_at",
  detectedAt: "detected_at",
  detectedFrom: "detected_from",
  detectedStack: "detected_stack",
};

export async function updateCompany(
  id: string,
  patch: UpdateCompanyPatch,
): Promise<Company | null> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined) as [
    keyof UpdateCompanyPatch,
    unknown,
  ][];
  if (entries.length === 0) return getCompanyById(id);

  const sets = entries.map(([key]) => `${PATCH_COLUMNS[key]} = ?`).join(", ");
  const args = entries.map(([, value]) => {
    if (typeof value === "boolean") return value ? 1 : 0;
    // detectedStack is the one structured field; it is stored as JSON.
    if (Array.isArray(value)) return JSON.stringify(value);
    return value as string | null;
  });

  await getDb().execute({
    sql: `UPDATE companies SET ${sets}, updated_at = ? WHERE id = ?`,
    args: [...args, nowIso(), id],
  });
  return getCompanyById(id);
}

/**
 * Marks profiles as freshly changed. Called for both ends of a new
 * relationship, because "last updated" has to mean the graph around a company,
 * not just its own fields.
 */
export async function touchCompanies(ids: string[]): Promise<void> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return;

  await getDb().execute({
    sql: `UPDATE companies SET updated_at = ?
          WHERE id IN (${unique.map(() => "?").join(", ")})`,
    args: [nowIso(), ...unique],
  });
}

/**
 * Identity established, claim not yet complete. Under the current thesis a
 * profile only turns CLAIMED once two independent tools are credited, so
 * verifying an email is a step, not the finish line.
 */
export async function recordClaimIdentity(
  id: string,
  claim: { email: string; name: string; role: string },
): Promise<Company | null> {
  return updateCompany(id, {
    claimVerifiedAt: nowIso(),
    claimName: claim.name,
    claimRole: claim.role,
    contactEmail: claim.email,
  });
}

export async function markCompanyClaimed(id: string): Promise<Company | null> {
  return updateCompany(id, { status: "CLAIMED", claimedAt: nowIso() });
}

/* -------------------------------------------------------------------------- */
/* relationships                                                              */
/* -------------------------------------------------------------------------- */

export type RelationshipWriteOutcome =
  | "CREATED"
  | "DUPLICATE"
  | "SELF_REFERENCE";

/**
 * Relationships are unique per (source, target) pair: saying "we use X" twice
 * is not two facts. There is only one kind of edge — "source uses target" —
 * so a repeat is simply a duplicate.
 */
export async function upsertRelationship(input: {
  sourceCompanyId: string;
  targetCompanyId: string;
  reportedByCompanyId: string;
  edgeKind: EdgeKind;
}): Promise<{
  outcome: RelationshipWriteOutcome;
  relationship: Relationship | null;
}> {
  if (input.sourceCompanyId === input.targetCompanyId) {
    return { outcome: "SELF_REFERENCE", relationship: null };
  }

  const db = getDb();
  const existing = await db.execute({
    sql: `SELECT id, source_company_id, target_company_id,
                 reported_by_company_id, state, edge_kind, created_at
          FROM relationships
          WHERE source_company_id = ? AND target_company_id = ? LIMIT 1`,
    args: [input.sourceCompanyId, input.targetCompanyId],
  });

  if (existing.rows[0]) {
    const row = existing.rows[0];
    return {
      outcome: "DUPLICATE",
      relationship: {
        id: str(row.id),
        sourceCompanyId: str(row.source_company_id),
        targetCompanyId: str(row.target_company_id),
        reportedByCompanyId: optStr(row.reported_by_company_id),
        state: str(row.state) as RelationshipState,
        edgeKind: str(row.edge_kind) as EdgeKind,
        createdAt: str(row.created_at),
      },
    };
  }

  const id = newId();
  const createdAt = nowIso();
  await db.execute({
    sql: `INSERT INTO relationships
            (id, source_company_id, target_company_id,
             reported_by_company_id, state, edge_kind, created_at)
          VALUES (?, ?, ?, ?, 'SELF_REPORTED', ?, ?)`,
    args: [
      id,
      input.sourceCompanyId,
      input.targetCompanyId,
      input.reportedByCompanyId,
      input.edgeKind,
      createdAt,
    ],
  });

  return {
    outcome: "CREATED",
    relationship: {
      id,
      sourceCompanyId: input.sourceCompanyId,
      targetCompanyId: input.targetCompanyId,
      reportedByCompanyId: input.reportedByCompanyId,
      state: "SELF_REPORTED",
      edgeKind: input.edgeKind,
      createdAt,
    },
  };
}

/**
 * Upstream claim currency: independent vendors this company credited itself.
 * Incumbents don't count, and neither do edges somebody else reported.
 */
export async function countUpstreamCredits(
  companyId: string,
): Promise<number> {
  const { rows } = await getDb().execute({
    sql: `SELECT COUNT(*) AS n
          FROM relationships r
          JOIN companies target ON target.id = r.target_company_id
          WHERE r.source_company_id = ?
            AND target.network_eligible = 1
            AND (r.reported_by_company_id IS NULL OR r.reported_by_company_id = r.source_company_id)
            AND r.state != 'DISPUTED'`,
    args: [companyId],
  });
  return Number(rows[0]?.n ?? 0);
}

/** How many of the companies naming this vendor are on the network already. */
export async function countIncomingOnNetwork(
  companyId: string,
): Promise<number> {
  const { rows } = await getDb().execute({
    sql: `SELECT COUNT(*) AS n
          FROM relationships r
          JOIN companies source ON source.id = r.source_company_id
          WHERE r.target_company_id = ?
            AND source.status = 'CLAIMED'
            AND r.state != 'DISPUTED'`,
    args: [companyId],
  });
  return Number(rows[0]?.n ?? 0);
}

export async function setRelationshipState(
  relationshipId: string,
  state: RelationshipState,
): Promise<void> {
  await getDb().execute({
    sql: `UPDATE relationships SET state = ? WHERE id = ?`,
    args: [state, relationshipId],
  });
}

export async function deleteRelationship(relationshipId: string): Promise<void> {
  await getDb().execute({
    sql: `DELETE FROM relationships WHERE id = ?`,
    args: [relationshipId],
  });
}

export async function getEdgeById(
  relationshipId: string,
): Promise<RelationshipEdge | null> {
  const { rows } = await getDb().execute({
    sql: `${EDGE_SELECT} WHERE r.id = ? LIMIT 1`,
    args: [relationshipId],
  });
  return rows[0] ? mapEdge(rows[0]) : null;
}

const EDGE_SELECT = `
  SELECT
    r.id AS r_id, r.created_at AS r_created_at,
    r.reported_by_company_id AS r_reported_by, r.state AS r_state,
    r.edge_kind AS r_edge_kind,
    ${(["s", "t"] as const)
      .map((prefix) =>
        COMPANY_COLUMN_NAMES.map(
          (column) => `${prefix}.${column} AS ${prefix}_${column}`,
        ).join(", "),
      )
      .join(", ")}
  FROM relationships r
  JOIN companies s ON s.id = r.source_company_id
  JOIN companies t ON t.id = r.target_company_id
`;

function prefixedRow(row: Row, prefix: "s" | "t"): Row {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith(`${prefix}_`)) out[key.slice(prefix.length + 1)] = value;
  }
  return out as Row;
}

function mapEdge(row: Row): RelationshipEdge {
  return {
    id: str(row.r_id),
    reportedByCompanyId: optStr(row.r_reported_by),
    state: str(row.r_state) as RelationshipState,
    edgeKind: str(row.r_edge_kind) as EdgeKind,
    createdAt: str(row.r_created_at),
    source: mapCompany(prefixedRow(row, "s")),
    target: mapCompany(prefixedRow(row, "t")),
  };
}

/** Tools powering this company. */
export async function listOutgoingEdges(
  companyId: string,
): Promise<RelationshipEdge[]> {
  const { rows } = await getDb().execute({
    sql: `${EDGE_SELECT} WHERE r.source_company_id = ? AND r.state != 'DISPUTED'
          ORDER BY r.created_at ASC`,
    args: [companyId],
  });
  return rows.map(mapEdge);
}

/** Companies that say they use this company. */
export async function listIncomingEdges(
  companyId: string,
): Promise<RelationshipEdge[]> {
  const { rows } = await getDb().execute({
    sql: `${EDGE_SELECT} WHERE r.target_company_id = ? AND r.state != 'DISPUTED'
          ORDER BY r.created_at DESC`,
    args: [companyId],
  });
  return rows.map(mapEdge);
}

export async function listRecentEdges(limit = 12): Promise<RelationshipEdge[]> {
  const { rows } = await getDb().execute({
    sql: `${EDGE_SELECT} WHERE r.state != 'DISPUTED' ORDER BY r.created_at DESC LIMIT ?`,
    args: [limit],
  });
  return rows.map(mapEdge);
}

export async function countIncoming(companyId: string): Promise<number> {
  const { rows } = await getDb().execute({
    sql: `SELECT COUNT(*) AS n FROM relationships
          WHERE target_company_id = ? AND state != 'DISPUTED'`,
    args: [companyId],
  });
  return Number(rows[0]?.n ?? 0);
}

/* -------------------------------------------------------------------------- */
/* feeds, search, stats                                                      */
/* -------------------------------------------------------------------------- */

export async function listRecentlyClaimed(limit = 6): Promise<Company[]> {
  const { rows } = await getDb().execute({
    sql: `SELECT ${COMPANY_COLUMNS} FROM companies
          WHERE status = 'CLAIMED' AND claimed_at IS NOT NULL
          ORDER BY claimed_at DESC LIMIT ?`,
    args: [limit],
  });
  return rows.map(mapCompany);
}

export interface GrowingNetwork {
  company: Company;
  /** Connections gained inside the window, either direction. */
  gained: number;
  total: number;
}

/**
 * Companies whose network grew lately, in either direction.
 *
 * Deliberately not a "most used" table: a leaderboard of totals is a
 * popularity contest with extra steps, and the same handful of names would
 * sit on top of it forever. This is movement, not merit.
 */
export async function listGrowingNetworks(
  options: { days?: number; limit?: number } = {},
): Promise<GrowingNetwork[]> {
  const days = options.days ?? 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { rows } = await getDb().execute({
    sql: `SELECT ${prefixedColumns("c")},
            SUM(CASE WHEN r.created_at >= ? THEN 1 ELSE 0 END) AS gained,
            COUNT(r.id) AS total
          FROM companies c
          JOIN relationships r
            ON (r.source_company_id = c.id OR r.target_company_id = c.id)
           AND r.state != 'DISPUTED'
          WHERE c.network_eligible = 1
          GROUP BY c.id
          HAVING gained > 0
          ORDER BY gained DESC, c.updated_at DESC
          LIMIT ?`,
    args: [since, options.limit ?? 6],
  });

  return rows.map((row) => ({
    company: mapCompany(row),
    gained: Number(row.gained ?? 0),
    total: Number(row.total ?? 0),
  }));
}

export async function searchCompanies(
  query: string,
  options: { limit?: number; excludeIds?: string[] } = {},
): Promise<Company[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];

  const limit = options.limit ?? 6;
  const exclude = options.excludeIds ?? [];
  const placeholders = exclude.map(() => "?").join(", ");

  const { rows } = await getDb().execute({
    sql: `SELECT ${COMPANY_COLUMNS} FROM companies
          WHERE (LOWER(name) LIKE ? OR domain LIKE ?)
          ${exclude.length ? `AND id NOT IN (${placeholders})` : ""}
          ORDER BY
            CASE WHEN LOWER(name) = ? THEN 0
                 WHEN LOWER(name) LIKE ? THEN 1
                 ELSE 2 END,
            CASE WHEN status = 'CLAIMED' THEN 0 ELSE 1 END,
            name ASC
          LIMIT ?`,
    args: [`%${q}%`, `%${q}%`, ...exclude, q, `${q}%`, limit],
  });
  return rows.map(mapCompany);
}

export interface NetworkStats {
  companies: number;
  claimed: number;
  unclaimed: number;
  relationships: number;
  eligible: number;
}

export async function getNetworkStats(): Promise<NetworkStats> {
  const db = getDb();
  const [companies, relationships] = await Promise.all([
    db.execute(`SELECT
                  COUNT(*) AS total,
                  SUM(CASE WHEN status = 'CLAIMED' THEN 1 ELSE 0 END) AS claimed,
                  SUM(CASE WHEN network_eligible = 1 THEN 1 ELSE 0 END) AS eligible
                FROM companies`),
    db.execute(`SELECT COUNT(*) AS total FROM relationships`),
  ]);

  const total = Number(companies.rows[0]?.total ?? 0);
  const claimed = Number(companies.rows[0]?.claimed ?? 0);

  return {
    companies: total,
    claimed,
    unclaimed: total - claimed,
    eligible: Number(companies.rows[0]?.eligible ?? 0),
    relationships: Number(relationships.rows[0]?.total ?? 0),
  };
}

export interface CompanyWithCounts extends Company {
  outgoing: number;
  incoming: number;
  notifications: number;
}

export async function listCompaniesWithCounts(): Promise<CompanyWithCounts[]> {
  const { rows } = await getDb().execute(
    `SELECT ${prefixedColumns("c")},
       (SELECT COUNT(*) FROM relationships r WHERE r.source_company_id = c.id) AS outgoing,
       (SELECT COUNT(*) FROM relationships r WHERE r.target_company_id = c.id) AS incoming,
       (SELECT COUNT(*) FROM notifications n WHERE n.company_id = c.id AND n.status = 'SENT') AS notifications
     FROM companies c
     ORDER BY c.created_at DESC`,
  );
  return rows.map((row) => ({
    ...mapCompany(row),
    outgoing: Number(row.outgoing ?? 0),
    incoming: Number(row.incoming ?? 0),
    notifications: Number(row.notifications ?? 0),
  }));
}

export async function listAllCompanySlugs(): Promise<
  { slug: string; createdAt: string }[]
> {
  const { rows } = await getDb().execute(
    `SELECT slug, created_at FROM companies ORDER BY created_at DESC`,
  );
  return rows.map((row) => ({
    slug: str(row.slug),
    createdAt: str(row.created_at),
  }));
}
