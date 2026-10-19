import { brand } from "../brand";
import {
  MAIL_FAILED_MESSAGE,
  MAIL_UNAVAILABLE_MESSAGE,
  mailUnavailable,
  sendEmail,
  showsDevLinks,
} from "../email";
import { track } from "../events";
import { absoluteUrl } from "../url";
import { createLoginToken } from "./store";

/**
 * Mint a sign-in link and mail it. One place, for every door that ends in an
 * inbox: signing in, claiming a profile, and adding a company.
 *
 * The order matters. A deployment that can neither mail the link nor show it
 * refuses before a token exists; a provider that refuses the send is reported
 * as a failure rather than as "sent"; and the link comes back for the screen
 * only where `showsDevLinks` says so, which is never in production.
 */
export async function mailLoginLink(input: {
  email: string;
  subject: string;
  /** The first line of the mail, before the link. */
  intro: string;
  intentCompanyId?: string | null;
  claimDraft?: string | null;
}): Promise<{ ok: true; devLink: string | null } | { ok: false; error: string }> {
  if (mailUnavailable()) return { ok: false, error: MAIL_UNAVAILABLE_MESSAGE };

  const token = await createLoginToken({
    email: input.email,
    intentCompanyId: input.intentCompanyId ?? null,
    claimDraft: input.claimDraft ?? null,
  });
  const link = absoluteUrl(`/auth/link?token=${token.token}`);

  const result = await sendEmail({
    to: input.email,
    subject: input.subject,
    text: [
      input.intro,
      "",
      link,
      "",
      "It works once and expires in 30 minutes. If you didn't ask for it, ignore this email — nothing happens until the link is opened.",
      "",
      `— ${brand.name}, ${brand.category}.`,
    ].join("\n"),
  });

  /*
   * The token stays valid, so a retry that does get through still works; it
   * simply was not delivered this time, and "Link sent" would leave the
   * person watching an inbox that stays empty.
   */
  if (result.transport === "resend" && !result.delivered) {
    console.error(`[whouseswhat] sign-in link not sent: ${result.error}`);
    return { ok: false, error: MAIL_FAILED_MESSAGE };
  }

  await track("claim_email_sent", {
    companyId: input.intentCompanyId ?? null,
    props: { kind: input.claimDraft ? "with-draft" : "plain" },
  });

  return { ok: true, devLink: showsDevLinks() ? link : null };
}
