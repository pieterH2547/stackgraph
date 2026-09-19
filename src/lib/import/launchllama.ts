/**
 * Generation 0 selection.
 *
 * The point of this file is not to make the graph look big. It is to pick the
 * companies most likely to make the *next* company claim, because that is the
 * only thing the MVP is testing. So it is an ICP filter that throws most of a
 * directory away, and every number it produces is internal: no score, rank or
 * grade of ours ever reaches a public page.
 *
 * A directory export knows far less than it appears to. Team size, whether a
 * product is still alive and whether anyone is reachable are mostly absent
 * from it, so each criterion is allowed to be `unknown` and only positive
 * evidence scores. The honest consequence is that offline scoring alone leaves
 * most candidates short of the threshold — `--enrich` reads each site and is
 * what actually answers activity, contactability and stack richness.
 */

/** Positive evidence, negative evidence, or no idea. Never a guess. */
export type Signal = "yes" | "no" | "unknown";

export interface RawRecord {
  [key: string]: string | undefined;
}

export interface Candidate {
  name: string;
  website: string;
  domain: string;
  description: string;
  /** One of `CATEGORIES`, or "" when the source gave nothing recognisable. */
  category: string;
  /** Whatever the export called it, kept for review. */
  sourceCategory: string;
  /** An icon URL from the export, or "" when it gave nothing usable. */
  logoUrl: string;
  source: string;
}

export interface Signals {
  /** 1. A software product, rather than a service business or a marketplace. */
  software: Signal;
  /** 2. Small or independent, rather than something with a procurement team. */
  smallTeam: Signal;
  /** 3. Still alive. */
  active: Signal;
  /** 4. A clear B2B use case, rather than a consumer app or an AI wrapper. */
  b2bUseCase: Signal;
  /** 5. Reachable — the metric that decides whether a mention can convert. */
  contactable: Signal;
  /** 6. Likely to run on several other independent products. */
  stackRichness: Signal;
}

export interface Scored extends Candidate {
  signals: Signals;
  /** Directory upvotes. Ordering only — never rendered, never a ranking. */
  popularity: number;
  /** 0–6: how many criteria have positive evidence. */
  icpScore: number;
  /** How much of the rubric we could actually determine. */
  confidence: "high" | "medium" | "low";
  exclusionReason: string;
  importRecommended: boolean;
}

/** 4 of 6, as specified. Lives here so the scorer and importer agree. */
export const IMPORT_THRESHOLD = 4;

/* -------------------------------------------------------------------------- */
/* field mapping                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Directory exports disagree about every column name, so each field accepts
 * the spellings that actually turn up. First match wins.
 */
const FIELDS = {
  name: ["name", "title", "tool_name", "toolname", "product", "product_name", "company", "company_name"],
  website: ["website", "url", "link", "site", "website_url", "homepage", "domain", "product_url"],
  description: ["description", "tagline", "summary", "short_description", "pitch", "one_liner", "subtitle", "about", "excerpt"],
  category: ["category", "categories", "tags", "topics", "type", "industry", "niche", "tag"],
  logo: ["logo_url", "logo", "icon_url", "icon", "image_url", "image", "favicon", "thumbnail"],
  team: ["employees", "team_size", "company_size", "size", "headcount", "team"],
  date: ["launch_date", "launched_at", "founded", "created_at", "date", "published_at", "updated_at", "launch"],
  contact: ["email", "contact", "contact_email", "founder", "maker", "maker_name", "twitter", "x", "founder_twitter", "linkedin"],
  // Same fields, but only the ones that could be a route rather than a name.
  pricing: ["pricing", "price", "plan", "pricing_model", "business_model"],
} as const;

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
}

/** Every value in the record, keyed by a normalized column name. */
export function normalizeRecord(raw: RawRecord): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) out[normalizeKey(key)] = trimmed;
  }
  return out;
}

function pick(record: Record<string, string>, names: readonly string[]): string {
  for (const name of names) {
    const value = record[name];
    if (value) return value;
  }
  return "";
}

