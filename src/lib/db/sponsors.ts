import type { Row } from "@libsql/client";
import { getDb } from "./client";
import { newId, nowIso } from "../ids";
import type {
  Sponsor,
  SponsorInput,
  SponsorPackage,
} from "../sponsors";

/**
 * Sponsors and their events. This module never joins, reads or writes
 * `companies` or `relationships`: a sponsor is not a node, and the report it
 * feeds is about the card, not the graph.
 */

/* -------------------------------------------------------------------------- */
/* row mapping                                                                */
/* -------------------------------------------------------------------------- */

function str(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function optStr(value: unknown): string | null {
  return value === null || value === undefined ? null : str(value);
}

function optInt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseCategories(value: unknown): string[] | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const names = parsed.filter(
      (entry): entry is string => typeof entry === "string" && entry.length > 0,
    );
    return names.length > 0 ? names : null;
  } catch {
    return null;
  }
}

const SPONSOR_COLUMNS = `
  id, name, logo_url, description, destination_url, package,
  monthly_price_cents, currency, categories, active, starts_on, ends_on,
  contact_email, notes, created_at, updated_at
`;

export function mapSponsor(row: Row): Sponsor {
  return {
    id: str(row.id),
    name: str(row.name),
    logoUrl: optStr(row.logo_url),
    description: str(row.description),
    destinationUrl: str(row.destination_url),
    package: str(row.package) as SponsorPackage,
    monthlyPriceCents: optInt(row.monthly_price_cents),
    currency: str(row.currency || "EUR"),
    categories: parseCategories(row.categories),
    active: Number(row.active ?? 0) === 1,
    startsOn: optStr(row.starts_on),
    endsOn: optStr(row.ends_on),
    contactEmail: optStr(row.contact_email),
    notes: optStr(row.notes),
    createdAt: str(row.created_at),
    updatedAt: str(row.updated_at),
  };
}

/* -------------------------------------------------------------------------- */
/* reads                                                                      */
/* -------------------------------------------------------------------------- */

export async function getSponsorById(id: string): Promise<Sponsor | null> {
  const { rows } = await getDb().execute({
    sql: `SELECT ${SPONSOR_COLUMNS} FROM sponsors WHERE id = ? LIMIT 1`,
    args: [id],
  });
  return rows[0] ? mapSponsor(rows[0]) : null;
}

export async function listSponsors(): Promise<Sponsor[]> {
  const { rows } = await getDb().execute(
    `SELECT ${SPONSOR_COLUMNS} FROM sponsors
     ORDER BY active DESC, COALESCE(starts_on, '') DESC, created_at DESC`,
  );
  return rows.map(mapSponsor);
}

/**
 * Every sponsor switched on and inside its window today. The date test is a
 * string comparison on YYYY-MM-DD, which sorts correctly by construction.
 * This is the one query a public page runs, and it is tiny: the table holds
 * a handful of rows, and the index covers the WHERE.
 */
export async function listLiveSponsors(today: string): Promise<Sponsor[]> {
  const { rows } = await getDb().execute({
    sql: `SELECT ${SPONSOR_COLUMNS} FROM sponsors
          WHERE active = 1
            AND (starts_on IS NULL OR starts_on <= ?)
            AND (ends_on IS NULL OR ends_on >= ?)
          ORDER BY created_at ASC`,
    args: [today, today],
  });
  return rows.map(mapSponsor);
}

/* -------------------------------------------------------------------------- */
/* writes                                                                     */
/* -------------------------------------------------------------------------- */

function toArgs(input: SponsorInput) {
  return [
    input.name,
    input.logoUrl,
    input.description,
    input.destinationUrl,
    input.package,
    input.monthlyPriceCents,
    "EUR",
    input.categories ? JSON.stringify(input.categories) : null,
    input.active ? 1 : 0,
    input.startsOn,
    input.endsOn,
    input.contactEmail,
    input.notes,
  ];
}

