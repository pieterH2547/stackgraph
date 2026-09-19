"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { CATEGORIES } from "@/lib/brand";
import {
  deleteOrphanedMention,
  deleteRelationship,
  getEdgeById,
  updateCompany,
} from "@/lib/db/queries";
import { MAX_DESCRIPTION, MAX_TOOLS } from "@/lib/limits";
import { StackValidationError, submitStack } from "@/lib/network";
import { routes } from "@/lib/routes";
import { track } from "@/lib/events";
import { tryNormalizeSiteUrl } from "@/lib/url";
import { requireManager } from "@/lib/auth/session";
import { roleFor } from "@/lib/auth/session";

/**
 * Every action here calls `requireManager` first, and that is the
 * authorisation — not the fact that the button was only rendered on a page a
 * manager could reach. A server action is a public endpoint; the UI is a hint.
 */

export interface ManageState {
  error?: string;
  saved?: string;
}

/* -------------------------------------------------------------------------- */
/* the profile a company controls                                             */
/* -------------------------------------------------------------------------- */

/**
 * What a company may say about itself. Notably absent: anything derived rather
 * than declared — the detected stack, the About read from their site, the
 * claim state, network eligibility, generation. Those are ours, and a vendor
 * editing them would turn observations into assertions.
 */
export async function saveProfile(
  slug: string,
  _state: ManageState,
  formData: FormData,
): Promise<ManageState> {
  let company;
  try {
    ({ company } = await requireManager(slug));
  } catch {
    return { error: "That isn't your company to manage." };
  }

  const website = String(formData.get("website") ?? "").trim();
  const site = website ? tryNormalizeSiteUrl(website) : null;
  if (website && !site) {
    return { error: "That website address doesn't look right." };
  }
  /*
   * The domain is identity here: every edge, slug and claim decision hangs off
   * it. Changing the website to a different company would silently re-point
   * all of that, so the host has to stay the same.
   */
  if (site && site.domain !== company.domain) {
    return {
      error: `The website has to stay on ${company.domain}. Ask us to move it if the domain really changed.`,
    };
  }

  const category = String(formData.get("category") ?? "").trim();
  if (category && !CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
    return { error: "Pick a category from the list." };
  }

  const description = String(formData.get("description") ?? "").trim();
  if (description.length > MAX_DESCRIPTION) {
    return { error: `Keep the one-liner under ${MAX_DESCRIPTION} characters.` };
  }

  await updateCompany(company.id, {
    name: String(formData.get("name") ?? "").trim() || company.name,
    description: description || null,
    category: category || null,
    audience: String(formData.get("audience") ?? "").trim() || null,
    builtBy: String(formData.get("builtBy") ?? "").trim() || null,
    logoUrl: String(formData.get("logoUrl") ?? "").trim() || null,
    website: site?.website ?? company.website,
  });

  revalidatePath(routes.profile(company.slug));
  revalidatePath(routes.manage(company.slug));
  return { saved: "Saved." };
}

/* -------------------------------------------------------------------------- */
/* the stack                                                                  */
/* -------------------------------------------------------------------------- */

interface ToolEntry {
  existingCompanyId?: string;
  name?: string;
  website?: string;
}

function parseEntries(raw: unknown): ToolEntry[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_TOOLS).flatMap((entry): ToolEntry[] => {
      if (typeof entry !== "object" || entry === null) return [];
      const { existingCompanyId, name, website } = entry as Record<string, unknown>;
      return [
        {
          existingCompanyId:
            typeof existingCompanyId === "string" ? existingCompanyId : undefined,
          name: typeof name === "string" ? name : undefined,
          website: typeof website === "string" ? website : undefined,
        },
      ];
    });
  } catch {
    return [];
  }
}

/**
 * Add tools to our own stack.
 *
 * A tool that isn't in the network yet is created here, from a name and a
 * website, as an unclaimed profile with its own slug and public page — and the
 * edge to it. No admin has to create anything first, which is the difference
 * between a graph that grows and a directory that waits.
 */
export async function addTools(
  slug: string,
  _state: ManageState,
  formData: FormData,
): Promise<ManageState> {
  let company;
  try {
    ({ company } = await requireManager(slug));
  } catch {
    return { error: "That isn't your company to manage." };
  }

  const tools = parseEntries(formData.get("tools"));
  if (tools.length === 0) return { error: "Pick at least one tool." };

  try {
    await submitStack(
      { companyId: company.id, tools },
      { defer: (task) => after(task) },
    );
  } catch (error) {
    return {
      error:
        error instanceof StackValidationError
          ? error.message
          : "Something went wrong saving that.",
    };
  }

  revalidatePath(routes.home());
  revalidatePath(routes.network());
  revalidatePath(routes.profile(company.slug));
  revalidatePath(routes.manage(company.slug));
  return { saved: "Added to your stack." };
}

/** Withdraw a tool we credited. Our statement, ours to correct. */
export async function removeTool(
  slug: string,
  relationshipId: string,
): Promise<void> {
  const { company } = await requireManager(slug);

  const edge = await getEdgeById(relationshipId);
  // The edge has to be ours: a manager of A cannot edit B's stack.
  if (!edge || edge.source.id !== company.id) return;

  await deleteRelationship(edge.id);
  const removed = await deleteOrphanedMention(edge.target.id);

  await track("credit_retracted", {
    companyId: company.id,
    targetCompanyId: removed ? null : edge.target.id,
    props: { domain: edge.target.domain, profileRemoved: removed },
  });

  revalidatePath(routes.manage(slug));
  revalidatePath(routes.profile(slug));
  if (!removed) revalidatePath(routes.profile(edge.target.slug));
}

/**
 * Somebody says they use us and we don't recognise them at all.
 *
 * Only the credited company can do this, and it never touches the other
 * side's claimed status — a claim others could revoke would make every claim
 * hostage to someone else.
 */
export async function disputeIncoming(
  slug: string,
  relationshipId: string,
): Promise<void> {
  const { company } = await requireManager(slug);

  const edge = await getEdgeById(relationshipId);
  if (!edge || edge.target.id !== company.id) return;

  await deleteRelationship(edge.id);
  await track("relationship_disputed", {
    companyId: edge.source.id,
    targetCompanyId: company.id,
  });

  revalidatePath(routes.manage(slug));
  revalidatePath(routes.profile(slug));
  revalidatePath(routes.profile(edge.source.slug));
}

/** Straight from a public profile into managing it, when you already can. */
export async function goManage(slug: string): Promise<void> {
  const role = await roleFor((await requireManager(slug)).company.id);
  if (!role) return;
  redirect(routes.manage(slug));
}
