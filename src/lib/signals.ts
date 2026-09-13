import { assessEligibility } from "./eligibility";
import { nameFromDomain } from "./url";

/**
 * Prefill for both halves of a claim. The point is to turn "type four things"
 * into "confirm, confirm, done" — cycle time is a headline metric, and typing
 * is where it goes.
 *
 * Everything here is a *suggestion* read from the vendor's own public site.
 * Nothing is ever written to the graph without a person clicking it.
 */
export interface Suggestion {
  name: string;
  domain: string;
  website: string;
  /** Why we think so. Shown, because a guess should say it's a guess. */
  reason: string;
  networkEligible: boolean;
}

const TIMEOUT_MS = 5000;

/** Hosts that say nothing about a company's stack. */
const NOISE = [
  "w3.org",
  "schema.org",
  "gstatic.com",
  "googleapis.com",
  "googletagmanager.com",
  "google-analytics.com",
  "doubleclick.net",
  "jsdelivr.net",
  "unpkg.com",
  "cloudflare.com",
  "cloudflareinsights.com",
  "jquery.com",
  "bootstrapcdn.com",
  "fontawesome.com",
  "youtube.com",
  "youtu.be",
  "vimeo.com",
  "x.com",
  "twitter.com",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "github.com",
  "producthunt.com",
  "wikipedia.org",
  "reddit.com",
  "tiktok.com",
  "bsky.app",
  "threads.net",
  "mastodon.social",
  "medium.com",
  "apple.com",
  "play.google.com",
  "t.me",
  "whatsapp.com",
];

/**
 * Asset CDNs that give away the product behind them. Without this, a Framer
 * site suggests "framerusercontent.com" instead of Framer.
 */
const ASSET_ALIASES: Record<string, string> = {
  "framerusercontent.com": "framer.com",
  "webflow.io": "webflow.com",
  "website-files.com": "webflow.com",
  "squarespace-cdn.com": "squarespace.com",
  "shopifycdn.com": "shopify.com",
  "wixstatic.com": "wix.com",
  "hs-scripts.com": "hubspot.com",
  "hsforms.net": "hubspot.com",
  "hsforms.com": "hubspot.com",
  "usemessages.com": "hubspot.com",
  "intercomcdn.com": "intercom.com",
  "typeform.net": "typeform.com",
  "crisp.help": "crisp.chat",
  "lemonsqueezy.com": "lemonsqueezy.com",
};

/** `widget.crisp.chat` -> `crisp.chat`. Good enough without a PSL. */
function registrable(host: string): string | null {
  const clean = host.toLowerCase().replace(/^www\./, "");
  if (!clean.includes(".") || /^[\d.]+$/.test(clean)) return null;

  const labels = clean.split(".");
  if (labels.length <= 2) return ASSET_ALIASES[clean] ?? clean;

  // Two-part suffixes we're likely to meet (co.uk, com.au, …).
  const suffix = labels.slice(-2).join(".");
  const twoPart = /^(co|com|org|net|gov|ac)\.[a-z]{2}$/.test(suffix);
  const domain = labels.slice(twoPart ? -3 : -2).join(".");
  return ASSET_ALIASES[domain] ?? domain;
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "user-agent": "SmallstackBot/0.1 (+https://smallstack.dev)",
        accept: "text/html",
      },
    });
    if (!response.ok) return null;
    if (!(response.headers.get("content-type") ?? "").includes("html")) {
      return null;
    }
    return (await response.text()).slice(0, 400_000);
  } catch {
    return null;
  }
}

function isUseful(domain: string, ownDomain: string): boolean {
  if (domain === ownDomain || domain.endsWith(`.${ownDomain}`)) return false;
  if (ownDomain.endsWith(`.${domain}`)) return false;
  return !NOISE.some((noise) => domain === noise || domain.endsWith(`.${noise}`));
}

function toSuggestion(
  domain: string,
  reason: string,
  name?: string,
): Suggestion {
  return {
    name: name?.trim() || nameFromDomain(domain),
    domain,
    website: `https://${domain}`,
    reason,
    networkEligible: assessEligibility(domain).networkEligible,
  };
}

/* -------------------------------------------------------------------------- */
/* what powers you                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Third-party hosts the page actually *loads* from: a form embed, an analytics
 * script, a chat widget, a stylesheet. The strongest signal there is that a
 * company uses a tool, because the tool is literally running on their site.
 *
 * Deliberately not plain links — a footer full of social icons says nothing
 * about anyone's stack.
 */
export async function suggestPoweredBy(
  website: string,
  ownDomain: string,
): Promise<Suggestion[]> {
  if (process.env.DISABLE_SITE_DETECTION === "1") return [];

  const html = await fetchHtml(website);
  if (!html) return [];

  const counts = new Map<string, number>();
  const assets =
    /<(?:script|iframe|img|source|embed)\b[^>]*\bsrc=["'](https?:\/\/[^"'\s>]+)["']|<link\b[^>]*\bhref=["'](https?:\/\/[^"'\s>]+)["']/gi;

  for (const match of html.matchAll(assets)) {
    let host: string;
    try {
      host = new URL(match[1] ?? match[2]).hostname;
    } catch {
      continue;
    }
    const domain = registrable(host);
    if (!domain || !isUseful(domain, ownDomain)) continue;
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([domain]) => toSuggestion(domain, `loaded by ${ownDomain}`));
}

/* -------------------------------------------------------------------------- */
/* who you power                                                              */
/* -------------------------------------------------------------------------- */

const CUSTOMER_PAGES = ["", "/customers", "/case-studies", "/about"];

const CUSTOMER_CUES =
  /(trusted by|used by|our customers|customers|case stud|testimonial|loved by|powering|join \d|clients)/gi;

/**
 * Company names and links sitting inside a "trusted by" or testimonial block.
 * Weaker than a script tag, which is exactly why these arrive as a question —
 * "we found these on your website, do they use your product?" — and never as a
 * fact.
 */
export async function suggestUsedBy(
  website: string,
  ownDomain: string,
): Promise<Suggestion[]> {
  if (process.env.DISABLE_SITE_DETECTION === "1") return [];

  const found = new Map<string, Suggestion>();

  // In parallel: four sequential fetches would be most of a minute of the
  // vendor's time, and cycle time is the metric this is here to protect.
  const pages = await Promise.all(
    CUSTOMER_PAGES.map((path) =>
      fetchHtml(path ? new URL(path, website).toString() : website),
    ),
  );

  for (const html of pages) {
    if (found.size >= 6) break;
    if (!html) continue;

    for (const cue of html.matchAll(CUSTOMER_CUES)) {
      const start = cue.index ?? 0;
      const window = html.slice(start, start + 2500);
      const label = cue[0].toLowerCase();

      for (const anchor of window.matchAll(
        /<a[^>]+href=["'](https?:\/\/[^"'\s>]+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi,
      )) {
        let host: string;
        try {
          host = new URL(anchor[1]).hostname;
        } catch {
          continue;
        }
        const domain = registrable(host);
        if (!domain || !isUseful(domain, ownDomain) || found.has(domain)) {
          continue;
        }

        const text = anchor[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        found.set(
          domain,
          toSuggestion(
            domain,
            `linked under "${label}" on ${ownDomain}`,
            text.length > 1 && text.length <= 40 ? text : undefined,
          ),
        );
        if (found.size >= 6) break;
      }
    }
  }

  return [...found.values()];
}
