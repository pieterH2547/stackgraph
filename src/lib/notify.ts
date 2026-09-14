import { brand } from "./brand";
import { getDb } from "./db/client";
import { countIncoming, getCompanyById } from "./db/queries";
import { newId, nowIso } from "./ids";
import { sendEmail } from "./email";
import { track } from "./events";
import { absoluteUrl } from "./url";
import { routes } from "./routes";
import type { Company, MentionNotification, NotificationStatus } from "./types";

export const MENTION_COOLDOWN_DAYS = 7;

/**
 * One reason to write to a vendor, and it is recognition: somebody put their
 * product in their own stack. The strongest trigger there is, and the only one
 * left now that no vendor submits a customer list — every edge is a statement
 * by the company making it about the tools it runs on.
 *
 * The column stays, because the notifications table records what was sent.
 */
export type NotificationKind = "USES_YOU";

export type NotifyOutcome =
  | "SENT"
  | "QUEUED_NO_ADDRESS"
  | "SUPPRESSED_COOLDOWN"
  | "SKIPPED_ALREADY_CLAIMED"
  | "SKIPPED_NOT_ELIGIBLE"
  | "FAILED";

export interface NotifyResult {
  outcome: NotifyOutcome;
  mentionCount: number;
  subject?: string;
  body?: string;
}

/**
 * Recognition, not outreach: no directory framing, no backlinks, no SEO, no
 * "you have been listed". And no spam — the same vendor mentioned five times
 * in a week gets one email whose wording simply gets stronger.
 */
export function composeMentionEmail(input: {
  vendor: Company;
  mentionedBy: Company;
  mentionCount: number;
  claimUrl: string;
}): { subject: string; body: string } {
  const { vendor, mentionedBy, mentionCount, claimUrl } = input;

  const subject =
    mentionCount > 1
      ? `${mentionCount} software companies say they use ${vendor.name}`
      : "Someone actually uses your software";

  const opening =
    mentionCount > 1
      ? `${mentionCount} independent software companies now say ${vendor.name} helps power their company — ${mentionedBy.name} among them.`
      : `${mentionedBy.name} says ${vendor.name} helps power their company.`;

  return {
    subject,
    body: [
      opening,
      "",
      "Your profile is already waiting for you. Claim it to see who uses your product, and to credit the independent tools powering yours.",
      "",
      `See who uses you: ${claimUrl}`,
      "",
      `— ${brand.name}, ${brand.category}.`,
    ].join("\n"),
  };
}

async function lastNotificationAt(companyId: string): Promise<string | null> {
  const { rows } = await getDb().execute({
    sql: `SELECT created_at FROM notifications
          WHERE company_id = ? AND status = 'SENT'
          ORDER BY created_at DESC LIMIT 1`,
    args: [companyId],
  });
  return rows[0] ? String(rows[0].created_at) : null;
}

async function record(input: {
  companyId: string;
  kind: NotificationKind;
  toEmail: string | null;
  subject: string;
  body: string;
  mentionCount: number;
  status: NotificationStatus;
}): Promise<void> {
  await getDb().execute({
    sql: `INSERT INTO notifications
            (id, company_id, kind, to_email, subject, body, mention_count_at_send, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      newId(),
      input.companyId,
      input.kind,
      input.toEmail,
      input.subject,
      input.body,
      input.mentionCount,
      input.status,
      nowIso(),
    ],
  });
}

/**
 * Called every time an unclaimed vendor is named. Four guards decide whether
 * anything is sent:
 *
 * 1. already claimed      -> nothing to invite them to
 * 2. not network eligible -> big tools appear in the graph but are never chased
 * 3. cooldown             -> five mentions in a week is one email, not five
 * 4. no contact address   -> recorded as an opportunity, not invented
 *
 * Guard 4 is why contactability is a headline metric: an unreachable vendor
 * stays in the graph but cannot be counted on to cause acquisition.
 */
export async function notifyMention(input: {
  vendorId: string;
  mentionedById: string;
  kind?: NotificationKind;
  force?: boolean;
}): Promise<NotifyResult> {
  const kind = input.kind ?? "USES_YOU";
  const vendor = await getCompanyById(input.vendorId);
  const mentionedBy = await getCompanyById(input.mentionedById);
  if (!vendor || !mentionedBy) {
    return { outcome: "FAILED", mentionCount: 0 };
  }

  const mentionCount = await countIncoming(vendor.id);

  if (vendor.status === "CLAIMED") {
    return { outcome: "SKIPPED_ALREADY_CLAIMED", mentionCount };
  }
  if (!vendor.networkEligible) {
    return { outcome: "SKIPPED_NOT_ELIGIBLE", mentionCount };
  }

  const claimUrl = absoluteUrl(routes.claimFromEmail(vendor.slug));
  const { subject, body } = composeMentionEmail({
    vendor,
    mentionedBy,
    mentionCount,
    claimUrl,
  });

  if (!input.force) {
    const last = await lastNotificationAt(vendor.id);
    if (last) {
      const ageMs = Date.now() - new Date(last).getTime();
      if (ageMs < MENTION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000) {
        await record({
          companyId: vendor.id,
          kind,
          toEmail: vendor.contactEmail,
          subject,
          body,
          mentionCount,
          status: "SUPPRESSED_COOLDOWN",
        });
        return { outcome: "SUPPRESSED_COOLDOWN", mentionCount, subject, body };
      }
    }
  }

  if (!vendor.contactEmail) {
    await record({
      companyId: vendor.id,
      kind,
      toEmail: null,
      subject,
      body,
      mentionCount,
      status: "QUEUED_NO_ADDRESS",
    });
    return { outcome: "QUEUED_NO_ADDRESS", mentionCount, subject, body };
  }

  const result = await sendEmail({
    to: vendor.contactEmail,
    subject,
    text: body,
  });

  // The outbox transport still counts as sent: the invitation exists, is
  // recorded, and the cooldown must apply to it.
  const status: NotificationStatus =
    result.delivered || result.transport === "outbox" ? "SENT" : "FAILED";

  await record({
    companyId: vendor.id,
    kind,
    toEmail: vendor.contactEmail,
    subject,
    body,
    mentionCount,
    status,
  });

  if (status === "SENT") {
    await track("claim_email_sent", {
      companyId: vendor.id,
      targetCompanyId: mentionedBy.id,
      props: { mentionCount, kind, transport: result.transport },
    });
    return { outcome: "SENT", mentionCount, subject, body };
  }
  return { outcome: "FAILED", mentionCount, subject, body };
}

export async function listNotifications(
  companyId: string,
): Promise<MentionNotification[]> {
  const { rows } = await getDb().execute({
    sql: `SELECT id, company_id, kind, to_email, subject, body,
                 mention_count_at_send, status, created_at
          FROM notifications WHERE company_id = ? ORDER BY created_at DESC`,
    args: [companyId],
  });

  return rows.map((row) => ({
    id: String(row.id),
    companyId: String(row.company_id),
    kind: String(row.kind),
    toEmail: row.to_email === null ? null : String(row.to_email),
    subject: String(row.subject),
    body: String(row.body),
    mentionCountAtSend: Number(row.mention_count_at_send ?? 1),
    status: String(row.status) as NotificationStatus,
    createdAt: String(row.created_at),
  }));
}

export async function countSentNotifications(): Promise<number> {
  const { rows } = await getDb().execute(
    `SELECT COUNT(*) AS n FROM notifications WHERE status = 'SENT'`,
  );
  return Number(rows[0]?.n ?? 0);
}
