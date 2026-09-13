"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { addCompany } from "@/lib/network";
import { canEdit, grantEditAccess } from "@/lib/session";
import { getCompanyByDomain } from "@/lib/db/queries";
import { track } from "@/lib/events";
import { InvalidSiteUrlError, normalizeSiteUrl } from "@/lib/url";
import { routes } from "@/lib/routes";
import { CATEGORIES } from "@/lib/brand";

export interface FormState {
  error?: string;
}

/** Step 1: one field. A website is the only thing we ask for up front. */
export async function submitWebsite(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const raw = String(formData.get("url") ?? "");

  let normalized;
  try {
    normalized = normalizeSiteUrl(raw);
  } catch (error) {
    return {
      error:
        error instanceof InvalidSiteUrlError
          ? error.message
          : "That doesn't look like a website address.",
    };
  }

  await track("website_submitted", { props: { domain: normalized.domain } });
  redirect(routes.addConfirm(normalized.website));
}

/**
 * Step 1b: the detected details, corrected by the person who knows. A company
 * whose domain is already in the network is not created again — depending on
 * its state that person either claims it or already owns it.
 */
export async function confirmCompany(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const url = String(formData.get("url") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const categoryRaw = String(formData.get("category") ?? "").trim();
  const audience = String(formData.get("audience") ?? "").trim();
  const builtBy = String(formData.get("builtBy") ?? "").trim();
  const logoUrl = String(formData.get("logoUrl") ?? "").trim();
  const detectedAt = String(formData.get("detectedAt") ?? "").trim();
  const detectedFrom = String(formData.get("detectedFrom") ?? "").trim();

  if (name.length < 2) return { error: "A company needs a name." };
  if (name.length > 60) return { error: "That name is too long." };

  const category = (CATEGORIES as readonly string[]).includes(categoryRaw)
    ? categoryRaw
    : null;

  let normalized;
  try {
    normalized = normalizeSiteUrl(url);
  } catch {
    return { error: "That doesn't look like a website address." };
  }

  const existing = await getCompanyByDomain(normalized.domain);
  if (existing) {
    // Someone may already have credited them, or they may be mid-claim.
    if (await canEdit(existing.id)) redirect(routes.stack(existing.slug));
    if (existing.status === "UNCLAIMED") redirect(routes.claim(existing.slug));
    redirect(routes.profile(existing.slug));
  }

  const { company } = await addCompany({
    url: normalized.website,
    name,
    description: description || null,
    category,
    audience: audience.slice(0, 60) || null,
    builtBy: builtBy.slice(0, 60) || null,
    logoUrl: logoUrl || null,
    source: "SELF_ADDED",
    // Adding your own company settles identity — the same door a claim goes
    // through. The profile turns CLAIMED once both sides of the company are
    // shown, and not before.
    status: "UNCLAIMED",
    claimVerifiedAt: new Date().toISOString(),
    detectedAt: detectedAt || null,
    detectedFrom: detectedFrom || null,
  });

  await grantEditAccess(company.id);
  await track("stack_started", { companyId: company.id });
  revalidatePath(routes.home());
  redirect(routes.stack(company.slug));
}
