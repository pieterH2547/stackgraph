import { brand } from "./brand";
export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
}

export type EmailTransport = "resend" | "outbox";

export interface SendResult {
  delivered: boolean;
  transport: EmailTransport;
  error?: string;
}

/** `process.env`, or a stand-in for it in a test. */
export type EnvLike = Readonly<Record<string, string | undefined>>;

export function emailTransport(env: EnvLike = process.env): EmailTransport {
  return env.RESEND_API_KEY ? "resend" : "outbox";
}

/**
 * True when a sign-in or claim link may be shown on screen instead of mailed.
 *
 * Only in development, and only when nothing can deliver mail. On a public
 * deployment the answer is no whatever else is configured: a link on screen
 * signs in whoever typed the address, and an address on the company's own
 * domain is approved as its owner on the spot — so a production deployment
 * without a mail provider was handing every profile to anyone who asked. That
 * is a misconfiguration to surface, not to paper over.
 */
export function showsDevLinks(env: EnvLike = process.env): boolean {
  if (emailTransport(env) !== "outbox") return false;
  if (env.NODE_ENV === "production") return false;
  if (env.VERCEL) return false;
  return true;
}

/**
 * Nothing can deliver mail and nothing may show a link either. The only
 * honest answer to "email me a link" is then to say so.
 */
export function mailUnavailable(env: EnvLike = process.env): boolean {
  return emailTransport(env) === "outbox" && !showsDevLinks(env);
}

export const MAIL_UNAVAILABLE_MESSAGE =
  "Email isn't set up on this deployment yet, so no link can be sent. Try again later.";

export const MAIL_FAILED_MESSAGE =
  "The email couldn't be sent just now. Try again in a minute.";

export async function sendEmail(email: OutboundEmail): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    console.info(
      `[whouseswhat] email not sent (no RESEND_API_KEY). to=${email.to} subject="${email.subject}"\n${email.text}`,
    );
    return { delivered: false, transport: "outbox" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? `${brand.name} <hello@${brand.domain}>`,
        to: [email.to],
        subject: email.subject,
        text: email.text,
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      return {
        delivered: false,
        transport: "resend",
        error: `Resend answered ${response.status}`,
      };
    }
    return { delivered: true, transport: "resend" };
  } catch (error) {
    return {
      delivered: false,
      transport: "resend",
      error: error instanceof Error ? error.message : "unknown error",
    };
  }
}
