import { detectSite, findPublishedContactEmail, isDerivedName } from "./detect";
import {
  countIncoming,
  countUpstreamCredits,
  createCompany,
  findOrCreateCompanyByDomain,
  getCompanyById,
  getCompanyByDomain,
  listIncomingEdges,
  listOutgoingEdges,
  markCompanyClaimed,
  touchCompanies,
  updateCompany,
  upsertRelationship,
} from "./db/queries";
import { track } from "./events";
import { MAX_TOOLS, REQUIRED_UPSTREAM } from "./limits";
import { notifyMention } from "./notify";
import { suggestPoweredBy } from "./signals";
import { normalizeSiteUrl } from "./url";
import type { Company, CompanySource, EdgeKind } from "./types";

export { MAX_TOOLS, REQUIRED_UPSTREAM } from "./limits";

export class StackValidationError extends Error {}

/**
 * Work that shouldn't hold up the response — reading a vendor's website,
 * sending a recognition email. In a request this is Next's `after()`; in tests
 * and scripts it runs inline so behaviour is deterministic.
 */
export type Defer = (task: () => Promise<void>) => void;

const inlineDefer = (tasks: Promise<void>[]): Defer => {
  return (task) => {
    tasks.push(task());
  };
};

/**
 * What a new edge did for the network.
 *
 * - ACQUISITION: an independent vendor who hasn't claimed yet. This is the one
 *   that can bring in the next generation.
 * - PROOF: an independent vendor who already claimed. No new node, but their
 *   "used by" count goes up, which is the other thing the graph is for.
 * - STACK_ONLY: an incumbent. Visible in the stack, outside the loop.
 *
 * Every edge does exactly one of these, so overlap is never wasted.
 */
export function classifyEdge(target: Company): EdgeKind {
  if (!target.networkEligible) return "STACK_ONLY";
  return target.status === "CLAIMED" ? "PROOF" : "ACQUISITION";
}

/* -------------------------------------------------------------------------- */
/* joining                                                                    */
/* -------------------------------------------------------------------------- */

export interface AddCompanyInput {
  url: string;
  name?: string;
  description?: string | null;
  category?: string | null;
  audience?: string | null;
  builtBy?: string | null;
  logoUrl?: string | null;
  contactEmail?: string | null;
  source?: CompanySource;
  status?: "CLAIMED" | "UNCLAIMED";
  claimVerifiedAt?: string | null;
  detectedAt?: string | null;
  detectedFrom?: string | null;
  generation?: number;
  isDemo?: boolean;
}

/**
 * A company entering the network under its own steam. Existing domains are
 * returned as-is: an unclaimed profile someone else created is the same
 * company, and claiming it is a different flow from creating it.
 */
