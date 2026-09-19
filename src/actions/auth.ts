"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { sendEmail } from "@/lib/email";
import { brand } from "@/lib/brand";
import { getCompanyBySlug } from "@/lib/db/queries";
import { isValidEmail } from "@/lib/claims";
import { track } from "@/lib/events";
import { routes } from "@/lib/routes";
import { absoluteUrl } from "@/lib/url";
import { googleAuthUrl, googleConfigured } from "@/lib/auth/google";
import { endSession } from "@/lib/auth/session";
import { createLoginToken, newStateToken } from "@/lib/auth/store";
import { readClaimDraft, serializeDraft } from "@/lib/auth/draft";

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
 * The claim form's contents, for the Google door.
 *
 * Google's round trip is a redirect in the same browser, so a short-lived
 * httpOnly cookie carries the draft without a second table. The email door
 * cannot use one — that link is opened on a phone as often as not — so it
 * keeps its draft on the token row instead.
 */
const DRAFT_COOKIE = "wuw_claim";
const DRAFT_MINUTES = 30;

async function stashDraft(value: string): Promise<void> {
  const store = await cookies();
  store.set(DRAFT_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DRAFT_MINUTES * 60,
  });
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

  const token = await createLoginToken({
    email,
    intentCompanyId: company?.id ?? null,
    claimDraft,
  });

  const link = absoluteUrl(`/auth/link?token=${token.token}`);
  const subject = company
    ? `Claim ${company.name} on ${brand.name}`
    : `Sign in to ${brand.name}`;

  await sendEmail({
    to: email,
    subject,
    text: [
      company
        ? `Here is your link to claim ${company.name}.`
        : "Here is your sign-in link.",
      "",
      link,
      "",
      "It works once and expires in 30 minutes. If you didn't ask for it, ignore this email — nothing happens until the link is opened.",
      "",
      `— ${brand.name}, ${brand.category}.`,
    ].join("\n"),
  });

  await track("claim_email_sent", {
    companyId: company?.id ?? null,
    props: { intent: company?.slug ?? null },
  });

  /*
   * Without a mail provider the link is returned so the whole flow stays
   * walkable locally. It is the same decision the claim flow already made, and
   * it is only ever reachable when RESEND_API_KEY is unset.
   */
  const devLink = process.env.RESEND_API_KEY ? "" : ` ${link}`;
  return { sent: `Link sent to ${email}.${devLink}` };
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
  if (formData && intentSlug) {
    const company = await getCompanyBySlug(intentSlug);
    if (company) {
      const read = readClaimDraft(company, formData);
      if ("draft" in read) await stashDraft(serializeDraft(read.draft));
    }
  }

  const nonce = newStateToken();
  const store = await cookies();
  store.set("wuw_oauth", nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  // The state is checked on the way back, so it must be unguessable and it
  // must be the thing that carries the intent — not a query parameter the
  // caller could edit.
  const state = `${nonce}:${intentSlug}`;
  redirect(googleAuthUrl(state));
}

export async function signOut(): Promise<void> {
  await endSession();
  revalidatePath("/", "layout");
  redirect(routes.home());
}
