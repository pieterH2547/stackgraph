import { CATEGORIES } from "../brand";
import { MAX_DESCRIPTION } from "../limits";
import { updateCompany } from "../db/queries";
import { tryNormalizeSiteUrl } from "../url";
import type { Company } from "../types";

/**
 * What a claimant typed before we knew who they were.
 *
 * The claim form asks for the whole profile in one go, because the moment
 * somebody decides to claim is the moment they are willing to type — sending
 * them to an empty form after a round trip through their inbox loses most of
 * them. But anyone can open a claim page for any company, so what they type
 * cannot touch the profile until the address is proved.
 *
 * So the draft is held: next to the login token for the email door, in a
 * short-lived cookie for the Google door, and applied only where
 * `settleOwnership` returns APPROVED. A draft that arrives with a claim a
 * human still has to look at stays stored and unapplied — the company's page
 * keeps saying what it said before, which is the only safe default when the
 * person typing might not be who they say they are.
 *
 * Deliberately absent: the tools the company uses. Those are edges, and an
 * edge is a public statement about somebody else's product. They are asked for
 * after the claim is settled, where the person making the statement is known.
 */

export interface ClaimDraft {
  companyId: string;
  name: string;
  description: string;
  category: string;
  audience: string;
  builtBy: string;
  website: string;
  /** The person, not the company. Stored on the company as the claim contact. */
  claimName: string;
  claimRole: string;
}

const MAX_SHORT = 80;

function short(value: FormDataEntryValue | null, limit = MAX_SHORT): string {
  return String(value ?? "").trim().slice(0, limit);
}

/**
 * Reads the form, or says what is wrong with it in one sentence.
 *
 * Validation lives here rather than in the action so the same rules apply
 * whichever door the draft came through, and so they can be tested without a
 * request.
 */
export function readClaimDraft(
  company: Company,
  formData: FormData,
): { draft: ClaimDraft } | { error: string } {
  const description = String(formData.get("description") ?? "").trim();
  if (description.length > MAX_DESCRIPTION) {
    return { error: `Keep the one-liner under ${MAX_DESCRIPTION} characters.` };
  }

  const category = short(formData.get("category"), 40);
  if (category && !CATEGORIES.includes(category as (typeof CATEGORIES)[number])) {
    return { error: "Pick a category from the list." };
  }

  /*
   * The domain is identity: every edge, slug and claim decision hangs off it.
   * A claim form that could re-point the website to another company would be
   * a way to take over a profile by typing, so the host has to stay put.
   */
  const website = short(formData.get("website"), 200);
  const site = website ? tryNormalizeSiteUrl(website) : null;
  if (website && !site) {
    return { error: "That website address doesn't look right." };
  }
  if (site && site.domain !== company.domain) {
    return { error: `The website has to stay on ${company.domain}.` };
  }

  return {
    draft: {
      companyId: company.id,
      name: short(formData.get("name"), 120) || company.name,
      description,
      category,
      audience: short(formData.get("audience")),
      builtBy: short(formData.get("builtBy")),
      website: site?.website ?? company.website,
      claimName: short(formData.get("claimName")),
      claimRole: short(formData.get("claimRole")),
    },
  };
}

export function serializeDraft(draft: ClaimDraft): string {
  return JSON.stringify(draft);
}

/** Never throws: a draft that will not parse is simply not applied. */
export function parseDraft(raw: string | null | undefined): ClaimDraft | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const value = parsed as Record<string, unknown>;
    if (typeof value.companyId !== "string" || !value.companyId) return null;

    const text = (key: string) =>
      typeof value[key] === "string" ? (value[key] as string) : "";

    return {
      companyId: value.companyId,
      name: text("name"),
      description: text("description"),
      category: text("category"),
      audience: text("audience"),
      builtBy: text("builtBy"),
      website: text("website"),
      claimName: text("claimName"),
      claimRole: text("claimRole"),
    };
  } catch {
    return null;
  }
}

/**
 * Write the draft onto the company. Only ever called for an approved claim,
 * and only for the company the draft was written against — a draft cannot be
 * carried to a different profile.
 *
 * A blank field leaves what is already there alone rather than erasing it:
 * somebody who skipped the category should not wipe the one we read from
 * their site.
 */
export async function applyClaimDraft(
  company: Company,
  draft: ClaimDraft | null,
): Promise<boolean> {
  if (!draft || draft.companyId !== company.id) return false;

  const patch = {
    ...(draft.name ? { name: draft.name } : {}),
    ...(draft.description ? { description: draft.description } : {}),
    ...(draft.category ? { category: draft.category } : {}),
    ...(draft.audience ? { audience: draft.audience } : {}),
    ...(draft.builtBy ? { builtBy: draft.builtBy } : {}),
    ...(draft.website ? { website: draft.website } : {}),
    ...(draft.claimName ? { claimName: draft.claimName } : {}),
    ...(draft.claimRole ? { claimRole: draft.claimRole } : {}),
  };

  if (Object.keys(patch).length === 0) return false;
  await updateCompany(company.id, patch);
  return true;
}
