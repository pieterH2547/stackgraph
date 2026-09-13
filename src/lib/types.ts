export type CompanyStatus = "UNCLAIMED" | "CLAIMED";

/**
 * How a company got into the network. This is the provenance that the whole
 * flywheel measurement rests on: only companies with source `MENTIONED` were
 * caused by the product rather than by us.
 */
export type CompanySource = "SEED" | "SELF_ADDED" | "MENTIONED" | "ADMIN";

export type RelationshipType = "USES" | "RECOMMENDS";

/** Relationships are self-reported until the other end says otherwise. */
export type RelationshipState = "SELF_REPORTED" | "CONFIRMED" | "DISPUTED";

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
  contactEmail: string | null;
  claimName: string | null;
  claimRole: string | null;
  /** Identity established. The claim still needs three independent tools. */
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
  type: RelationshipType;
  /** Who stated it. Null only for rows written before attribution existed. */
  reportedByCompanyId: string | null;
  state: RelationshipState;
  edgeKind: EdgeKind;
  createdAt: string;
}

/** A relationship joined with both ends, for feeds and profiles. */
export interface RelationshipEdge {
  id: string;
  type: RelationshipType;
  reportedByCompanyId: string | null;
  state: RelationshipState;
  edgeKind: EdgeKind;
  createdAt: string;
  source: Company;
  target: Company;
}

/** "Acme says it uses Tally" vs "Tally says Acme uses its product". */
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
