import { brand } from "./brand";
export interface OutboundEmail {
  to: string;
  subject: string;
  text: string;
  /** Overrides `EMAIL_REPLY_TO` for this one message. */
  replyTo?: string;
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

function address(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.includes("@") ? trimmed : null;
}

/**
 * Where a reply to any mail we send should land: a person's inbox, so a
 * vendor who answers "Someone actually uses your software" reaches a human
 * without us running a mailbox on the sending domain. Unset means Resend
 * leaves Reply-To off and replies go to the From address.
 */
export function replyToAddress(env: EnvLike = process.env): string | null {
  return address(env.EMAIL_REPLY_TO);
}

/**
 * The one public address on the site (the advertise page). Configurable for
 * the same reason as Reply-To: the address that is read is not necessarily
 * on the domain that sends.
 */
export function contactAddress(env: EnvLike = process.env): string {
  return address(env.CONTACT_EMAIL) ?? brand.contactEmail;
}

/**
 * Who hears when a human decision is needed. Unset means nobody is mailed and
 * the decision waits in /admin, which is how it was before this existed.
 */
export function adminAddress(env: EnvLike = process.env): string | null {
  return address(env.ADMIN_NOTIFY_EMAIL);
}

/**
 * True when a sign-in or claim link may be shown on screen instead of mailed:
 * whenever nothing can deliver mail, in every environment.
 *
 * Until 2026-11-03 this was development only, and a production deployment
 * without a mail provider refused to hand out links at all, because a link on
 * screen signs in whoever typed the address and an address on the company's
 * own domain is approved as its owner on the spot. That is still true, and it
 * is the trade Pieter chose for the launch period: a claim that nobody can
 * finish is worse than a claim that is not yet proved, and the catalogue is
 * small enough to watch by hand. The rule ends on its own the moment
 * `RESEND_API_KEY` is set, because then the link goes by mail again and
 * nothing here needs changing back. Every on-screen link on a public
 * deployment is logged so the period leaves a trace.
 */
export function showsDevLinks(env: EnvLike = process.env): boolean {
  return emailTransport(env) === "outbox";
}

/**
 * Nothing can deliver mail and nothing may show a link either. Since links
 * are shown wherever mail is missing, this is never true at the moment; the
 * call sites keep asking so the refusal comes back with one line here when
 * the launch period ends.
 */
export function mailUnavailable(env: EnvLike = process.env): boolean {
  return emailTransport(env) === "outbox" && !showsDevLinks(env);
}

export const MAIL_UNAVAILABLE_MESSAGE =
  "Email isn't set up on this deployment yet, so no link can be sent. Try again later.";

/** What the page says above an on-screen link. Honest, and not a warning. */
export const LINK_ON_SCREEN_MESSAGE =
  "Email isn't switched on here yet, so here is your link instead:";

/** A link left the server other than by mail. In production that is news. */
export function noteLinkOnScreen(purpose: string, email: string): void {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    console.warn(
      `[whouseswhat] ${purpose} link shown on screen (no RESEND_API_KEY) for ${email}`,
    );
  }
}

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

  const replyTo = email.replyTo ?? replyToAddress();

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
        ...(replyTo ? { reply_to: replyTo } : {}),
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

/**
 * Tell the person who runs the site that something waits on them. Only for
 * decisions a human has to make — a claim from a free mailbox, an address on
 * the wrong domain — never for the routine case, because a mail for every
 * successful claim is the kind that gets filtered and takes the one that
 * matters with it.
 *
 * Best effort by design: the record is already in the database and visible
 * in /admin, so an undelivered reminder costs a reminder and nothing else.
 * Returns null when no address is configured.
 */
export async function notifyAdmin(input: {
  subject: string;
  text: string;
  /** The person the decision is about, so a reply from admin goes to them. */
  replyTo?: string;
}): Promise<SendResult | null> {
  const to = adminAddress();
  if (!to) return null;
  const result = await sendEmail({ to, ...input });
  if (result.transport === "resend" && !result.delivered) {
    console.error(`[whouseswhat] admin notification not sent: ${result.error}`);
  }
  return result;
}
