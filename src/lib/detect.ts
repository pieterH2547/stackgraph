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
  /**
   * 50-100 words about the company, assembled out of its *own* copy: the meta
   * description plus the first substantive paragraphs of the page.
   *
   * Extracted, never written. We do not author prose about anyone's product,
   * and an About that came from an LLM would be exactly the analyst essay this
   * product exists in opposition to. Shown attributed to their own site.
   */
  about: string | null;
  /**
   * 2-4 short bullets, taken from the vendor's own feature list. Only kept
   * when the markup really is a list of capabilities — a nav menu, a pricing
   * table or a footer is not, and a bullet we are not sure about is worse than
   * no bullet at all.
   */
  whatItDoes: string[];
  /** `website` when the page was read, `domain` when only the URL was usable. */
  detectedFrom: "website" | "domain";
  detectedAt: string;
  note: string | null;
}

const TIMEOUT_MS = 6000;

/** The About budget. Under the floor we'd rather show nothing. */
const ABOUT_MIN_WORDS = 20;
const ABOUT_MAX_WORDS = 100;

/** Where a company describes itself in its own voice, by convention. */
const ABOUT_PAGES = [
  "/about",
  "/about-us",
  "/company",
  "/story",
  // One notch wider. These are self-description by construction too, and a
  // small product is far more likely to have a /features page than an
  // /about one — Tally has neither an /about nor a company story.
  "/features",
  "/product",
  "/how-it-works",
  "/why",
];

/**
 * Where a homepage stops describing the company and starts quoting customers.
 * Everything from here down is off limits as an About source.
 */
