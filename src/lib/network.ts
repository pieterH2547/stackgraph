import { detectSite, findPublishedContactEmail, isDerivedName } from "./detect";
import {
  countDownstreamCredits,
  countIncoming,
  countUpstreamCredits,
  createCompany,
  findOrCreateCompanyByDomain,
  getCompanyById,
  getCompanyByDomain,
  listIncomingEdges,
  listOutgoingEdges,
  markCompanyClaimed,
  setRelationshipState,
  touchCompanies,
  updateCompany,
  upsertRelationship,
} from "./db/queries";
import { track } from "./events";
import {
  MAX_CUSTOMERS,
  MAX_TOOLS,
  REQUIRED_DOWNSTREAM,
  REQUIRED_UPSTREAM,
} from "./limits";
import { notifyMention } from "./notify";
import { normalizeSiteUrl } from "./url";
import type {
  Company,
  CompanySource,
  EdgeKind,
  RelationshipType,
} from "./types";

export {
  MAX_CUSTOMERS,
  MAX_TOOLS,
  REQUIRED_DOWNSTREAM,
  REQUIRED_UPSTREAM,
} from "./limits";

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
  /** "Would you recommend it?" — yes, or just using it. */
  recommend?: boolean;
}

export interface StackConnection {
  company: Company;
  type: RelationshipType;
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
  upstream: number;
  downstream: number;
  upstreamShort: number;
  downstreamShort: number;
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

    const type: RelationshipType = tool.recommend ? "RECOMMENDS" : "USES";
    const edgeKind = classifyEdge(target);
    const { outcome } = await upsertRelationship({
      sourceCompanyId: company.id,
      targetCompanyId: target.id,
      type,
      reportedByCompanyId: company.id,
      edgeKind,
    });

    const createdRelationship = outcome === "CREATED";

    if (createdRelationship) {
      await touchCompanies([company.id, target.id]);
      await track("relationship_created", {
        companyId: company.id,
        targetCompanyId: target.id,
        props: { type, edgeKind, direction: "POWERED_BY" },
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
      type,
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

/** Where a company stands against the two halves of the claim. */
export async function getClaimProgress(
  company: Company,
): Promise<ClaimProgress> {
  const [upstream, downstream] = await Promise.all([
    countUpstreamCredits(company.id),
    countDownstreamCredits(company.id),
  ]);

  return {
    upstream,
    downstream,
    upstreamShort: Math.max(0, REQUIRED_UPSTREAM - upstream),
    downstreamShort: Math.max(0, REQUIRED_DOWNSTREAM - downstream),
    identityVerified: company.claimVerifiedAt !== null,
    complete:
      upstream >= REQUIRED_UPSTREAM && downstream >= REQUIRED_DOWNSTREAM,
  };
}

/**
 * The claim gate: identity, plus both sides of the company. Two independent
 * tools that power you and two software companies you power. Nobody named has
 * to confirm anything — a claim that depended on other people would stall the
 * whole network.
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
      downstream: progress.downstream,
      generation: company.generation,
      source: company.source,
    },
  });

  return { progress, claimCompleted: true };
}

/* -------------------------------------------------------------------------- */
/* the turbo: used by                                                         */
/* -------------------------------------------------------------------------- */

export interface CustomerInput {
  existingCompanyId?: string;
  name?: string;
  website?: string;
}

export interface CustomerResult {
  company: Company;
  connections: StackConnection[];
  errors: string[];
  progress: ClaimProgress;
  claimCompleted: boolean;
}

/**
 * A vendor naming software companies that use its product. Always optional and
 * never part of the claim: the edges point the other way and are clearly
 * attributed to the vendor who stated them ("Tally says Acme uses its
 * product") until the named company says otherwise.
 */
export async function submitCustomers(
  input: { companyId: string; customers: CustomerInput[] },
  options: { defer?: Defer } = {},
): Promise<CustomerResult> {
  const company = await getCompanyById(input.companyId);
  if (!company) throw new StackValidationError("That company doesn't exist.");

  const customers = input.customers.filter(
    (entry) => entry.existingCompanyId || entry.website || entry.name,
  );
  if (customers.length === 0) {
    throw new StackValidationError("Name at least one company.");
  }
  if (customers.length > MAX_CUSTOMERS) {
    throw new StackValidationError(
      `${MAX_CUSTOMERS} companies at a time is the most.`,
    );
  }

  const inlineTasks: Promise<void>[] = [];
  const defer = options.defer ?? inlineDefer(inlineTasks);

  const connections: StackConnection[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const entry of customers) {
    let customer: Company | null = null;
    let createdProfile = false;

    if (entry.existingCompanyId) {
      customer = await getCompanyById(entry.existingCompanyId);
      if (!customer) {
        errors.push("One of the selected companies no longer exists.");
        continue;
      }
    } else if (entry.website) {
      let normalized;
      try {
        normalized = normalizeSiteUrl(entry.website);
      } catch {
        errors.push(`"${entry.website}" isn't a website address we can use.`);
        continue;
      }
      const existing = await getCompanyByDomain(normalized.domain);
      if (existing) {
        customer = existing;
      } else {
        customer = await createProfileFor({
          name: entry.name,
          domain: normalized.domain,
          website: normalized.website,
          mentionedBy: company,
        });
        createdProfile = true;
      }
    } else {
      errors.push(`We need a website for "${entry.name}".`);
      continue;
    }

    if (customer.id === company.id) {
      errors.push("A company can't list itself as its own customer.");
      continue;
    }
    if (seen.has(customer.id)) continue;
    seen.add(customer.id);

    const edgeKind = classifyEdge(customer);
    const { outcome, relationship } = await upsertRelationship({
      // The customer is the one doing the using, whoever said so.
      sourceCompanyId: customer.id,
      targetCompanyId: company.id,
      type: "USES",
      reportedByCompanyId: company.id,
      edgeKind,
    });

    const createdRelationship = outcome === "CREATED";

    // The customer had already said it themselves. Both ends now agree, which
    // is the strongest version of the same fact.
    if (
      !createdRelationship &&
      relationship &&
      relationship.reportedByCompanyId === customer.id &&
      relationship.state !== "CONFIRMED"
    ) {
      await setRelationshipState(relationship.id, "CONFIRMED");
      await touchCompanies([customer.id, company.id]);
    }

    if (createdRelationship) {
      await touchCompanies([customer.id, company.id]);
      await track("relationship_created", {
        companyId: customer.id,
        targetCompanyId: company.id,
        props: { type: "USES", edgeKind, direction: "USED_BY" },
      });

      const customerId = customer.id;
      const isNewProfile = createdProfile;
      defer(async () => {
        if (isNewProfile) await enrichCompany(customerId);
        await notifyMention({
          vendorId: customerId,
          mentionedById: company.id,
          kind: "YOU_USE",
        });
      });
    }

    connections.push({
      company: customer,
      type: "USES",
      createdProfile,
      createdRelationship,
      edgeKind,
      countsAsCredit: true,
    });
  }

  if (connections.length === 0 && errors.length > 0) {
    throw new StackValidationError(errors[0]);
  }

  if (connections.length > 0) {
    await track("customers_named", {
      companyId: company.id,
      props: { count: connections.length },
    });
  }

  const { progress, claimCompleted } = await settleClaim(company);

  await Promise.all(inlineTasks);

  const refreshed = (await getCompanyById(company.id)) ?? company;
  return { company: refreshed, connections, errors, progress, claimCompleted };
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
