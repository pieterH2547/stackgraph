/**
 * Companies are identified by their registrable domain. Two people typing
 * "tally.so", "https://tally.so/" and "https://www.tally.so/pricing" must land
 * on the same profile, or the graph fills up with duplicates.
 */

export interface NormalizedSite {
  /** Lowercased host without a leading `www.`, e.g. `tally.so`. */
  domain: string;
  /** Canonical origin used for links, e.g. `https://tally.so`. */
  website: string;
}

const PRIVATE_HOST =
  /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$)/i;

export class InvalidSiteUrlError extends Error {}

export function normalizeSiteUrl(input: string): NormalizedSite {
  const raw = (input ?? "").trim();
  if (!raw) throw new InvalidSiteUrlError("Enter a website address.");

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new InvalidSiteUrlError("That doesn't look like a website address.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidSiteUrlError("Only http and https addresses work here.");
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");

  if (!host.includes(".") || host.endsWith(".")) {
    throw new InvalidSiteUrlError("That doesn't look like a website address.");
  }
  if (PRIVATE_HOST.test(parsed.hostname) || PRIVATE_HOST.test(host)) {
    throw new InvalidSiteUrlError("That address isn't reachable publicly.");
  }
  if (!/^[a-z0-9.-]+$/.test(host)) {
    throw new InvalidSiteUrlError("That doesn't look like a website address.");
  }

  return { domain: host, website: `https://${host}` };
}

export function tryNormalizeSiteUrl(input: string): NormalizedSite | null {
  try {
    return normalizeSiteUrl(input);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* somebody else's platform, not this company's domain                        */
/* -------------------------------------------------------------------------- */

/**
 * A trailing slash, `/en`, `/home` and the like are not paths in any
 * meaningful sense: they are the homepage with decoration.
 *
 * Shared with the Generation 0 importer, which reached the same conclusion
 * first and for the same reason.
 */
const HOMEPAGE_PATH = /^\/(?:[a-z]{2}(?:-[a-z]{2})?|home|index(?:\.html?|\.php)?)?\/?$/i;

/** True when this path is the site's front door rather than a page on it. */
export function isHomepagePath(pathname: string): boolean {
  return HOMEPAGE_PATH.test(pathname);
}

/**
 * Hosts where the thing at a path belongs to a *customer* of that host, not to
 * the host and not to a company of its own.
 *
 * This is the lesson of `tally.so/r/MevyAE`. A directory row pointed at a form
 * somebody had built on Tally; normalising it to a registrable domain threw
 * the path away, and the result was a profile that owned `tally.so` — so every
 * later company crediting Tally credited that form instead, and a search for
 * Tally returned it. One row quietly took ownership of a vendor's identity.
 *
 * Only these hosts are listed, and only with a path. `tally.so` on its own is
 * Tally and must keep working: the whole point of the graph is that companies
 * can credit it. A deep link on a company's *own* domain
 * (`acme.dev/pricing`) is also fine — the domain is still theirs. It is the
 * combination, somebody else's platform plus a path, that proves we are not
 * looking at the company's own site.
 */
const HOSTED_PAGE_HOSTS = new Set([
  // forms, docs and pages people publish on a platform
  "tally.so",
  "typeform.com",
  "forms.gle",
  "docs.google.com",
  "forms.office.com",
  "airtable.com",
  "notion.so",
  "notion.site",
  "coda.io",
  "figma.com",
  "canva.com",
  // writing and audience platforms
  "substack.com",
  "medium.com",
  "ghost.io",
  "beehiiv.com",
  "wordpress.com",
  "blogger.com",
  // storefronts, funding and scheduling
  "gumroad.com",
  "lemonsqueezy.com",
  "patreon.com",
  "ko-fi.com",
  "buymeacoffee.com",
  "calendly.com",
  "lu.ma",
  "eventbrite.com",
  // code, packages and app stores
  "github.com",
  "gitlab.com",
  "npmjs.com",
  "pypi.org",
  "apps.apple.com",
  "play.google.com",
  "chromewebstore.google.com",
  "marketplace.visualstudio.com",
  // directories and social
  "producthunt.com",
  "linktr.ee",
  "linkedin.com",
  "x.com",
  "twitter.com",
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "reddit.com",
  "discord.com",
  "discord.gg",
  "t.me",
  "telegram.me",
]);

/**
 * Paths that belong to the platform itself rather than to one of its
 * customers. `tally.so/pricing` is Tally's own page and reads as Tally;
 * `tally.so/r/MevyAE` is a form somebody built there and does not.
 *
 * This is a heuristic, and the asymmetry is deliberate. Wrongly treating a
 * customer's page as a company hands that company a vendor's whole identity
 * and is only noticed months later. Wrongly refusing a marketing URL shows
 * the person a sentence telling them to paste the bare domain. So the list
 * stays short and obvious: if a path is not plainly the vendor's own site, we
 * would rather ask.
 */
const SITE_OWN_PATH =
  /^\/(?:pricing|plans|about|about-us|product|products|features|templates|solutions|use-cases|customers|enterprise|integrations|marketplace|apps|blog|news|changelog|roadmap|docs?|documentation|help|support|faq|contact|careers|jobs|press|partners|security|legal|terms|privacy|status|download|downloads|login|signin|sign-in|signup|sign-up|register|start|demo)(?:[/?#].*)?$/i;

export interface HostedPage {
  /** The platform the page lives on, e.g. `tally.so`. */
  host: string;
  /** The path that proves it is somebody's page rather than the site. */
  path: string;
}

/**
 * When this address is a page *on* a platform rather than a company's own
 * site, say which platform. Null means the address can be read as a domain.
 *
 * Deliberately conservative: an unparseable address, a bare host, or any host
 * not on the list above all return null and are left to `normalizeSiteUrl`.
 */
export function hostedPage(input: string): HostedPage | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;

  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!HOSTED_PAGE_HOSTS.has(host)) return null;
  if (HOMEPAGE_PATH.test(parsed.pathname)) return null;
  if (SITE_OWN_PATH.test(parsed.pathname)) return null;

  return { host, path: parsed.pathname };
}

/**
 * The message a person sees when they paste one. It names the platform and
 * asks for the thing we actually need, because "invalid URL" would be a lie —
 * the address is fine, it just isn't a company.
 */
export function hostedPageMessage(page: HostedPage, label?: string): string {
  const what = label ? `"${label}"` : "That address";
  return `${what} is a page on ${page.host}, not a company website. Use the product's own address — or ${page.host} itself, if you mean ${page.host}.`;
}

/**
 * A page on somebody else's platform is not a company. Throws the same error
 * type as an unusable address, so callers that already handle one handle both.
 */
export function normalizeCompanySiteUrl(input: string): NormalizedSite {
  const page = hostedPage(input);
  if (page) throw new InvalidSiteUrlError(hostedPageMessage(page));
  return normalizeSiteUrl(input);
}

/** `tally.so` -> `Tally`. A starting guess only; the user always confirms it. */
export function nameFromDomain(domain: string): string {
  const [label] = domain.split(".");
  if (!label) return domain;
  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * The prefix the app is served under, when it isn't at a domain root — for
 * example `/test1` while it lives behind a rewrite on someone else's domain.
 *
 * `<Link>` and the router prefix this automatically. Two things do not, and
 * both matter here: `fetch()` calls to our own API routes, and the absolute
 * URLs that go into emails, share links and metadata.
 */
export function basePath(): string {
  const raw = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  if (!raw || raw === "/") return "";
  const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeading.replace(/\/$/, "");
}

/** For `fetch()` from the browser to our own route handlers. */
export function withBasePath(path: string): string {
  return `${basePath()}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * True when this deployment must not be indexed at all — a staging copy, or a
 * test mount on somebody else's domain, where the host's own robots.txt is
 * what crawlers read and ours never gets seen.
 */
export function noIndex(): boolean {
  if (process.env.NEXT_PUBLIC_NOINDEX === "1") return true;
  /*
   * A preview deployment serves the whole site at a URL of its own while
   * emitting canonicals that point at production. Nothing there should be
   * crawled. Tested for an explicit non-production value rather than for the
   * absence of one, so a self-hosted deployment that sets no Vercel
   * variables at all is still indexable.
   */
  const env = process.env.VERCEL_ENV;
  return Boolean(env) && env !== "production";
}

/** Scheme and host only, without any base path. */
export function siteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/** The URL to put in an email, a share link or a canonical tag. */
export function absoluteUrl(path: string): string {
  return `${siteUrl()}${withBasePath(path)}`;
}
