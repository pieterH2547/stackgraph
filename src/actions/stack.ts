"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  deleteRelationship,
  getCompanyBySlug,
  getEdgeById,
  setRelationshipState,
} from "@/lib/db/queries";
import {
  StackValidationError,
  submitCustomers,
  submitStack,
  type CustomerInput,
  type StackToolInput,
} from "@/lib/network";
import { MAX_CUSTOMERS, MAX_TOOLS } from "@/lib/limits";
import { canEdit } from "@/lib/session";
import { routes } from "@/lib/routes";
import { track } from "@/lib/events";

export interface StackFormState {
  error?: string;
  message?: string;
}

function parseEntries(raw: unknown, max: number): StackToolInput[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.slice(0, max).map((entry) => {
    const tool = entry as Record<string, unknown>;
    return {
      existingCompanyId:
        typeof tool.existingCompanyId === "string"
          ? tool.existingCompanyId
          : undefined,
      name: typeof tool.name === "string" ? tool.name : undefined,
      website: typeof tool.website === "string" ? tool.website : undefined,
    };
  });
}

/**
 * The flywheel turn. Everything slow (reading vendor sites, sending the
 * recognition emails) is handed to `after` so the person who just gave credit
 * gets their result immediately — cycle time is a headline metric, and it
 * starts here.
 */
export async function saveStack(
  slug: string,
  _state: StackFormState,
  formData: FormData,
): Promise<StackFormState> {
  const company = await getCompanyBySlug(slug);
  if (!company) return { error: "That company doesn't exist." };
  if (!(await canEdit(company.id))) {
    return { error: "This isn't your company to edit." };
  }

  const tools = parseEntries(formData.get("tools"), MAX_TOOLS);
  if (tools.length === 0) return { error: "Add at least one tool." };

  let claimed = company.status === "CLAIMED";
  try {
    const result = await submitStack(
      { companyId: company.id, tools },
      { defer: (task) => after(task) },
    );
    claimed = result.company.status === "CLAIMED";
  } catch (error) {
    return {
      error:
        error instanceof StackValidationError
          ? error.message
          : "Something went wrong saving your stack.",
    };
  }

  revalidatePath(routes.home());
  revalidatePath(routes.profile(company.slug));
  // Half a claim goes back to the unlock page for the other half.
  redirect(claimed ? routes.done(company.slug) : routes.stack(company.slug));
}

/** The optional second direction: software companies that use this vendor. */
export async function saveCustomers(
  slug: string,
  _state: StackFormState,
  formData: FormData,
): Promise<StackFormState> {
  const company = await getCompanyBySlug(slug);
  if (!company) return { error: "That company doesn't exist." };
  if (!(await canEdit(company.id))) {
    return { error: "This isn't your company to edit." };
  }

  const customers: CustomerInput[] = parseEntries(
    formData.get("tools"),
    MAX_CUSTOMERS,
  ).map(({ existingCompanyId, name, website }) => ({
    existingCompanyId,
    name,
    website,
  }));

  if (customers.length === 0) return { error: "Name at least one company." };

  let claimed = company.status === "CLAIMED";
  try {
    const result = await submitCustomers(
      { companyId: company.id, customers },
      { defer: (task) => after(task) },
    );
    claimed = result.company.status === "CLAIMED";
  } catch (error) {
    return {
      error:
        error instanceof StackValidationError
          ? error.message
          : "Something went wrong saving that.",
    };
  }

  revalidatePath(routes.home());
  revalidatePath(routes.profile(company.slug));
  redirect(claimed ? routes.done(company.slug) : routes.stack(company.slug));
}

/**
 * A relationship somebody else stated about you. "Looks right" confirms it,
 * "Not accurate" takes it out of the graph. Either way the vendor who stated
 * it keeps its claimed status — a claim that others could revoke would make
 * every claim hostage to someone else.
 */
export async function judgeRelationship(
  relationshipId: string,
  verdict: "CONFIRMED" | "DISPUTED",
): Promise<void> {
  const edge = await getEdgeById(relationshipId);
  if (!edge) return;

  // Only the company the claim is *about* gets to judge it.
  if (!(await canEdit(edge.source.id))) return;
  if (edge.reportedByCompanyId === edge.source.id) return;

  if (verdict === "CONFIRMED") {
    await setRelationshipState(edge.id, "CONFIRMED");
  } else {
    await deleteRelationship(edge.id);
  }

  await track("relationship_created", {
    companyId: edge.source.id,
    targetCompanyId: edge.target.id,
    props: { judged: verdict },
  });

  revalidatePath(routes.profile(edge.source.slug));
  revalidatePath(routes.profile(edge.target.slug));
}

export async function trackShare(slug: string, channel: string): Promise<void> {
  const company = await getCompanyBySlug(slug);
  await track("share_clicked", {
    companyId: company?.id ?? null,
    props: { channel, slug },
  });
}