export async function addCompany(
  input: AddCompanyInput,
): Promise<{ company: Company; created: boolean }> {
  const { domain, website } = normalizeSiteUrl(input.url);

  const result = await findOrCreateCompanyByDomain({
    name: (input.name ?? "").trim() || domain,
    domain,
    website,
    description: input.description ?? null,
    category: input.category ?? null,
    audience: input.audience ?? null,
    builtBy: input.builtBy ?? null,
    logoUrl: input.logoUrl ?? null,
    contactEmail: input.contactEmail ?? null,
    source: input.source ?? "SELF_ADDED",
    status: input.status ?? "UNCLAIMED",
    claimVerifiedAt: input.claimVerifiedAt ?? null,
    generation: input.generation ?? 0,
    detectedAt: input.detectedAt ?? null,
    detectedFrom: input.detectedFrom ?? null,
    isDemo: input.isDemo ?? false,
  });

  if (result.created) {
    await track("company_added", {
      companyId: result.company.id,
      props: {
        source: result.company.source,
        generation: result.company.generation,
        eligible: result.company.networkEligible,
      },
    });
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* the flywheel action: powered by                                            */
/* -------------------------------------------------------------------------- */

export interface StackToolInput {
  /** Picked from search: a company already in the network. */
  existingCompanyId?: string;
  /** Typed by hand: a tool that isn't in the network yet. */
  name?: string;
  website?: string;
}

export interface StackConnection {
  company: Company;
  /** An unclaimed profile was created automatically for this tool. */
  createdProfile: boolean;
  createdRelationship: boolean;
  edgeKind: EdgeKind;
  /** Whether this entry counts towards its half of the claim. */
  countsAsCredit: boolean;
}

export interface StackResult {
  company: Company;
  connections: StackConnection[];
  /** Per-tool problems. The valid tools still go through. */
  errors: string[];
  /** Both halves of the claim, after this submission. */
  progress: ClaimProgress;
  /** True when this submission is what completed the claim. */
  claimCompleted: boolean;
}

export interface ClaimProgress {
  /** Network-eligible tools credited. The only thing the gate counts. */
  upstream: number;
  upstreamShort: number;
  identityVerified: boolean;
  complete: boolean;
}

export async function submitStack(
  input: { companyId: string; tools: StackToolInput[] },
  options: { defer?: Defer } = {},
): Promise<StackResult> {
  const company = await getCompanyById(input.companyId);
  if (!company) throw new StackValidationError("That company doesn't exist.");

  const tools = input.tools.filter(
    (tool) => tool.existingCompanyId || tool.website || tool.name,
  );

  if (tools.length === 0) throw new StackValidationError("Add at least one tool.");
  if (tools.length > MAX_TOOLS) {
    throw new StackValidationError(`${MAX_TOOLS} tools at a time is the most.`);
  }

  const inlineTasks: Promise<void>[] = [];
  const defer = options.defer ?? inlineDefer(inlineTasks);

  const hadStackBefore = (await listOutgoingEdges(company.id)).length > 0;

  const connections: StackConnection[] = [];
  const errors: string[] = [];
  // Guards against the same tool being listed twice in *this* submission.
  // Tools already in the stack still go through the upsert, so switching one
  // from "just using it" to "recommend" actually changes the edge.
  const seen = new Set<string>();

  for (const tool of tools) {
    let target: Company | null = null;
    let createdProfile = false;

    if (tool.existingCompanyId) {
      target = await getCompanyById(tool.existingCompanyId);
      if (!target) {
        errors.push("One of the selected tools no longer exists.");
        continue;
      }
    } else if (tool.website) {
      let normalized;
      try {
        normalized = normalizeSiteUrl(tool.website);
      } catch {
        errors.push(`"${tool.website}" isn't a website address we can use.`);
        continue;
      }

      const existing = await getCompanyByDomain(normalized.domain);
      if (existing) {
        target = existing;
      } else {
        target = await createProfileFor({
          name: tool.name,
          domain: normalized.domain,
          website: normalized.website,
          mentionedBy: company,
        });
        createdProfile = true;
      }
    } else {
      errors.push(`We need a website for "${tool.name}" before it can be added.`);
      continue;
    }

    if (target.id === company.id) {
      errors.push("A company can't list itself as one of its own tools.");
      continue;
    }
    if (seen.has(target.id)) continue;
    seen.add(target.id);

    const edgeKind = classifyEdge(target);
    const { outcome } = await upsertRelationship({
      sourceCompanyId: company.id,
      targetCompanyId: target.id,
      reportedByCompanyId: company.id,
      edgeKind,
    });

    const createdRelationship = outcome === "CREATED";

    if (createdRelationship) {
      await touchCompanies([company.id, target.id]);
      await track("relationship_created", {
        companyId: company.id,
        targetCompanyId: target.id,
        props: { edgeKind, direction: "POWERED_BY" },
      });
      await track("vendor_mentioned", {
        companyId: target.id,
        targetCompanyId: company.id,
        props: { edgeKind, newProfile: createdProfile },
      });

      const vendorId = target.id;
      const isNewProfile = createdProfile;

      // Recognition work: it must not slow down the person giving credit.
      defer(async () => {
        if (isNewProfile) await enrichCompany(vendorId);
        await notifyMention({
          vendorId,
          mentionedById: company.id,
          kind: "USES_YOU",
        });
      });
    }

    connections.push({
      company: target,
      createdProfile,
      createdRelationship,
      edgeKind,
      countsAsCredit: target.networkEligible,
    });
  }

  if (connections.length === 0 && errors.length > 0) {
    throw new StackValidationError(errors[0]);
  }

  if (connections.length > 0) {
    if (!hadStackBefore) {
      await track("first_tool_added", { companyId: company.id });
    }
    await track("stack_completed", {
      companyId: company.id,
      props: { tools: connections.length, status: company.status },
    });
  }

  const { progress, claimCompleted } = await settleClaim(company);

  await Promise.all(inlineTasks);

  const refreshed = (await getCompanyById(company.id)) ?? company;
  return { company: refreshed, connections, errors, progress, claimCompleted };
}

/**
 * Where a company stands against the claim gate. One number: how many
 * network-eligible tools it has credited. Nothing here depends on anyone else
 * having acted.
 */
export async function getClaimProgress(
  company: Company,
): Promise<ClaimProgress> {
  const upstream = await countUpstreamCredits(company.id);

  return {
    upstream,
    upstreamShort: Math.max(0, REQUIRED_UPSTREAM - upstream),
    identityVerified: company.claimVerifiedAt !== null,
    complete: upstream >= REQUIRED_UPSTREAM,
  };
}

/**
 * The claim gate: identity, plus two independent tools that power you.
 * Nobody named has to confirm anything — a claim that depended on other people
 * would stall the whole network.
 */
export async function settleClaim(
  company: Company,
): Promise<{ progress: ClaimProgress; claimCompleted: boolean }> {
  const progress = await getClaimProgress(company);

  const earned =
    progress.identityVerified &&
    progress.complete &&
    company.status !== "CLAIMED";

  if (!earned) return { progress, claimCompleted: false };

  await markCompanyClaimed(company.id);
  await track("claim_completed", {
    companyId: company.id,
    props: {
      upstream: progress.upstream,
      generation: company.generation,
      source: company.source,
    },
  });

  return { progress, claimCompleted: true };
}

/* -------------------------------------------------------------------------- */
/* profiles created on someone else's word                                    */
/* -------------------------------------------------------------------------- */

async function createProfileFor(input: {
  name?: string;
  domain: string;
  website: string;
  mentionedBy: Company;
}): Promise<Company> {
  const company = await createCompany({
    name: (input.name ?? "").trim() || input.domain,
    domain: input.domain,
    website: input.website,
    source: "MENTIONED",
    status: "UNCLAIMED",
    generation: input.mentionedBy.generation + 1,
  });

  await track("company_added", {
    companyId: company.id,
    props: {
      source: "MENTIONED",
      generation: company.generation,
      eligible: company.networkEligible,
      mentionedBy: input.mentionedBy.id,
    },
  });

  return company;
}

/**
 * Fills in blanks on an automatically created profile from the vendor's own
 * public website. Only ever fills blanks: a value a person confirmed always
 * wins over one we read.
 */
export async function enrichCompany(companyId: string): Promise<void> {
  if (process.env.DISABLE_SITE_DETECTION === "1") return;

  const company = await getCompanyById(companyId);
  if (!company || company.detectedAt) return;

  try {
    const detected = await detectSite(company.website);
    if (detected.detectedFrom !== "website") return;

    // A published contact address is how the recognition email can actually
    // reach them. Without one the invitation waits for a human in admin.
    const contactEmail =
      company.contactEmail ??
      detected.contactEmail ??
      (await findPublishedContactEmail(company.website, company.domain));

    /*
     * What their pages load from, recorded as a question rather than a fact.
     * It is emphatically not an edge: no claim credit, no proof on the other
     * vendor's profile, no notification. An unclaimed profile shows it as
     * "spotted on their website", which is the founder's cue to confirm their
     * own stack — the only way it can ever become a relationship.
     */
    const spotted = await suggestPoweredBy(company.website, company.domain);

    await updateCompany(company.id, {
      name: isDerivedName(company.name, company.domain)
        ? detected.name
        : company.name,
      description: company.description ?? detected.description,
      category: company.category ?? detected.category,
      logoUrl: company.logoUrl ?? detected.logoUrl,
      contactEmail,
      detectedAt: detected.detectedAt,
      detectedFrom: "website",
      detectedStack:
        company.detectedStack ??
        (spotted.length > 0
          ? spotted.slice(0, 6).map(({ domain, name }) => ({ domain, name }))
          : null),
    });
  } catch {
    // A vendor site being unreachable is not an error worth surfacing.
  }
}

/* -------------------------------------------------------------------------- */
/* profile reads                                                              */
/* -------------------------------------------------------------------------- */

export interface CompanyProfile {
  company: Company;
  /** Powered by: the tools this company says power it. */
  outgoing: Awaited<ReturnType<typeof listOutgoingEdges>>;
  /** Used by: the software companies said to use this one. */
  incoming: Awaited<ReturnType<typeof listIncomingEdges>>;
  usedByCount: number;
  progress: ClaimProgress;
}

export async function getProfile(company: Company): Promise<CompanyProfile> {
  const [outgoing, incoming, usedByCount, progress] = await Promise.all([
    listOutgoingEdges(company.id),
    listIncomingEdges(company.id),
    countIncoming(company.id),
    getClaimProgress(company),
  ]);

  return { company, outgoing, incoming, usedByCount, progress };
}