const SOCIAL_PROOF_CUE =
  /(testimonial|what our (customers|users)|loved by|trusted by|customer stories|case stud|reviews?|wall of love|don'?t just take our word)/i;

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

/** Everything that isn't prose: script, style, nav, header, footer, forms. */
function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripFurniture(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|header|footer|form|aside)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

function textOf(fragment: string): string {
  return clean(fragment.replace(/<[^>]*>/g, " ")) ?? "";
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Furniture that keeps turning up in real pages and must never end up in an
 * About: cookie banners, prices, calls to action, legal boilerplate.
 */
const NOT_PROSE =
  /(cookie|subscribe|privacy policy|terms of|all rights reserved|©|\$\d|€\d|£\d|per month|per user|\/mo\b|\/year\b|free trial|get started|sign up|log ?in|book a (demo|call)|contact us|learn more|read more|try it|start (your|for) )/i;

/**
 * A sentence that reads like a company describing itself.
 *
 * Three rules earned by looking at real output rather than by reasoning:
 * it must be a complete sentence (a page's own markup truncates constantly,
 * and a half sentence on a public profile is worse than no sentence); it must
 * not be quoted (a testimonial is a customer's words, and presenting those as
 * the company's own description is precisely the misattribution this product
 * exists to avoid); and it must not be a call to action.
 */
function looksLikeProse(text: string): boolean {
  if (words(text) < 6 || text.length > 320) return false;
  if (!/[a-z]/.test(text)) return false;
  // A complete sentence, as the vendor punctuated it.
  if (!/[.!?]$/.test(text)) return false;
  /*
   * Somebody else's words. Quote marks catch the obvious case, but real pages
   * style their testimonials instead of punctuating them, so first person
   * singular is the tell that survives: a company describing itself says
   * "we", a customer says "I".
   */
  if (/["“”«»]/.test(text)) return false;
  if (/(^|[\s—-])(I|I'm|I’m|I've|I’ve|my|My)[\s,'’]/.test(text)) return false;
  /*
   * A team bio — "Wilson is Senja's CTO. He's a Nigerian-based developer" —
   * is the company's own copy and perfectly true, and it is still not a
   * description of the company. Third person singular is the tell.
   */
  if (/\b(he|she|his|her|hers|him)\b/i.test(text)) return false;
  return !NOT_PROSE.test(text);
}

/**
 * The vendor's own description of itself.
 *
 * Sources, and only these two, both of which are self-description *by
 * construction*:
 *
 *   1. the meta/og description — the sentence they wrote about themselves on
 *      purpose;
 *   2. paragraphs from their own /about page.
 *
 * A marketing homepage is explicitly not a source, and that was learned the
 * hard way: assembling an About from homepage copy produced text that read
 * perfectly and was, a third of the time, a customer testimonial attributed
 * to the company. Quote marks catch some of those and first person singular
 * catches more, but a customer writing "Senja was a game changer for us" is
 * indistinguishable from the vendor by any rule worth having. On a product
 * whose whole claim is that vendors own facts and practitioners own their
 * experience, that is the one mistake not to make. An /about page cannot make
 * it.
 *
 * The cost is honest: without an /about page this lands under the 50-word
 * target, and the short version is what gets shown.
 */
export function buildAbout(
  html: string,
  description: string | null,
  name: string,
): string | null {
  const parts: string[] = [];
  const seen = new Set<string>();

  /**
   * An about page still has to be *about them*. A sales letter addressed to
   * the reader — "Buyers' inboxes are flooded with bad offers. You need to
   * stand out." — is the company's own copy and says nothing about the
   * company, so a sentence has to name them or speak as them.
   */
  const aboutThem = (text: string) => {
    const first = new RegExp(`\\b(we|our|us|${escapeForRegex(name)})\\b`, "i");
    return first.test(text);
  };

  const take = (raw: string) => {
    const text = raw.trim().replace(/\s+([.,;:!?])/g, "$1");
    const key = text.toLowerCase();
    if (!text || seen.has(key)) return;
    if (!looksLikeProse(text) || !aboutThem(text)) return;
    seen.add(key);
    parts.push(text);
  };

  /*
   * The meta description is the anchor: they wrote it about themselves on
   * purpose, so it is exempt from the "about them" rule — but it is often
   * "<what it is>. Get started for free.", and throwing the whole thing away
   * over the second half loses the best sentence on the site. Split it and
   * keep the halves that aren't a call to action.
   */
  if (description) {
    for (const raw of description.split(/(?<=[.!?])\s+/)) {
      const text = raw.trim();
      if (words(text) < 5 || /["“”]/.test(text) || NOT_PROSE.test(text)) continue;
      const sentence = /[.!?]$/.test(text) ? text : `${text}.`;
      const key = sentence.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(sentence);
    }
  }

  // `html` here is the about page when we have one, and nothing otherwise.
  const body = stripFurniture(html);
  for (const match of body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    if (words(parts.join(" ")) >= ABOUT_MAX_WORDS) break;
    take(textOf(match[1]));
  }

  let about = "";
  for (const part of parts) {
    const next = about ? `${about} ${part}` : part;
    if (words(next) > ABOUT_MAX_WORDS) break;
    about = next;
  }

  // Above the floor it is worth a paragraph of its own; below it, the profile
  // already shows the same thing as the one-liner.
  return words(about) >= ABOUT_MIN_WORDS ? about : null;
}

/** A list that is really a pricing table, judged by what surrounds it. */
const PRICING_CONTEXT = /(pricing|per month|per user|\/mo\b|\$\d|€\d|£\d|plan\b|tier\b|billed)/i;

/**
 * Short capability phrases from the vendor's own feature list.
 *
 * Strict on purpose: the bullets have to come from one `<ul>` with at least
 * three siblings (a real feature list, not two stray items), that list must
 * not sit in pricing context, and "Everything in Starter" style cross
 * references are dropped because they mean nothing outside the table they
 * came from. Fewer than two survivors and we show none.
 */
export function buildWhatItDoes(html: string): string[] {
  const body = stripFurniture(html);

  for (const list of body.matchAll(/<ul[^>]*>([\s\S]*?)<\/ul>/gi)) {
    const items = [...list[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
    if (items.length < 3) continue;

    /*
     * Only what comes *before* the list: a "Pricing" heading or a price sits
     * above it. Looking inside as well threw away good lists over a single
     * bullet that happened to say "pay-what-you-want pricing", and the
     * individual bullets are filtered on their own merits below anyway.
     */
    const at = list.index ?? 0;
    const above = body.slice(Math.max(0, at - 600), at);
    if (PRICING_CONTEXT.test(textOf(above))) continue;

    const bullets: string[] = [];
    const seen = new Set<string>();

    for (const item of items) {
      const inner = item[1];
      const text = textOf(inner);
      // A list item that is only a link is a menu entry.
      const linkText = textOf(
        (inner.match(/<a[^>]*>([\s\S]*?)<\/a>/i) ?? ["", ""])[1],
      );
      if (linkText && linkText.length >= text.length * 0.8) continue;

      const count = words(text);
      if (count < 3 || count > 14) continue;
      if (/^everything in\b/i.test(text)) continue;
      // An FAQ list is not a capability list.
      if (/\?\s*$/.test(text)) continue;
      if (NOT_PROSE.test(text)) continue;
      if (/["“”]/.test(text)) continue;

      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      bullets.push(text.replace(/[.;]$/, ""));
      if (bullets.length === 4) break;
    }

    if (bullets.length >= 2) return bullets;
  }

  return [];
}

/**
 * The part of a homepage above its social proof.
 *
 * The fallback for a product with no /about page, and the one place homepage
 * copy is allowed: a testimonial wall sits below the pitch, so cutting at the
 * first social-proof cue removes the section that caused the misattribution
 * while keeping the company's own opening. Everything still goes through the
 * same filters — no quotes, no first person singular, no he/she, no calls to
 * action, complete sentences, and it has to name them or speak as them.
 */
export function homepageAbove(html: string): string {
  const text = stripFurniture(html);
  const cue = text.search(SOCIAL_PROOF_CUE);
  if (cue === -1) return text;
  /*
   * Enough copy above the cue to be a pitch rather than a sliver. A page that
   * opens straight into a testimonial wall has nothing here worth taking, and
   * a hero plus subtitle is routinely only a couple of hundred characters —
   * the first guess at 400 threw those away.
   */
  return cue > 200 ? text.slice(0, cue) : "";
}

/**
 * Their /about page, if they have one. Tried in order and the first page that
 * answers with HTML wins; none of them existing is a perfectly normal outcome
 * for a small product.
 */
async function fetchAboutPage(website: string): Promise<string> {
  for (const path of ABOUT_PAGES) {
    try {
      const response = await fetch(new URL(path, website), {
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          "user-agent": "StackgraphBot/0.1 (+https://stackgraph.dev)",
          accept: "text/html,application/xhtml+xml",
        },
      });
      if (!response.ok) continue;
      if (!(response.headers.get("content-type") ?? "").includes("html")) {
        continue;
      }
      const html = (await response.text()).slice(0, 300_000);
      // A soft 404 tends to be the homepage again; require some prose.
      if (/<p[^>]*>/i.test(html)) return html;
    } catch {
      // Unreachable or slow: nothing to add, which is a fine answer.
    }
  }
  return "";
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
    about: null,
    whatItDoes: [],
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
    about: buildAbout(
      (await fetchAboutPage(website)) || homepageAbove(html),
      description,
      name,
    ),
    whatItDoes: buildWhatItDoes(html),
    detectedFrom: "website",
    detectedAt,
    note: null,
  };
}

export const CATEGORY_OPTIONS = CATEGORIES;
