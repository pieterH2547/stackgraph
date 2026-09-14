/** One entry of `detectedStack`. Not a company, and not an edge. */
export interface DetectedTool {
  domain: string;
  name: string;
}

export type CompanyStatus = "UNCLAIMED" | "CLAIMED";

/**
 * How a company got into the network. This is the provenance that the whole
 * flywheel measurement rests on: only companies with source `MENTIONED` were
 * caused by the product rather than by us.
 */
export type CompanySource = "SEED" | "SELF_ADDED" | "MENTIONED" | "ADMIN";

/**
 * Every relationship is a company's own statement about its own stack, so
 * SELF_REPORTED is what a true edge looks like and there is nothing for a
 * second party to add: CONFIRMED is gone, because it only ever modelled two
 * ends agreeing about a fact each of them had asserted separately.
 *
 * DISPUTED stays, and it is the one accuracy valve left: a vendor who is
 * credited by a company that does not actually use its product can have that
 * edge taken out of the public graph. Nobody's claimed status depends on it.
 */
export type RelationshipState = "SELF_REPORTED" | "DISPUTED";

/**
 * What a new edge did for the network. Every edge does one of the first two;
 * incumbents do neither, which is the whole point of `networkEligible`.
 */
export type EdgeKind = "ACQUISITION" | "PROOF" | "STACK_ONLY";

export type EligibilityReason =
  | "INCUMBENT_DENYLIST"
  | "ASSUMED_INDEPENDENT"
  | "ADMIN_OVERRIDE";

export interface Company {
  id: string;
  slug: string;
  name: string;
  domain: string;
  website: string;
  logoUrl: string | null;
  /** One sentence, written by the vendor. Never an analyst's essay. */
  description: string | null;
  category: string | null;
  /** "For whom?" — small SaaS teams, agencies, sales teams. */
  audience: string | null;
  /** Optional founder or team name. */
  builtBy: string | null;
  status: CompanyStatus;
  networkEligible: boolean;
  eligibilityReason: EligibilityReason;
  source: CompanySource;
  /** 0 for seeds and self-serve signups, parent + 1 for mentioned companies. */
  generation: number;
  /** Set when any field on this profile came from reading the public website. */
  detectedAt: string | null;
  detectedFrom: string | null;
  /**
   * Third-party hosts this company's own pages load from. A suggestion for the
   * founder, never a relationship: no edge, no claim credit, no proof on the
   * other vendor's profile, no outreach.
   */
  detectedStack: DetectedTool[] | null;
  contactEmail: string | null;
  claimName: string | null;
  claimRole: string | null;
  /** Identity established. The claim still needs both sides of the company. */
  claimVerifiedAt: string | null;
  claimedAt: string | null;
  isDemo: boolean;
  createdAt: string;
  /** Profile or surrounding relationships last changed. Shown publicly. */
  updatedAt: string;
}

export interface Relationship {
  id: string;
  sourceCompanyId: string;
  targetCompanyId: string;
  /** Who stated it. Null only for rows written before attribution existed. */
  reportedByCompanyId: string | null;
  state: RelationshipState;
  edgeKind: EdgeKind;
  createdAt: string;
}

/** A relationship joined with both ends, for feeds and profiles. */
export interface RelationshipEdge {
  id: string;
  reportedByCompanyId: string | null;
  state: RelationshipState;
  edgeKind: EdgeKind;
  createdAt: string;
  source: Company;
  target: Company;
}

/**
 * Every public edge now reads "Acme says it uses Tally", because the source is
 * the only party that can create one. Attribution is still stored rather than
 * assumed, and this is the invariant the tests hold it to.
 */
export function reportedBySource(edge: RelationshipEdge): boolean {
  return (
    edge.reportedByCompanyId === null ||
    edge.reportedByCompanyId === edge.source.id
  );
}

export interface Claim {
  id: string;
  companyId: string;
  email: string;
  name: string;
  role: string;
  token: string;
  expiresAt: string;
  domainMatch: boolean;
  confirmedAt: string | null;
  createdAt: string;
}

export type NotificationStatus =
  | "SENT"
  | "QUEUED_NO_ADDRESS"
  | "SUPPRESSED_COOLDOWN"
  | "FAILED";

export interface MentionNotification {
  id: string;
  companyId: string;
  kind: string;
  toEmail: string | null;
  subject: string;
  body: string;
  mentionCountAtSend: number;
  status: NotificationStatus;
  createdAt: string;
}
