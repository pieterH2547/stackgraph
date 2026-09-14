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

export interface SignInState {
  error?: string;
  sent?: string;
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

  if (!isValidEmail(email)) {
    return { error: "That doesn't look like an email address." };
  }

  const company = intent ? await getCompanyBySlug(intent) : null;
  const token = await createLoginToken({
    email,
    intentCompanyId: company?.id ?? null,
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
export async function startGoogleSignIn(intentSlug: string): Promise<void> {
  if (!googleConfigured()) {
    redirect(`${routes.signIn()}?error=google-unavailable`);
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
