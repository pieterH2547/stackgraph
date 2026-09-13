import { getDb } from "./db/client";
import { newId, nowIso } from "./ids";

/**
 * The funnel this MVP exists to measure. Nothing here is analytics for its own
 * sake — every name below is a step in "does one vendor cause another to join".
 */
export const EVENT_NAMES = [
  "website_submitted",
  "company_added",
  "vendor_mentioned",
  "claim_email_sent",
  "claim_clicked",
  "claim_started",
  "claim_verified",
  "stack_started",
  "first_tool_added",
  "relationship_created",
  "stack_completed",
  "claim_completed",
  "customers_named",
  "share_clicked",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export async function track(
  name: EventName,
  options: {
    companyId?: string | null;
    targetCompanyId?: string | null;
    props?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO events (id, name, company_id, target_company_id, props, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [
      newId(),
      name,
      options.companyId ?? null,
      options.targetCompanyId ?? null,
      options.props ? JSON.stringify(options.props) : null,
      nowIso(),
    ],
  });
}

export async function countEvents(): Promise<Record<EventName, number>> {
  const db = getDb();
  const result = await db.execute(
    `SELECT name, COUNT(*) AS n FROM events GROUP BY name`,
  );

  const counts = Object.fromEntries(
    EVENT_NAMES.map((name) => [name, 0]),
  ) as Record<EventName, number>;

  for (const row of result.rows) {
    const name = String(row.name) as EventName;
    if (name in counts) counts[name] = Number(row.n);
  }
  return counts;
}