/** Callers validate first (`validateSponsorInput`); this only stores. */
export async function createSponsor(input: SponsorInput): Promise<Sponsor> {
  const id = newId();
  const now = nowIso();
  await getDb().execute({
    sql: `INSERT INTO sponsors (
            id, name, logo_url, description, destination_url, package,
            monthly_price_cents, currency, categories, active, starts_on,
            ends_on, contact_email, notes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, ...toArgs(input), now, now],
  });
  const sponsor = await getSponsorById(id);
  if (!sponsor) throw new Error("Sponsor insert did not persist");
  return sponsor;
}

export async function updateSponsor(
  id: string,
  input: SponsorInput,
): Promise<Sponsor | null> {
  await getDb().execute({
    sql: `UPDATE sponsors SET
            name = ?, logo_url = ?, description = ?, destination_url = ?,
            package = ?, monthly_price_cents = ?, currency = ?, categories = ?,
            active = ?, starts_on = ?, ends_on = ?, contact_email = ?,
            notes = ?, updated_at = ?
          WHERE id = ?`,
    args: [...toArgs(input), nowIso(), id],
  });
  return getSponsorById(id);
}

/** Events go with it (ON DELETE CASCADE); the report for it is gone too. */
export async function deleteSponsor(id: string): Promise<void> {
  const db = getDb();
  await db.execute({ sql: `DELETE FROM sponsor_events WHERE sponsor_id = ?`, args: [id] });
  await db.execute({ sql: `DELETE FROM sponsors WHERE id = ?`, args: [id] });
}

/* -------------------------------------------------------------------------- */
/* events                                                                     */
/* -------------------------------------------------------------------------- */

export type SponsorEventKind = "IMPRESSION" | "CLICK";

/**
 * How many events this browser (as far as the daily key can tell) already
 * produced for this sponsor and kind today. The key itself rotates daily, so
 * "today" is implied by the match.
 */
export async function countEventsForVisitor(
  sponsorId: string,
  kind: SponsorEventKind,
  visitorKey: string,
): Promise<number> {
  const { rows } = await getDb().execute({
    sql: `SELECT COUNT(*) AS n FROM sponsor_events
          WHERE sponsor_id = ? AND kind = ? AND visitor_key = ?`,
    args: [sponsorId, kind, visitorKey],
  });
  return Number(rows[0]?.n ?? 0);
}

export async function insertSponsorEvent(event: {
  sponsorId: string;
  kind: SponsorEventKind;
  page: string | null;
  visitorKey: string | null;
  isBot: boolean;
  isRepeat: boolean;
}): Promise<void> {
  await getDb().execute({
    sql: `INSERT INTO sponsor_events
            (id, sponsor_id, kind, page, visitor_key, is_bot, is_repeat, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      newId(),
      event.sponsorId,
      event.kind,
      event.page,
      event.visitorKey,
      event.isBot ? 1 : 0,
      event.isRepeat ? 1 : 0,
      nowIso(),
    ],
  });
}

/* -------------------------------------------------------------------------- */
/* the report                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Raw is every beacon that reached the server. Filtered drops anything a
 * known crawler sent and any repeat from the same browser on the same day,
 * so it approximates people rather than requests. CTR is quoted on the
 * filtered numbers; a click rate built on bot impressions is a number about
 * bots.
 */
export interface SponsorStats {
  sponsorId: string;
  impressionsRaw: number;
  impressions: number;
  clicksRaw: number;
  clicks: number;
  /** Filtered clicks over filtered impressions. 0 when there were none. */
  ctr: number;
  ctrRaw: number;
}

function mapStats(row: Row): SponsorStats {
  const impressionsRaw = Number(row.impressions_raw ?? 0);
  const impressions = Number(row.impressions ?? 0);
  const clicksRaw = Number(row.clicks_raw ?? 0);
  const clicks = Number(row.clicks ?? 0);
  return {
    sponsorId: str(row.sponsor_id),
    impressionsRaw,
    impressions,
    clicksRaw,
    clicks,
    ctr: impressions === 0 ? 0 : clicks / impressions,
    ctrRaw: impressionsRaw === 0 ? 0 : clicksRaw / impressionsRaw,
  };
}

const STATS_COLUMNS = `
  sponsor_id,
  SUM(CASE WHEN kind = 'IMPRESSION' THEN 1 ELSE 0 END) AS impressions_raw,
  SUM(CASE WHEN kind = 'IMPRESSION' AND is_bot = 0 AND is_repeat = 0 THEN 1 ELSE 0 END) AS impressions,
  SUM(CASE WHEN kind = 'CLICK' THEN 1 ELSE 0 END) AS clicks_raw,
  SUM(CASE WHEN kind = 'CLICK' AND is_bot = 0 AND is_repeat = 0 THEN 1 ELSE 0 END) AS clicks
`;

export function emptyStats(sponsorId: string): SponsorStats {
  return {
    sponsorId,
    impressionsRaw: 0,
    impressions: 0,
    clicksRaw: 0,
    clicks: 0,
    ctr: 0,
    ctrRaw: 0,
  };
}

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Totals per sponsor: all time, or the last `days` days. */
export async function getSponsorStats(
  options: { days?: number } = {},
): Promise<Map<string, SponsorStats>> {
  const since = options.days === undefined ? null : sinceIso(options.days);
  const { rows } = await getDb().execute({
    sql: `SELECT ${STATS_COLUMNS} FROM sponsor_events
          ${since ? "WHERE created_at >= ?" : ""}
          GROUP BY sponsor_id`,
    args: since ? [since] : [],
  });
  return new Map(rows.map((row) => [str(row.sponsor_id), mapStats(row)]));
}

export interface SponsorDailyStats extends SponsorStats {
  /** YYYY-MM-DD, UTC. */
  day: string;
}

/** One sponsor, one row per day, newest first. */
export async function getSponsorDailyStats(
  sponsorId: string,
  days = 30,
): Promise<SponsorDailyStats[]> {
  const since = sinceIso(days).slice(0, 10);
  const { rows } = await getDb().execute({
    sql: `SELECT substr(created_at, 1, 10) AS day, ${STATS_COLUMNS}
          FROM sponsor_events
          WHERE sponsor_id = ? AND created_at >= ?
          GROUP BY day
          ORDER BY day DESC`,
    args: [sponsorId, since],
  });
  return rows.map((row) => ({ ...mapStats(row), day: str(row.day) }));
}
