import { CATEGORIES, type Category } from "./brand";
import { nameFromDomain, normalizeSiteUrl } from "./url";

/**
 * Reads a public website and extracts the few facts a profile needs. Anything
 * it cannot find stays empty — a blank field is honest, an invented one is not.
 */
export interface DetectedSite {
  domain: string;
  website: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  category: Category | null;
  socials: string[];
  /** A contact address the vendor publishes themselves, if there is one. */
  contactEmail: string | null;
  /** `website` when the page was read, `domain` when only the URL was usable. */
  detectedFrom: "website" | "domain";
  detectedAt: string;
  note: string | null;
}

const TIMEOUT_MS = 6000;

function decodeEntities(input: string): string {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–");
}

function clean(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = decodeEntities(value).replace(/\s+/g, " ").trim();
  return text.length ? text : null;
}

function metaContent(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      const value = clean(match[1]);
      if (value) return value;
    }
  }
  return null;
}

function meta(nameOrProperty: string): RegExp[] {
  const escaped = nameOrProperty.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`,
      "i",
    ),
  ];
}

/**
 * True when a name is just the domain dressed up — `posthog.com` typed into
 * the tool search becomes "Posthog", and the vendor's own "PostHog" should win.
 * A name a person actually typed ("Tally Forms") never gets overwritten.
 */
export function isDerivedName(name: string, domain: string): boolean {
  const normalized = name.trim().toLowerCase();
  const label = domain.split(".")[0] ?? domain;
  return (
    normalized === domain.toLowerCase() ||
    normalized === label.toLowerCase() ||
    normalized === label.replace(/[-_]/g, " ").toLowerCase()
  );
}

/** "Tally — Forms for free" -> "Tally". Titles carry taglines; names don't. */
function nameFromTitle(title: string): string {
  const [first] = title.split(/\s+[|·—–:]\s+|\s+-\s+/);
  const candidate = (first ?? title).trim();
  if (!candidate || candidate.length > 40) return title.trim().slice(0, 60);
  return candidate;
}

const CATEGORY_HINTS: [Category, RegExp][] = [
  ["Analytics", /\banalytic|dashboard|metrics|tracking|attribution\b/i],
  ["Forms & surveys", /\bform|survey|questionnaire|quiz\b/i],
  ["Email & messaging", /\bemail|newsletter|inbox|smtp|transactional\b/i],
  ["Customer support", /\bsupport|helpdesk|help desk|live chat|ticket\b/i],
  ["Billing & payments", /\bbilling|invoic|payment|subscription|checkout\b/i],
  ["Developer tools", /\bdeveloper|api|sdk|cli|code|deploy|debug\b/i],
  ["Hosting & infrastructure", /\bhosting|server|infrastructure|database\b/i],
  ["Design", /\bdesign|prototyp|illustration|figma|mockup\b/i],
  ["Social proof", /\btestimonial|review|social proof|case stud\b/i],
  ["Scheduling", /\bschedul|calendar|booking|appointment\b/i],
  ["Hiring & HR", /\bhiring|recruit|applicant|candidate|payroll|onboarding\b/i],
  ["CRM & sales", /\bcrm|pipeline|sales|lead|outreach|prospect\b/i],
  ["Marketing", /\bmarketing|seo|campaign|landing page|ads\b/i],
  ["Automation", /\bautomation|workflow|no-code|integrat\b/i],
  ["Security", /\bsecurity|auth|encryption|compliance|soc 2\b/i],
  ["Productivity", /\bnotes|tasks|to-do|productivity|docs\b/i],
];

function guessCategory(text: string): Category | null {
  for (const [category, pattern] of CATEGORY_HINTS) {
    if (pattern.test(text)) return category;
  }
  return null;
}

function absolutize(href: string | null, base: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, base);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function findLogo(html: string, base: string): string | null {
  const ogImage = metaContent(html, [
    ...meta("og:image:secure_url"),
    ...meta("og:image"),
    ...meta("twitter:image"),
  ]);

  const iconMatch =
    html.match(
      /<link[^>]+rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*href=["']([^"']+)["']/i,
    ) ??
    html.match(
      /<link[^>]+rel=["'][^"']*(?:shortcut )?icon[^"']*["'][^>]*href=["']([^"']+)["']/i,
    );

  return (
    absolutize(iconMatch?.[1] ?? null, base) ?? absolutize(ogImage, base) ?? null
  );
}

const SOCIAL_HOSTS =
  /https?:\/\/(?:www\.)?(x\.com|twitter\.com|linkedin\.com|github\.com)\/[^\s"'<>]+/gi;

function findSocials(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(SOCIAL_HOSTS)) {
    const url = match[0].replace(/[)"'.,]+$/, "");
    // Skip share/intent links — they are not the company's own profile.
    if (/\/(intent|share|sharer|shareArticle)/i.test(url)) continue;
    found.add(url);
    if (found.size >= 3) break;
  }
  return [...found];
}

/**
 * A `mailto:` the vendor put on their own site. Role addresses that clearly
 * aren't for being talked to are skipped, and so is anything off-domain: we
 * write to a published contact address or to nobody.
 */
function findContactEmail(html: string, domain: string): string | null {
  const skip =
    /^(noreply|no-reply|donotreply|abuse|postmaster|dmca|privacy|dpo|security|legal|careers|jobs)@/i;

  for (const match of html.matchAll(/mailto:([^"'?\s>]+)/gi)) {
    const email = decodeEntities(match[1]).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) continue;
    if (skip.test(email)) continue;

    const host = email.split("@")[1];
    if (host === domain || host.endsWith(`.${domain}`)) return email;
  }
  return null;
}

/** Pages a company is likely to publish a contact address on. */
const CONTACT_PATHS = ["/contact", "/contact-us", "/about"];

/**
 * Looks for a contact address the vendor publishes themselves, on the home
 * page first and then the obvious contact pages. Without one, a claim
 * invitation has nowhere to go and waits for a human in admin — we never guess
 * an address like `hello@domain`.
 */
export async function findPublishedContactEmail(
  website: string,
  domain: string,
  firstPageHtml?: string,
): Promise<string | null> {
  if (firstPageHtml) {
    const fromHome = findContactEmail(firstPageHtml, domain);
    if (fromHome) return fromHome;
  }

  for (const path of CONTACT_PATHS) {
    try {
      const response = await fetch(new URL(path, website), {
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "user-agent": "StackgraphBot/0.1 (+https://stackgraph.dev)",
          accept: "text/html",
        },
      });
      if (!response.ok) continue;
      if (!(response.headers.get("content-type") ?? "").includes("html")) continue;

      const found = findContactEmail(
        (await response.text()).slice(0, 200_000),
        domain,
      );
      if (found) return found;
    } catch {
      // Missing or unreachable contact page: nothing to do about it.
    }
  }
  return null;
}

export async function detectSite(input: string): Promise<DetectedSite> {
  const { domain, website } = normalizeSiteUrl(input);
  const detectedAt = new Date().toISOString();

  const fallback: DetectedSite = {
    domain,
    website,
    name: nameFromDomain(domain),
    description: null,
    logoUrl: null,
    category: null,
    socials: [],
    contactEmail: null,
    detectedFrom: "domain",
    detectedAt,
    note: null,
  };

  let html = "";
  try {
    const response = await fetch(website, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        // Identify ourselves honestly; we are reading a public page.
        "user-agent": "StackgraphBot/0.1 (+https://stackgraph.dev)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) {
      return { ...fallback, note: `The site answered ${response.status}.` };
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) {
      return { ...fallback, note: "That URL didn't return a web page." };
    }
    html = (await response.text()).slice(0, 400_000);
  } catch {
    return {
      ...fallback,
      note: "We couldn't reach that site, so there is nothing to prefill.",
    };
  }

  const head = html.slice(0, 200_000);
  const title = clean(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const siteName = metaContent(head, [
    ...meta("og:site_name"),
    ...meta("application-name"),
  ]);
  const description = metaContent(head, [
    ...meta("og:description"),
    ...meta("description"),
    ...meta("twitter:description"),
  ]);

  const name =
    siteName ??
    (title ? nameFromTitle(title) : null) ??
    nameFromDomain(domain);

  return {
    domain,
    website,
    name: name.slice(0, 60),
    description: description ? description.slice(0, 180) : null,
    logoUrl: findLogo(head, website),
    category: guessCategory(`${title ?? ""} ${description ?? ""}`),
    socials: findSocials(head),
    contactEmail: findContactEmail(html, domain),
    detectedFrom: "website",
    detectedAt,
    note: null,
  };
}

export const CATEGORY_OPTIONS = CATEGORIES;
