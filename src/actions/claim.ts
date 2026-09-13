"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { brand } from "@/lib/brand";
import {
  claimDomainMatches,
  claimExpired,
  confirmClaim,
  createClaim,
  getClaimByToken,
  isValidEmail,
} from "@/lib/claims";
import {
  getCompanyById,
  getCompanyBySlug,
  recordClaimIdentity,
} from "@/lib/db/queries";
import { sendEmail, showsDevLinks } from "@/lib/email";
import { track } from "@/lib/events";
import { settleClaim } from "@/lib/network";
import { grantEditAccess } from "@/lib/session";
import { postClaimDestination, routes } from "@/lib/routes";
import { absoluteUrl } from "@/lib/url";

export interface ClaimFormState {
  error?: string;
  sentTo?: string;
  /** Shown only when nothing can deliver mail, so the loop stays walkable. */
  devLink?: string;
}

/**
 * Lightweight on purpose: clicking the link in the mailbox you named is the
 * verification. A work address on the company's own domain is the clean case;
 * anything else still works but is flagged in admin for a human to look at.
 */
export async function startClaim(
  slug: string,
  _state: ClaimFormState,
  formData: FormData,
): Promise<ClaimFormState> {
  const company = await getCompanyBySlug(slug);
  if (!company) return { error: "That profile doesn't exist." };
  if (company.status === "CLAIMED") {
    return { error: "This profile has already been claimed." };
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const role = String(formData.get("role") ?? "").trim();
  const represents = formData.get("represents") === "on";

  if (!isValidEmail(email)) return { error: "That email address isn't valid." };
  if (name.length < 2) return { error: "We need your name." };
  if (role.length < 2) return { error: "What's your role there?" };
  if (!represents) {
    return { error: `Confirm that you represent ${company.name}.` };
  }

  const domainMatch = claimDomainMatches(email, company.domain);
  const claim = await createClaim({
    companyId: company.id,
    email,
    name,
    role,
    domainMatch,
  });

  await track("claim_started", {
    companyId: company.id,
    props: { domainMatch },
  });

  const link = absoluteUrl(routes.claimVerify(company.slug, claim.token));
  await sendEmail({
    to: email,
    subject: `Claim ${company.name} on ${brand.name}`,
    text: [
      `Hi ${name},`,
      "",
      `Confirm you're at ${company.name} and the profile is yours:`,
      link,
      "",
      "The link works for 72 hours.",
      "",
      `— ${brand.name}`,
    ].join("\n"),
  });

  return {
    sentTo: email,
    devLink: showsDevLinks() ? link : undefined,
  };
}

/**
 * Verifying the email establishes identity. It does not finish the claim: a
 * profile turns CLAIMED once both sides of the company are shown, which is
 * exactly what this redirect goes off to collect.
 */
export async function completeClaim(token: string): Promise<void> {
  const claim = await getClaimByToken(token);
  if (!claim) redirect(routes.claimExpired());
  if (claimExpired(claim)) redirect(routes.claimExpired());

  const company = await getCompanyById(claim.companyId);
  if (!company) redirect(routes.claimExpired());

  if (company.claimVerifiedAt === null) {
    await recordClaimIdentity(company.id, {
      email: claim.email,
      name: claim.name,
      role: claim.role,
    });
    await track("claim_verified", {
      companyId: company.id,
      props: {
        domainMatch: claim.domainMatch,
        generation: company.generation,
        source: company.source,
      },
    });
  }

  await confirmClaim(claim.id);
  await grantEditAccess(company.id);

  // A vendor who somehow already has three credits is claimed on the spot.
  const refreshed = (await getCompanyById(company.id)) ?? company;
  await settleClaim(refreshed);

  await track("stack_started", {
    companyId: company.id,
    props: { after: "claim" },
  });

  revalidatePath(routes.home());
  revalidatePath(routes.profile(company.slug));
  redirect(postClaimDestination(company.slug));
}
