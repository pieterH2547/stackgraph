import { CATEGORIES } from "../brand";
import { getCompanyByDomain, getCompanyById } from "../db/queries";
import { nowIso } from "../ids";
import { MAX_DESCRIPTION } from "../limits";
import { addCompany } from "../network";
import { routes } from "../routes";
import type { Company } from "../types";
import { tryNormalizeSiteUrl } from "../url";
import {
  domainProvesOwnership,
  settleOwnership,
  type ClaimOutcome,
} from "./claim";
import { applyClaimDraft } from "./draft";
import type { User } from "./store";

/**
 * A company can only add itself.
 *
 * "Claim your company" used to create the profile the moment the form was
 * submitted and hand that browser the right to edit it, with nothing proved.
 * Anybody could type facebook.com, name two tools and see "✓ Claimed" on a
 * company that had never heard of us. So adding is now the claim flow with a
 * profile that does not exist yet: what was typed is held as a draft next to a
 * sign-in link, the link goes to an address on the company's own domain, and
 * only opening it creates the profile.
 *
 * The draft carries no company id, because there is none yet. That is also
 * what keeps it apart from a claim draft: neither parser accepts the other.
 */

export interface AddDraft {
  kind: "add";
  domain: string;
  website: string;
  name: string;
  description: string;
  category: string;
  audience: string;
  builtBy: string;
  logoUrl: string;
  detectedAt: string;
  detectedFrom: string;
}

function text(value: FormDataEntryValue | null, limit: number): string {
  return String(value ?? "").trim().slice(0, limit);
}

/** The confirm form, read and validated, or what is wrong with it. */
export function readAddDraft(
  formData: FormData,
): { draft: AddDraft } | { error: string } {
  const site = tryNormalizeSiteUrl(String(formData.get("url") ?? ""));
  if (!site) return { error: "That doesn't look like a website address." };

  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) return { error: "A company needs a name." };
  if (name.length > 60) return { error: "That name is too long." };

  const description = String(formData.get("description") ?? "").trim();
  if (description.length > MAX_DESCRIPTION) {
    return { error: `Keep the one-liner under ${MAX_DESCRIPTION} characters.` };
  }

  const categoryRaw = text(formData.get("category"), 40);
  const category = (CATEGORIES as readonly string[]).includes(categoryRaw)
    ? categoryRaw
    : "";

  // A logo is rendered on a public page, so only a real web address gets in.
  const logoRaw = text(formData.get("logoUrl"), 500);
  const logoUrl = /^https?:\/\/[^\s"'<>]+$/i.test(logoRaw) ? logoRaw : "";

  return {
    draft: {
      kind: "add",
      domain: site.domain,
      website: site.website,
      name,
      description,
      category,
      audience: text(formData.get("audience"), 60),
      builtBy: text(formData.get("builtBy"), 60),
      logoUrl,
      detectedAt: text(formData.get("detectedAt"), 40),
      detectedFrom: text(formData.get("detectedFrom"), 20),
    },
  };
}

export function serializeAddDraft(draft: AddDraft): string {
  return JSON.stringify(draft);
}

/** Never throws, and never mistakes a claim draft for an add draft. */
export function parseAddDraft(raw: string | null | undefined): AddDraft | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const value = parsed as Record<string, unknown>;
    if (value.kind !== "add") return null;

    const site =
      typeof value.website === "string" ? tryNormalizeSiteUrl(value.website) : null;
    if (!site || value.domain !== site.domain) return null;

    const field = (key: string) =>
      typeof value[key] === "string" ? (value[key] as string) : "";

    const name = field("name").trim();
    if (name.length < 2) return null;

    return {
      kind: "add",
      domain: site.domain,
      website: site.website,
      name,
      description: field("description"),
      category: field("category"),
      audience: field("audience"),
      builtBy: field("builtBy"),
      logoUrl: field("logoUrl"),
      detectedAt: field("detectedAt"),
      detectedFrom: field("detectedFrom"),
    };
  } catch {
    return null;
  }
}

/** The one sentence a refusal needs, for whichever door it came through. */
export function addRefusal(domain: string, freeMailbox: boolean): string {
  return freeMailbox
    ? `A free mailbox can't show that ${domain} is yours. Use your @${domain} address.`
    : `Use an address on @${domain}. Only someone at ${domain} can add it.`;
}

export type AddOutcome =
  /** A new profile, and the person who proved the domain manages it. */
  | { status: "ADDED"; company: Company }
  /** The domain was already on the graph; this was a claim of that profile. */
  | { status: "EXISTING"; company: Company; outcome: ClaimOutcome }
  /** The address does not prove the domain. Nothing was written. */
  | { status: "REFUSED"; reason: "FREE_EMAIL" | "DOMAIN_MISMATCH" };

/**
 * Called once the address is proved, from the email link or from Google.
 *
 * The domain is checked again here rather than trusted from the request that
 * sent the link: the address that opened it is the one that counts, and the
 * Google door never had one to check before.
 */
export async function settleAdd(input: {
  user: User;
  draft: AddDraft;
}): Promise<AddOutcome> {
  const { draft, user } = input;
  const { proves, freeMailbox } = domainProvesOwnership(user.email, draft.domain);
  if (!proves) {
    return { status: "REFUSED", reason: freeMailbox ? "FREE_EMAIL" : "DOMAIN_MISMATCH" };
  }

  /*
   * Somebody named them while the link sat in an inbox, or it was imported.
   * Same company, same rules: this is now a claim of the profile that is
   * there, and the typed fields are applied the way a claim applies them.
   */
  const existing = await getCompanyByDomain(draft.domain);
  if (existing) {
    const outcome = await settleOwnership({ user, companyId: existing.id });
    if (outcome.status === "APPROVED") {
      await applyClaimDraft(existing, {
        companyId: existing.id,
        name: draft.name,
        description: draft.description,
        category: draft.category,
        audience: draft.audience,
        builtBy: draft.builtBy,
        website: draft.website,
        claimName: "",
        claimRole: "",
      });
    }
    return {
      status: "EXISTING",
      company: (await getCompanyById(existing.id)) ?? existing,
      outcome,
    };
  }

  const { company } = await addCompany({
    url: draft.website,
    name: draft.name,
    description: draft.description || null,
    category: draft.category || null,
    audience: draft.audience || null,
    builtBy: draft.builtBy || null,
    logoUrl: draft.logoUrl || null,
    contactEmail: user.email,
    source: "SELF_ADDED",
    // Unclaimed until it names two independent tools, like everyone else.
    status: "UNCLAIMED",
    claimVerifiedAt: nowIso(),
    detectedAt: draft.detectedAt || null,
    detectedFrom: draft.detectedFrom || null,
  });

  // A profile nobody manages yet, and an address on its domain: this approves.
  await settleOwnership({ user, companyId: company.id });

  return { status: "ADDED", company: (await getCompanyById(company.id)) ?? company };
}

/** Where an add lands, whichever door it came through. */
export function addDestination(result: AddOutcome, domain: string): string {
  if (result.status === "REFUSED") {
    return `${routes.add()}?error=not-your-domain&domain=${encodeURIComponent(domain)}`;
  }
  if (result.status === "ADDED" || result.outcome.status === "APPROVED") {
    return routes.manage(result.company.slug);
  }
  return `${routes.profile(result.company.slug)}?claim=${result.outcome.status.toLowerCase()}&why=${result.outcome.reason}`;
}
