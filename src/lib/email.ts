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

export function emailTransport(): EmailTransport {
  return process.env.RESEND_API_KEY ? "resend" : "outbox";
}

/** True when claim links may be shown on screen because nothing can deliver
 * them by mail. Keeps the loop walkable locally without faking a send. */
export function showsDevLinks(): boolean {
  return emailTransport() === "outbox";
}

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
