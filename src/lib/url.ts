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

export function siteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}
