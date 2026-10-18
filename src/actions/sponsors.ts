"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  createSponsor,
  deleteSponsor,
  getSponsorById,
  updateSponsor,
} from "@/lib/db/sponsors";
import { routes } from "@/lib/routes";
import { isAdmin } from "@/lib/session";
import {
  SPONSOR_PACKAGES,
  SponsorValidationError,
  validateSponsorInput,
  type SponsorInput,
  type SponsorPackage,
} from "@/lib/sponsors";

/**
 * Sponsor management. Every action re-checks the admin cookie on the server
 * before touching anything: the admin pages hiding a form is a courtesy,
 * not a permission.
 */

export interface SponsorFormState {
  error?: string;
  message?: string;
}

async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect("/admin");
}

/** "29" or "29,50" typed by a person, as cents. NaN when it isn't a number. */
function euroToCents(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const amount = Number(text.replace(",", "."));
  return Number.isFinite(amount) ? Math.round(amount * 100) : Number.NaN;
}

function readInput(formData: FormData): SponsorInput {
  const packageRaw = String(formData.get("package") ?? "SIDEBAR");
  const pkg = (
    packageRaw in SPONSOR_PACKAGES ? packageRaw : "SIDEBAR"
  ) as SponsorPackage;

  const categories = formData
    .getAll("categories")
    .map((value) => String(value))
    .filter(Boolean);

  // An empty price means "the package rate", snapshotted now so a later
  // change to the rate card leaves this agreement alone.
  const typedPrice = euroToCents(String(formData.get("monthlyPrice") ?? ""));

  return {
    name: String(formData.get("name") ?? ""),
    logoUrl: String(formData.get("logoUrl") ?? "").trim() || null,
    description: String(formData.get("description") ?? ""),
    destinationUrl: String(formData.get("destinationUrl") ?? ""),
    package: pkg,
    monthlyPriceCents:
      typedPrice === null ? SPONSOR_PACKAGES[pkg].monthlyPriceCents : typedPrice,
    categories: categories.length > 0 ? categories : null,
    active: formData.get("active") === "on",
    startsOn: String(formData.get("startsOn") ?? "").trim() || null,
    endsOn: String(formData.get("endsOn") ?? "").trim() || null,
    contactEmail: String(formData.get("contactEmail") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
  };
}

function explain(error: unknown): SponsorFormState {
  if (error instanceof SponsorValidationError) return { error: error.message };
  return { error: "Could not save that." };
}

export async function createSponsorAction(
  _state: SponsorFormState,
  formData: FormData,
): Promise<SponsorFormState> {
  await requireAdmin();

  let sponsorId: string;
  try {
    const input = validateSponsorInput(readInput(formData));
    const sponsor = await createSponsor(input);
    sponsorId = sponsor.id;
  } catch (error) {
    return explain(error);
  }

  revalidatePath(routes.adminSponsors());
  redirect(routes.adminSponsor(sponsorId));
}

export async function saveSponsor(
  sponsorId: string,
  _state: SponsorFormState,
  formData: FormData,
): Promise<SponsorFormState> {
  await requireAdmin();

  const existing = await getSponsorById(sponsorId);
  if (!existing) return { error: "Gone." };

  try {
    const input = validateSponsorInput(readInput(formData));
    await updateSponsor(sponsorId, input);
  } catch (error) {
    return explain(error);
  }

  revalidatePath(routes.adminSponsors());
  revalidatePath(routes.adminSponsor(sponsorId));
  return { message: "Saved." };
}

/** Takes its events with it. Switching a sponsor off keeps the report. */
export async function removeSponsor(
  sponsorId: string,
  _formData: FormData,
): Promise<void> {
  await requireAdmin();
  await deleteSponsor(sponsorId);
  revalidatePath(routes.adminSponsors());
  redirect(routes.adminSponsors());
}
