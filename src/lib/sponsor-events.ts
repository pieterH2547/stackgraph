import { createHmac, randomBytes } from "node:crypto";
import {
  countEventsForVisitor,
  getSponsorById,
  insertSponsorEvent,
  type SponsorEventKind,
} from "./db/sponsors";
import { dateOnly, isLive } from "./sponsors";

/**
 * Recording an impression or a click without recording a person.
 *
 * The site sets no analytics cookie and this adds none. What it keeps per
 * event is the sponsor, the kind, the page path and two flags decided here:
 * whether the user agent announced itself as a crawler, and whether the same
 * browser already produced this event for this sponsor today. The second
 * needs some notion of "same browser", and that is `visitorKey`: an HMAC of
 * the IP and user agent under a key that rotates every UTC day. The hash is
 * stored; the IP and user agent are not, and tomorrow's key cannot be
 * matched to today's.
 *
 * A visitor sending Global Privacy Control is not hashed at all. Their event
 * still counts once — there is no way to tell a repeat, so it is taken at
 * face value — and nothing about them is derived.
 */

/** Crawlers, previews, monitors and the HTTP libraries scripts are written in. */
const BOT_UA =
  /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|fetch|monitor|scan|curl\/|wget\/|python|java\/|go-http|node-fetch|axios|okhttp|facebookexternalhit|whatsapp|telegram|discord|embedly|quora link|pinterest|bitly|skype|vkshare|yahoo|baidu|yandex|duckduck|semrush|ahrefs|mj12|dotbot|petalbot|bytespider|gptbot|claudebot|anthropic|openai|perplexity|ccbot/i;

export function looksLikeBot(userAgent: string | null): boolean {
  if (!userAgent || userAgent.trim().length < 8) return true;
  return BOT_UA.test(userAgent);
}

type GlobalWithSalt = typeof globalThis & { __sponsorSalt?: string };

/**
 * The key material. `SPONSOR_SALT` when set, so every instance of the app
 * derives the same daily key and a repeat is recognised across them. Without
 * it, a random value per process: still private, but two serverless
 * instances will each count the same browser once.
 */
function secret(): string {
  if (process.env.SPONSOR_SALT) return process.env.SPONSOR_SALT;
  const g = globalThis as GlobalWithSalt;
  if (!g.__sponsorSalt) g.__sponsorSalt = randomBytes(32).toString("hex");
  return g.__sponsorSalt;
}

/** Opaque, daily-rotating, not reversible without the secret. */
export function visitorKey(
  ip: string | null,
  userAgent: string | null,
  today: string = dateOnly(),
): string {
  return createHmac("sha256", `${secret()}:${today}`)
    .update(`${ip ?? ""}\n${userAgent ?? ""}`)
    .digest("hex")
    .slice(0, 32);
}

/** The first address in the chain, as the platform forwards it. */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || null;
}

/** Global Privacy Control, and the older Do Not Track for good measure. */
export function asksNotToBeTracked(headers: Headers): boolean {
  return headers.get("sec-gpc") === "1" || headers.get("dnt") === "1";
}

/**
 * Past this many repeats from one key in a day, further ones are dropped
 * rather than stored: they would only tell the report what it already knows,
 * and a table that grows with every reload is a table someone will fill.
 */
export const MAX_REPEATS_STORED = 10;

/** Paths only. A query string could carry anything, and we show none of it. */
export function cleanPage(page: unknown): string | null {
  if (typeof page !== "string") return null;
  const path = page.trim().split(/[?#]/)[0];
  if (!path.startsWith("/") || path.length > 160) return null;
  return path;
}

export type RecordOutcome =
  | "RECORDED"
  | "RECORDED_REPEAT"
  | "DROPPED_UNKNOWN"
  | "DROPPED_NOT_LIVE"
  | "DROPPED_FLOOD";

export async function recordSponsorEvent(input: {
  sponsorId: string;
  kind: SponsorEventKind;
  page: string | null;
  ip: string | null;
  userAgent: string | null;
  /** Visitor asked not to be tracked: no key is derived. */
  untracked?: boolean;
  today?: string;
}): Promise<RecordOutcome> {
  const sponsor = await getSponsorById(input.sponsorId);
  if (!sponsor) return "DROPPED_UNKNOWN";

  // A beacon for a sponsor that is not on any page right now is not a view
  // of anything; it is either a stale tab or a script.
  const today = input.today ?? dateOnly();
  if (!isLive(sponsor, today)) return "DROPPED_NOT_LIVE";

  const isBot = looksLikeBot(input.userAgent);
  const key = input.untracked ? null : visitorKey(input.ip, input.userAgent, today);

  let isRepeat = false;
  if (key) {
    const seen = await countEventsForVisitor(sponsor.id, input.kind, key);
    if (seen >= MAX_REPEATS_STORED) return "DROPPED_FLOOD";
    isRepeat = seen > 0;
  }

  await insertSponsorEvent({
    sponsorId: sponsor.id,
    kind: input.kind,
    page: input.page,
    visitorKey: key,
    isBot,
    isRepeat,
  });
  return isRepeat ? "RECORDED_REPEAT" : "RECORDED";
}
