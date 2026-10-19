"use server";

import { redirect } from "next/navigation";
import { brand } from "@/lib/brand";
import { canEdit } from "@/lib/session";
import { canManage } from "@/lib/auth/session";
import { getCompanyByDomain } from "@/lib/db/queries";
import { isValidEmail } from "@/lib/claims";
import { track } from "@/lib/events";
import { InvalidSiteUrlError, normalizeSiteUrl } from "@/lib/url";
import { routes } from "@/lib/routes";
import { googleConfigured } from "@/lib/auth/google";
import { domainProvesOwnership } from "@/lib/auth/claim";
import {
  addRefusal,
  readAddDraft,
  serializeAddDraft,
  type AddDraft,
} from "@/lib/auth/add";
import { mailLoginLink } from "@/lib/auth/link";
import { beginGoogleSignIn } from "@/lib/auth/start";

export interface FormState {
  error?: string;
  sent?: string;
  /** What was typed, echoed back so a refused submit does not empty the form. */
  values?: Record<string, string>;
  /** Changes on every submit, so the fields remount with the echoed values. */
  stamp?: string;
}

const ECHOED = ["name", "description", "category", "audience", "builtBy", "email"] as const;

function echo(formData: FormData): Pick<FormState, "values" | "stamp"> {
  const values: Record<string, string> = {};
  for (const field of ECHOED) {
    const value = formData.get(field);
    if (typeof value === "string" && value) values[field] = value;
  }
  return { values, stamp: `${Date.now()}` };
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
 * A domain that is already on the graph is never added again. Depending on
 * who is asking, they manage it already, can claim it, or can look at it.
 */
async function sendToExisting(domain: string): Promise<void> {
  const existing = await getCompanyByDomain(domain);
  if (!existing) return;
  if (await canManage(existing.id)) redirect(routes.manage(existing.slug));
  if (await canEdit(existing.id)) redirect(routes.stack(existing.slug));
  if (existing.status === "UNCLAIMED") redirect(routes.claim(existing.slug));
  redirect(routes.profile(existing.slug));
}

/**
 * Step 2: the detected details, corrected by the person who knows — and an
 * address that proves they are that company.
 *
 * Nothing is created here. A company can only add itself, so the profile is
 * held as a draft next to a sign-in link, the link goes to an address on the
 * company's own domain, and opening it is what creates the profile. A free
 * mailbox or another company's domain is refused before any link exists.
 */
export async function requestAddLink(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const typed = echo(formData);

  const read = readAddDraft(formData);
  if ("error" in read) return { ...typed, error: read.error };
  const { draft } = read;

  await sendToExisting(draft.domain);

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!isValidEmail(email)) {
    return { ...typed, error: "That doesn't look like an email address." };
  }

  const { proves, freeMailbox } = domainProvesOwnership(email, draft.domain);
  if (!proves) return { ...typed, error: addRefusal(draft.domain, freeMailbox) };

  const mailed = await mailLoginLink({
    email,
    subject: `Add ${draft.name} to ${brand.name}`,
    intro: `Here is your link to add ${draft.name} to ${brand.name}.`,
    claimDraft: serializeAddDraft(draft),
  });
  if (!mailed.ok) return { ...typed, error: mailed.error };

  return {
    ...typed,
    sent: `Link sent to ${email}. Open it to add ${draft.name}, then name two tools you use.${
      mailed.devLink ? ` ${mailed.devLink}` : ""
    }`,
  };
}

/**
 * The same, through Google. There is no address to check before leaving, so
 * the draft rides in a cookie and the callback checks the address Google
 * vouches for against the domain — see `settleAdd`.
 */
export async function startGoogleAdd(formData: FormData): Promise<void> {
  const url = String(formData.get("url") ?? "");
  if (!googleConfigured()) {
    redirect(`${routes.addConfirm(url)}&error=google-unavailable`);
  }

  const read = readAddDraft(formData);
  if ("error" in read) redirect(`${routes.addConfirm(url)}&error=draft`);
  const draft: AddDraft = read.draft;

  await sendToExisting(draft.domain);
  await beginGoogleSignIn("", serializeAddDraft(draft));
}
