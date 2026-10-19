"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { brand } from "@/lib/brand";
import { getCompanyBySlug } from "@/lib/db/queries";
import { isValidEmail } from "@/lib/claims";
import { routes } from "@/lib/routes";
import { googleConfigured } from "@/lib/auth/google";
import { endSession } from "@/lib/auth/session";
import { readClaimDraft, serializeDraft } from "@/lib/auth/draft";
import { mailLoginLink } from "@/lib/auth/link";
import { beginGoogleSignIn } from "@/lib/auth/start";

export interface SignInState {
  error?: string;
  sent?: string;
  /**
   * What was typed, echoed back.
   *
   * React resets an uncontrolled form once the action settles, so without this
   * a rejected claim — a website on the wrong domain, a category that is not
   * ours — throws away eight fields somebody just filled in. The error is
   * worth showing; making them type it all again is not.
   */
  values?: Record<string, string>;
  /** Changes on every submit, so the fields remount with the echoed values. */
  stamp?: string;
}

const ECHOED = [
  "name",
  "description",
  "category",
  "audience",
  "builtBy",
  "website",
  "claimName",
  "claimRole",
  "email",
] as const;

function echo(formData: FormData): Pick<SignInState, "values" | "stamp"> {
  const values: Record<string, string> = {};
  for (const field of ECHOED) {
    const value = formData.get(field);
    if (typeof value === "string" && value) values[field] = value;
  }
  return { values, stamp: `${Date.now()}` };
}

/**
 * Sign in by email link.
 *
 * `intent` is the slug the person was trying to claim. It is stored with the
 * token rather than carried in the URL, so the claim survives the round trip
 * through a mail client and picks up where it left off.
 */
export async function sendSignInLink(
  _state: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const intent = String(formData.get("intent") ?? "").trim();

  const typed = echo(formData);

  if (!isValidEmail(email)) {
    return { ...typed, error: "That doesn't look like an email address." };
  }

  const company = intent ? await getCompanyBySlug(intent) : null;

  /*
   * The claim form posts the whole profile with the address. It is validated
   * now so a typo comes back while the form is still on screen, and stored
   * unapplied: what a stranger types must not reach a company's page before
   * the address is proved.
   */
  let claimDraft: string | null = null;
  if (company) {
    const read = readClaimDraft(company, formData);
    if ("error" in read) return { ...typed, error: read.error };
    claimDraft = serializeDraft(read.draft);
  }

  const mailed = await mailLoginLink({
    email,
    subject: company
      ? `Claim ${company.name} on ${brand.name}`
      : `Sign in to ${brand.name}`,
    intro: company
      ? `Here is your link to claim ${company.name}.`
      : "Here is your sign-in link.",
    intentCompanyId: company?.id ?? null,
    claimDraft,
  });
  if (!mailed.ok) return { ...typed, error: mailed.error };

  return {
    sent: `Link sent to ${email}.${mailed.devLink ? ` ${mailed.devLink}` : ""}`,
  };
}

/** Google, with CSRF state and the claim intent riding along inside it. */
export async function startGoogleSignIn(
  intentSlug: string,
  formData?: FormData,
): Promise<void> {
  if (!googleConfigured()) {
    redirect(`${routes.signIn()}?error=google-unavailable`);
  }

  /*
   * Google is a submit button on the claim form, not a separate form, so the
   * profile fields come with it. An invalid draft is dropped rather than
   * failing the sign-in: the person still gets in, and the form they see
   * afterwards is the one where a mistake is worth reporting.
   */
  let draft: string | null = null;
  if (formData && intentSlug) {
    const company = await getCompanyBySlug(intentSlug);
    if (company) {
      const read = readClaimDraft(company, formData);
      if ("draft" in read) draft = serializeDraft(read.draft);
    }
  }

  await beginGoogleSignIn(intentSlug, draft);
}

export async function signOut(): Promise<void> {
  await endSession();
  revalidatePath("/", "layout");
  redirect(routes.home());
}