/**
 * What the keyword rules are allowed to read.
 *
 * Not every column: matching across the whole row let the directory's own tag
 * "Automation" make a maker of industrial rubber bellows look like software,
 * and a listing URL containing the word "products" count as commercial
 * evidence. Judgement reads what the company said about itself, plus the tags
 * — and the software cue reads the self-description alone, because a tag
 * someone else assigned is not a claim about the product.
 */
function judgeText(record: Record<string, string>, description: string): string {
  return [
    pick(record, FIELDS.name),
    description,
    pick(record, FIELDS.category),
  ]
    .join(" ")
    .toLowerCase();
}

function selfDescription(record: Record<string, string>, description: string): string {
  return [pick(record, FIELDS.name), description].join(" ").toLowerCase();
}

/**
 * The icon the export offers, if it is a URL at all.
 *
 * This is the one field here that reaches a page, so it is the one that has to
 * be checked rather than trusted: a relative path, a data URI or a stray word
 * would render as a broken image on a profile nobody has claimed yet, which is
 * worse than the monogram it would have shown instead.
 */
function logoFrom(record: Record<string, string>): string {
  const raw = pick(record, FIELDS.logo);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

/** Directory traction, used for ordering only and never shown to anyone. */
function popularityOf(record: Record<string, string>): number {
  const raw = pick(record, ["upvotes", "votes", "points", "score", "stars"]);
  const value = Number(raw.replace(/[^\d.-]/g, ""));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/* -------------------------------------------------------------------------- */
/* exclusions                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Reasons to drop a row outright, whatever it scores. Ordered: the first
 * match is the reason reported, so the most decisive go first.
 */
const EXCLUSIONS: { reason: string; patterns: RegExp }[] = [
  {
    reason: "agency or consultancy",
    patterns: /\b(agency|agencies|consultancy|consulting|consultants?|we build (your|apps)|done[- ]for[- ]you|dev shop|studio for hire|outsourc\w*|staffing firm|freelance services)\b/,
  },
  {
    reason: "service business, not software",
    patterns: /\b(coaching|mentorship program|training course|bootcamp|newsletter sponsorship|ghostwriting|virtual assistant service|bookkeeping service|accounting firm|law firm|recruitment agency)\b/,
  },
  {
    // A directory is a competitor with no stack of its own to report, and the
    // real export is full of them: "Free SaaS directory for founders".
    reason: "marketplace or directory without a software product",
    patterns: /\b(marketplace for|directory|directories|list of|curated list|job board|classifieds|aggregator of|browse \d+ |submit your (tool|startup|product)|launch platform|promote (your |their )?products?|community for)\b/,
  },
  {
    reason: "crypto or token project",
    patterns: /\b(crypto|web3|blockchain|token|nft|defi|dao|airdrop|onchain|on-chain|wallet for eth|solana|ethereum)\b/,
  },
  {
    reason: "consumer-only app",
    patterns: /\b(dating|meditation|horoscope|fitness tracker|recipe app|game for|mobile game|photo filters?|wallpapers?|personal finance app for you|habit tracker for yourself)\b/,
  },
  {
    reason: "open-source project with no commercial product",
    patterns: /\b(hobby project|side project for fun|weekend project|just for fun|unmaintained|archived|no longer maintained|deprecated)\b/,
  },
  {
    reason: "enterprise incumbent",
    patterns: /\b(fortune 500|enterprise-grade platform for global|nasdaq|publicly traded|ipo|\b\d{2},\d{3}\+ employees)\b/,
  },
  {
    reason: "generic AI wrapper with no stated use case",
    patterns: /^(ai (chat|assistant|tool|wrapper|gpt)|chatgpt (for|wrapper)|gpt-?\d? (wrapper|clone)|ai powered tool)\.?$/,
  },
];

/**
 * A product living on somebody else's free subdomain. Not a rule about
 * quality — plenty of good things start there — but a company that has not
 * registered a domain is usually a project rather than a business, and the
 * cohort is chosen to maximise the chance of a claim.
 */
const FREE_HOST =
  /\.(github\.io|gitlab\.io|vercel\.app|netlify\.app|pages\.dev|web\.app|firebaseapp\.com|herokuapp\.com|streamlit\.app|replit\.app|glitch\.me|notion\.site|carrd\.co|framer\.website|webflow\.io|wixsite\.com|substack\.com|gumroad\.com)$/i;

/**
 * A listing that links to a page rather than to a site.
 *
 * A company's identity here *is* its domain, and normalizing a URL to its
 * registrable domain throws the path away. So a directory row pointing at
 * `tally.so/r/MevyAE` — a form somebody built on Tally — became a profile
 * owning `tally.so`, and a search for Tally returned that form. The same shape
 * turned launch posts into companies: `anthropic.com/news/claude-opus-4-6`,
 * `figma.com/blog/...`, `blog.google/...`.
 *
 * The honest reading is that we do not know this company's domain. A row that
 * cannot name its own homepage is unusable for the same reason as one with no
 * domain of its own, and whoever owns the product can still claim it properly
 * later. A trailing slash, `/en`, `/home` and the like are not paths in this
 * sense: they are the homepage with decoration.
 */
const HOMEPAGE_PATH = /^\/(?:[a-z]{2}(?:-[a-z]{2})?|home|index(?:\.html?|\.php)?)?\/?$/i;

export function linksToAPage(rawWebsite: string): boolean {
  const input = rawWebsite.trim();
  if (!input) return false;
  try {
    const { pathname } = new URL(
      /^https?:\/\//i.test(input) ? input : `https://${input}`,
    );
    return !HOMEPAGE_PATH.test(pathname);
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* signals                                                                    */
/* -------------------------------------------------------------------------- */

const SOFTWARE_CUES =
  /\b(saas|software|app|platform|tool|api|dashboard|automation|integration|plugin|extension|self[- ]hosted|no[- ]code|web app|cloud)\b/;

const B2B_AUDIENCE =
  "teams?|companies|businesses|agencies|startups|founders|developers|devs|recruiters|marketers|designers|freelancers|agencies|saas|studios|operators|stores|shops";

/**
 * "for teams" is the rare phrasing; "for remote teams", "for small SaaS
 * companies", "for busy recruiters" are the normal ones, so up to three words
 * are allowed between "for" and the audience.
 */
const B2B_CUES = new RegExp(
  `\\b(b2b|for (?:\\w+ ){0,3}(?:${B2B_AUDIENCE})\\b|your (?:team|company|business)|workflows?|crm|onboarding|invoicing|payroll|applicant|pipeline|customers?|clients?)\\b`,
);

const SMALL_TEAM_CUES =
  /\b(indie|bootstrapp\w*|solo (founder|dev|maker)|one[- ]person|two[- ]person|micro[- ]saas|small team|founder[- ]led|self[- ]funded|side business|built by (me|two|a small))\b/;

const LARGE_TEAM_CUES =
  /\b(global leader|market leader|enterprise sales team|thousands of employees|offices in \d+|series [c-z]\b)\b/;

/**
 * Something you could actually follow: an email address, an @handle, or a URL.
 * A plain human name is not a contact route, however nice it is to have.
 */
function isContactRoute(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  return (
    /[^\s@]+@[^\s@]+\.[^\s@]+/.test(text) ||
    /(^|\s)@[A-Za-z0-9_]{2,}/.test(text) ||
    /https?:\/\//.test(text) ||
    /(twitter|x)\.com\/|linkedin\.com\//.test(text)
  );
}

/** e.g. "1-10", "2", "11–50 employees". Anything over 50 is a no. */
function teamFromSize(value: string): Signal {
  const numbers = value.match(/\d+/g);
  if (!numbers) return "unknown";
  const largest = Math.max(...numbers.map(Number));
  if (!Number.isFinite(largest) || largest === 0) return "unknown";
  return largest <= 50 ? "yes" : "no";
}

/** Recent enough to still be someone's active product. */
function activeFromDate(value: string, now: number): Signal {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "unknown";
  const months = (now - parsed) / (1000 * 60 * 60 * 24 * 30.44);
  if (months < 0) return "unknown";
  return months <= 24 ? "yes" : "no";
}

/** Signals an optional online pass can establish; offline they stay unknown. */
export interface EnrichedFacts {
  /** The site responded. */
  reachable?: boolean;
  /** A published contact route was found. */
  contactEmail?: string | null;
  /** Third-party hosts the pages load from. */
  detectedTools?: string[];
}

export function scoreRecord(
  raw: RawRecord,
  options: {
    source?: string;
    now?: number;
    enriched?: EnrichedFacts;
    /** Normalizes and validates the website. Injected to avoid a cycle. */
    normalizeSite: (input: string) => { domain: string; website: string } | null;
    /** Maps a free-text category onto one of ours. */
    mapCategory: (text: string) => string;
  },
): Scored {
  const record = normalizeRecord(raw);
  const now = options.now ?? Date.now();

  const rawName = pick(record, FIELDS.name);
  const rawWebsite = pick(record, FIELDS.website);
  const description = pick(record, FIELDS.description);
  const sourceCategory = pick(record, FIELDS.category);
  const site = rawWebsite ? options.normalizeSite(rawWebsite) : null;
  const text = judgeText(record, description);
  const own = selfDescription(record, description);

  const candidate: Candidate = {
    name: rawName || (site ? site.domain : ""),
    website: site?.website ?? "",
    domain: site?.domain ?? "",
    description,
    category: options.mapCategory(`${sourceCategory} ${description}`),
    sourceCategory,
    logoUrl: logoFrom(record),
    source: options.source ?? "launchllama",
  };

  /* --- hard exclusions ---------------------------------------------------- */
  let exclusionReason = "";
  if (!site) {
    exclusionReason = rawWebsite
      ? "unusable website address"
      : "no website in the source row";
  } else if (!description && !sourceCategory) {
    exclusionReason = "no description or category to judge";
  } else {
    for (const rule of EXCLUSIONS) {
      if (rule.patterns.test(text) || rule.patterns.test(description.toLowerCase())) {
        exclusionReason = rule.reason;
        break;
      }
    }
  }
  if (!exclusionReason && site && FREE_HOST.test(site.domain)) {
    exclusionReason = "no domain of its own";
  }
  if (!exclusionReason && site && linksToAPage(rawWebsite)) {
    exclusionReason = "links to a page, not a company site";
  }
  if (!exclusionReason && options.enriched?.reachable === false) {
    exclusionReason = "site did not respond";
  }

  /* --- the six criteria --------------------------------------------------- */
  const teamField = pick(record, FIELDS.team);
  const dateField = pick(record, FIELDS.date);
  const contactField = pick(record, FIELDS.contact);
  const enriched = options.enriched;

  const software: Signal = SOFTWARE_CUES.test(own) ? "yes" : "unknown";

  let smallTeam: Signal = teamField ? teamFromSize(teamField) : "unknown";
  if (smallTeam === "unknown" && SMALL_TEAM_CUES.test(text)) smallTeam = "yes";
  if (LARGE_TEAM_CUES.test(text)) smallTeam = "no";

  let active: Signal = dateField ? activeFromDate(dateField, now) : "unknown";
  if (enriched?.reachable === true && active !== "no") active = "yes";

  const b2bUseCase: Signal =
    B2B_CUES.test(own) && description.length >= 15 ? "yes" : "unknown";

  /*
   * A maker's *name* is not a way to reach them, and a directory export is
   * full of names. Counting those made 97% of a real 3,453-row directory look
   * contactable, which would have quietly inflated the one metric that decides
   * whether a mention can ever convert. Only something that could actually be
   * followed counts: an address, a handle, or a link.
   */
  let contactable: Signal = isContactRoute(contactField) ? "yes" : "unknown";
  if (enriched?.contactEmail) contactable = "yes";
  else if (enriched && enriched.contactEmail === null && contactable !== "yes") {
    contactable = "no";
  }

  let stackRichness: Signal = "unknown";
  if (enriched?.detectedTools) {
    stackRichness = enriched.detectedTools.length >= 2 ? "yes" : "no";
  } else if (/\b(integrat\w+|zapier|webhook|api|embed|works with)\b/.test(own)) {
    // Someone who integrates with other products tends to run on them too.
    stackRichness = "yes";
  }

  const signals: Signals = {
    software,
    smallTeam,
    active,
    b2bUseCase,
    contactable,
    stackRichness,
  };

  const values = Object.values(signals);
  const icpScore = values.filter((signal) => signal === "yes").length;
  // Only yes/no count as determined. Offline most rows land on "low", which
  // is the honest answer: an export cannot see whether a product is alive.
  // A site read settles activity, contactability and stack richness at once,
  // which is what moves a row up.
  const known = values.filter((signal) => signal !== "unknown").length;
  const confidence = known >= 4 ? "high" : known >= 2 ? "medium" : "low";

  return {
    ...candidate,
    signals,
    popularity: popularityOf(record),
    icpScore,
    confidence,
    exclusionReason,
    importRecommended: !exclusionReason && icpScore >= IMPORT_THRESHOLD,
  };
}

/* -------------------------------------------------------------------------- */
/* ordering                                                                   */
/* -------------------------------------------------------------------------- */

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 } as const;
const SIGNAL_RANK = { yes: 2, unknown: 1, no: 0 } as const;

/**
 * Score, then confidence, then contactability, then stack richness — the
 * specified order, which is also roughly "most likely to cause the next
 * claim" first.
 */
export function byImportPriority(a: Scored, b: Scored): number {
  return (
    b.icpScore - a.icpScore ||
    CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] ||
    SIGNAL_RANK[b.signals.contactable] - SIGNAL_RANK[a.signals.contactable] ||
    SIGNAL_RANK[b.signals.stackRichness] - SIGNAL_RANK[a.signals.stackRichness] ||
    // Traction in the directory they are already listed in. Alphabetical was
    // the previous tiebreak, which put a whole tier in name order.
    b.popularity - a.popularity ||
    a.domain.localeCompare(b.domain)
  );
}

/** One row per candidate, deduplicated by domain, best row kept. */
export function dedupeByDomain(rows: Scored[]): Scored[] {
  const best = new Map<string, Scored>();
  const noDomain: Scored[] = [];

  for (const row of rows) {
    if (!row.domain) {
      noDomain.push(row);
      continue;
    }
    const existing = best.get(row.domain);
    if (!existing || byImportPriority(row, existing) < 0) {
      best.set(row.domain, row);
    }
  }

  return [...best.values(), ...noDomain];
}

export interface ScoreSummary {
  total: number;
  excluded: number;
  buckets: Record<"0-3" | "4" | "5" | "6", number>;
  contactable: number;
  recommended: number;
  topCategories: { category: string; count: number }[];
}

export function summarize(rows: Scored[]): ScoreSummary {
  const buckets = { "0-3": 0, "4": 0, "5": 0, "6": 0 };
  const categories = new Map<string, number>();
  let excluded = 0;
  let contactable = 0;
  let recommended = 0;

  for (const row of rows) {
    if (row.exclusionReason) excluded++;
    if (row.signals.contactable === "yes") contactable++;
    if (row.importRecommended) recommended++;

    if (row.icpScore >= 6) buckets["6"]++;
    else if (row.icpScore === 5) buckets["5"]++;
    else if (row.icpScore === 4) buckets["4"]++;
    else buckets["0-3"]++;

    if (row.importRecommended) {
      const key = row.category || "(uncategorised)";
      categories.set(key, (categories.get(key) ?? 0) + 1);
    }
  }

  return {
    total: rows.length,
    excluded,
    buckets,
    contactable,
    recommended,
    topCategories: [...categories.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
  };
}
