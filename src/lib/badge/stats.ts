import { getDb } from "../db/client";
import { getCompanyBySlug } from "../db/queries";
import type { Company } from "../types";

/**
 * What the badge shows, and how often it was asked for.
 *
 * The count is the profile's `Used by`, with two things taken out that the
 * profile also leaves out of the public graph: an edge the credited vendor
 * disputed, and anything from the demo fixture. A badge sits on somebody
 * else's website under our name, so it is held to the strictest reading of
 * the data — never a number the site itself would not stand behind.
 */

export interface BadgeSubject {
  companyId: string;
  slug: string;
  name: string;
  count: number;
}

/**
 * Who gets a badge: a claimed, real company. Unclaimed profiles exist on
 * other people's word and nobody there can dispute an edge yet; demo rows are
 * invented. Both would put a number nobody vouches for on a third-party site.
 */
export function badgeAvailable(company: Company): boolean {
  return company.status === "CLAIMED" && !company.isDemo;
}

/** Incoming edges a reader can see on the profile, minus anything invented. */
export async function countBadgeUsedBy(companyId: string): Promise<number> {
  const { rows } = await getDb().execute({
    sql: `SELECT COUNT(*) AS n
          FROM relationships r
          JOIN companies source ON source.id = r.source_company_id
          WHERE r.target_company_id = ?
            AND r.state != 'DISPUTED'
            AND source.is_demo = 0`,
    args: [companyId],
  });
  return Number(rows[0]?.n ?? 0);
}

export async function getBadgeSubject(slug: string): Promise<BadgeSubject | null> {
  const company = await getCompanyBySlug(slug);
  if (!company || !badgeAvailable(company)) return null;
  return {
    companyId: company.id,
    slug: company.slug,
    name: company.name,
    count: await countBadgeUsedBy(company.id),
  };
}

/* -------------------------------------------------------------------------- */
/* measurement                                                                */
/* -------------------------------------------------------------------------- */

/** UTC day, the only granularity the counters have. */
export function badgeDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

async function bump(
  column: "views" | "clicks",
  companyId: string,
  day: string,
): Promise<void> {
  await getDb().execute({
    sql: `INSERT INTO badge_stats (company_id, day, views, clicks)
          VALUES (?, ?, ${column === "views" ? 1 : 0}, ${column === "clicks" ? 1 : 0})
          ON CONFLICT (company_id, day) DO UPDATE SET ${column} = ${column} + 1`,
    args: [companyId, day],
  });
}

/**
 * One badge request reached the origin. Browsers and the CDN are told to
 * cache the image for a while, so this undercounts by design: it is the
 * number of fresh loads, not the number of people who saw the badge, and the
 * page that shows it says so.
 */
export async function recordBadgeView(companyId: string, day = badgeDay()): Promise<void> {
  await bump("views", companyId, day);
}

/** Somebody arrived on the profile through the badge. */
export async function recordBadgeClick(companyId: string, day = badgeDay()): Promise<void> {
  await bump("clicks", companyId, day);
}

export interface BadgeStats {
  views: number;
  clicks: number;
  days: number;
}

export async function getBadgeStats(
  companyId: string,
  days = 30,
  now = new Date(),
): Promise<BadgeStats> {
  const since = badgeDay(new Date(now.getTime() - (days - 1) * 86_400_000));
  const { rows } = await getDb().execute({
    sql: `SELECT COALESCE(SUM(views), 0) AS views, COALESCE(SUM(clicks), 0) AS clicks
          FROM badge_stats WHERE company_id = ? AND day >= ?`,
    args: [companyId, since],
  });
  return {
    views: Number(rows[0]?.views ?? 0),
    clicks: Number(rows[0]?.clicks ?? 0),
    days,
  };
}
