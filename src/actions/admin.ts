"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { CATEGORIES } from "@/lib/brand";
import {
  getCompanyById,
  listIncomingEdges,
  updateCompany,
} from "@/lib/db/queries";
import { addCompany } from "@/lib/network";
import { notifyMention } from "@/lib/notify";
import { grantAdmin, isAdmin } from "@/lib/session";
import { nowIso } from "@/lib/ids";
import type { CompanyStatus } from "@/lib/types";

export interface AdminFormState {
  error?: string;
  message?: string;
}

export async function adminLogin(
  _state: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  const ok = await grantAdmin(String(formData.get("key") ?? ""));
  if (!ok) return { error: "Wrong key." };
  redirect("/admin");
}

async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin");
}

/** Cold start: the first 10–20 real companies are seeded by hand. */
export async function seedCompany(
  _state: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await requireAdmin();

  const url = String(formData.get("url") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const contactEmail = String(formData.get("contactEmail") ?? "").trim();

  if (!url) return { error: "A website is required." };

  try {
    // Seeds are the match, not an exception: unclaimed like everyone else,
    // and they earn CLAIMED by showing both sides of their company.
    const { company, created } = await addCompany({
      url,
      name: name || undefined,
      contactEmail: contactEmail || null,
      source: "SEED",
      status: "UNCLAIMED",
    });
    revalidatePath("/admin");
    revalidatePath("/");
    return {
      message: created
        ? `Created ${company.name}.`
        : `${company.name} was already in the network.`,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not create that.",
    };
  }
}

export async function saveCompany(
  companyId: string,
  _state: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  await requireAdmin();

  const company = await getCompanyById(companyId);
  if (!company) return { error: "Gone." };

  const status = String(formData.get("status") ?? company.status) as CompanyStatus;
  const categoryRaw = String(formData.get("category") ?? "").trim();
  const networkEligible = formData.get("networkEligible") === "on";

  await updateCompany(companyId, {
    name: String(formData.get("name") ?? company.name).trim() || company.name,
    description: String(formData.get("description") ?? "").trim() || null,
    category: (CATEGORIES as readonly string[]).includes(categoryRaw)
      ? categoryRaw
      : null,
    logoUrl: String(formData.get("logoUrl") ?? "").trim() || null,
    contactEmail: String(formData.get("contactEmail") ?? "").trim() || null,
    status,
    claimedAt:
      status === "CLAIMED" ? (company.claimedAt ?? nowIso()) : null,
    networkEligible,
    eligibilityReason:
      networkEligible === company.networkEligible
        ? company.eligibilityReason
        : "ADMIN_OVERRIDE",
  });

  revalidatePath("/admin");
  revalidatePath(`/admin/${companyId}`);
  revalidatePath(`/c/${company.slug}`);
  return { message: "Saved." };
}

/** Re-send a claim invitation, skipping the cooldown. */
export async function resendInvite(
  companyId: string,
  _state: AdminFormState,
  _formData: FormData,
): Promise<AdminFormState> {
  await requireAdmin();

  const incoming = await listIncomingEdges(companyId);
  const latest = incoming[0];
  if (!latest) {
    return {
      error:
        "Nobody has credited this company yet, so there is no recognition to send.",
    };
  }

  const result = await notifyMention({
    vendorId: companyId,
    mentionedById: latest.source.id,
    force: true,
  });

  revalidatePath(`/admin/${companyId}`);
  return { message: `Notification: ${result.outcome}.` };
}
