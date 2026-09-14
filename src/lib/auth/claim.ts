import { getCompanyById, markCompanyClaimed } from "../db/queries";
import { emailDomain, PUBLIC_EMAIL_DOMAINS } from "../claims";
import { track } from "../events";
import { addMember, companyHasMembers, type User } from "./store";

/**
 * Turning a signed-in person into the owner of a company.
 *
 * The decision is deliberately boring and written down: an address on the
 * company's own domain is proof enough, a free mailbox never is, and
 * everything else waits for a human. Nothing here is a heuristic that has to
 * be reverse-engineered from behaviour later.
 */

export type ClaimOutcome =
  | { status: "APPROVED"; reason: "DOMAIN_MATCH" | "ALREADY_MEMBER" }
  | { status: "PENDING"; reason: "FREE_EMAIL" | "DOMAIN_MISMATCH" }
  | { status: "REFUSED"; reason: "ALREADY_CLAIMED" | "NO_SUCH_COMPANY" };

/**
 * Why a claim was decided the way it was, in words, for the audit trail and
 * for the admin screen. Kept next to the rule it describes so the two cannot
 * drift apart.
 */
export function explainOutcome(outcome: ClaimOutcome): string {
  switch (outcome.reason) {
    case "DOMAIN_MATCH":
      return "The address is on the company's own domain.";
    case "ALREADY_MEMBER":
      return "This person already manages the company.";
    case "FREE_EMAIL":
      return "A free mailbox cannot prove who owns a domain, so a human decides.";
    case "DOMAIN_MISMATCH":
      return "The address is not on the company's domain, so a human decides.";
    case "ALREADY_CLAIMED":
      return "Somebody else already manages this company.";
    case "NO_SUCH_COMPANY":
      return "That company does not exist.";
  }
}

/**
 * Does this address prove control of the company's domain?
 *
 * Exported and tested separately because it is the only thing standing between
 * a stranger and somebody else's profile.
 */
export function domainProvesOwnership(
  email: string,
  companyDomain: string,
): { proves: boolean; freeMailbox: boolean } {
  const from = emailDomain(email);
  if (!from) return { proves: false, freeMailbox: false };
  if (PUBLIC_EMAIL_DOMAINS.has(from)) return { proves: false, freeMailbox: true };

  const target = companyDomain.trim().toLowerCase();
  if (!target) return { proves: false, freeMailbox: false };

  /*
   * `mail.acme.dev` claiming `acme.dev` is the same organisation. The reverse
   * — `acme.dev` claiming `mail.acme.dev` — is accepted too, because a
   * company listed under a subdomain is our imprecision, not theirs.
   *
   * What is NOT accepted is a shared suffix: `notacme.dev` must not match
   * `acme.dev`, which is why both directions test for a dot boundary.
   */
  const proves =
    from === target ||
    from.endsWith(`.${target}`) ||
    target.endsWith(`.${from}`);

  return { proves, freeMailbox: false };
}

/**
 * Decide, and act. Approving writes the membership and marks the company
 * claimed; pending writes nothing but the event, so an unapproved claim can
 * never be mistaken for ownership.
 */
export async function settleOwnership(input: {
  user: User;
  companyId: string;
}): Promise<ClaimOutcome> {
  const company = await getCompanyById(input.companyId);
  if (!company) return { status: "REFUSED", reason: "NO_SUCH_COMPANY" };

  // Returning owner: this is how a second visit is not a second claim.
  const { getMembership } = await import("./store");
  if (await getMembership(input.user.id, company.id)) {
    return { status: "APPROVED", reason: "ALREADY_MEMBER" };
  }

  // Somebody else got here first. Never hand a managed company to a stranger.
  if (await companyHasMembers(company.id)) {
    return { status: "REFUSED", reason: "ALREADY_CLAIMED" };
  }

  const { proves, freeMailbox } = domainProvesOwnership(
    input.user.email,
    company.domain,
  );

  if (!proves) {
    const reason = freeMailbox ? "FREE_EMAIL" : "DOMAIN_MISMATCH";
    await track("claim_started", {
      companyId: company.id,
      props: { decision: "PENDING", reason, email: input.user.email },
    });
    return { status: "PENDING", reason };
  }

  await addMember({ userId: input.user.id, companyId: company.id, role: "OWNER" });
  await markCompanyClaimed(company.id);
  await track("claim_verified", {
    companyId: company.id,
    props: { decision: "APPROVED", reason: "DOMAIN_MATCH", email: input.user.email },
  });

  return { status: "APPROVED", reason: "DOMAIN_MATCH" };
}

/** Admin approving a claim a human had to look at. */
export async function approveOwnership(input: {
  userId: string;
  companyId: string;
}): Promise<void> {
  await addMember({ ...input, role: "OWNER" });
  await markCompanyClaimed(input.companyId);
  await track("claim_verified", {
    companyId: input.companyId,
    props: { decision: "APPROVED", reason: "ADMIN_REVIEW" },
  });
}
