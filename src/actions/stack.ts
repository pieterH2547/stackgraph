"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  deleteRelationship,
  getCompanyBySlug,
  getEdgeById,
} from "@/lib/db/queries";
import {
  StackValidationError,
  submitStack,
  type StackToolInput,
} from "@/lib/network";
import { MAX_TOOLS } from "@/lib/limits";
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

/**
 * Somebody credited your product and you don't recognise them. The edge leaves
 * the public graph, and the company that stated it keeps its claimed status —
 * a claim others could revoke would make every claim hostage to someone else.
 *
 * Only the *target* judges: the source is the one making a statement about its
 * own stack, so it has nothing to confirm and no standing to retract someone
 * else's correction of it.
 */
export async function disputeRelationship(
  relationshipId: string,
): Promise<void> {
  const edge = await getEdgeById(relationshipId);
  if (!edge) return;
  if (!(await canEdit(edge.target.id))) return;

  await deleteRelationship(edge.id);

  await track("relationship_disputed", {
    companyId: edge.source.id,
    targetCompanyId: edge.target.id,
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
