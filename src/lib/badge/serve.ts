import { createHash } from "node:crypto";
import type { Defer } from "../network";
import { getBadgeSubject, recordBadgeView, type BadgeSubject } from "./stats";
import { DEFAULT_BADGE_THEME, isBadgeTheme, renderBadge } from "./svg";

/**
 * `GET /badge/<slug>.svg`, as a function the route handler and the tests can
 * both call.
 *
 * A badge is fetched by every visitor of every site that embeds it, which is
 * the one place this product can be asked the same question thousands of
 * times a minute. So the answer is cached at three distances, and each layer
 * is allowed to be a little stale rather than exact:
 *
 *   browser   max-age=300                 five minutes
 *   CDN       s-maxage=3600 + s-w-r       an hour, served stale while refreshing
 *   origin    a 60-second memo per slug   so a burst costs one database read
 *
 * The count on the profile is live; the one on the badge follows within the
 * hour. A `304 Not Modified` is served when the browser already has this exact
 * image.
 */

/** Only what a slug can be (see slug.ts), with an optional `.svg`. */
const BADGE_FILE = /^([a-z0-9][a-z0-9-]{0,63}?)(\.svg)?$/;

export function parseBadgeFile(file: string): string | null {
  const match = BADGE_FILE.exec(file);
  return match ? match[1] : null;
}

export const BADGE_CACHE_CONTROL =
  "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";
/** Unknown slugs are cached briefly too, so a typo cannot be a database loop. */
const MISS_CACHE_CONTROL = "public, max-age=60, s-maxage=300";

const MEMO_TTL_MS = 60_000;
/** Misses are memoised too, so the memo is bounded against made-up slugs. */
const MEMO_MAX = 2_000;
const memo = new Map<string, { until: number; subject: BadgeSubject | null }>();

/** Tests and scripts only: the next request reads the database again. */
export function clearBadgeMemo(): void {
  memo.clear();
}

async function subjectFor(
  slug: string,
  now: number,
): Promise<BadgeSubject | null> {
  const hit = memo.get(slug);
  if (hit && hit.until > now) return hit.subject;

  const subject = await getBadgeSubject(slug);
  if (memo.size >= MEMO_MAX) {
    for (const [key, entry] of memo) if (entry.until <= now) memo.delete(key);
    if (memo.size >= MEMO_MAX) memo.clear();
  }
  memo.set(slug, { until: now + MEMO_TTL_MS, subject });
  return subject;
}

function etagFor(body: string): string {
  return `"${createHash("sha1").update(body).digest("base64url")}"`;
}

function miss(): Response {
  return new Response("No badge for that address.", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": MISS_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function serveBadge(
  file: string,
  request: Request,
  options: { defer?: Defer; now?: () => number } = {},
): Promise<Response> {
  const now = options.now ?? Date.now;
  const slug = parseBadgeFile(file);
  if (!slug) return miss();

  const subject = await subjectFor(slug, now());
  if (!subject) return miss();

  const url = new URL(request.url);
  const requested = url.searchParams.get("theme");
  const theme = isBadgeTheme(requested) ? requested : DEFAULT_BADGE_THEME;

  const { svg } = renderBadge({ name: subject.name, count: subject.count, theme });
  const etag = etagFor(svg);

  /*
   * A view is a request that reached us, with one exception: the owner
   * looking at their own badge on the page that hands it out. That preview
   * would otherwise be the most reliable source of views the badge has.
   */
  if (url.searchParams.get("preview") !== "1") {
    const companyId = subject.companyId;
    const record = () => recordBadgeView(companyId);
    if (options.defer) options.defer(record);
    else await record();
  }

  const headers: Record<string, string> = {
    "Cache-Control": BADGE_CACHE_CONTROL,
    ETag: etag,
    // The image is public by nature; a site that draws it onto a canvas or
    // fetches it from a script should not be refused.
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
    // Belt and braces for anyone opening the image URL directly: nothing in
    // this document may load, run or style anything beyond itself.
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  };

  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(svg, {
    status: 200,
    headers: { ...headers, "Content-Type": "image/svg+xml; charset=utf-8" },
  });
}
