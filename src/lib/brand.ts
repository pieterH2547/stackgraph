/**
 * Every user-facing brand string lives here, so the voice can be tuned (or the
 * product renamed) in one place instead of thirty.
 *
 * Voice: independent, dry, anti-bloat. Plain language with a point of view.
 *
 * Two rules learned the hard way:
 *
 * 1. "Independent software" is the *category*, never the brand. Naming the
 *    product after smallness tells people they are smaller than they think
 *    they are.
 * 2. The hero asks the product's question and hands you the field to answer
 *    it with. Not what we believe — that belongs in the manifesto — and no
 *    longer a pitch to claim either: claiming is one reader in a thousand,
 *    and "who uses this?" is why the other nine hundred came.
 */
export const brand = {
  /*
   * The name is the question the product answers, which is a better name than
   * a description of its data structure: nobody wants a graph, they want to
   * know who uses their software. "Stackgraph" named the mechanism; this names
   * the reason to visit.
   */
  name: "Who Uses What",
  wordmark: "WHO USES WHAT",
  domain: "whouseswhat.tech",

  /** The category this sits in. Not a slogan, not a name. */
  category: "the independent software graph",

  /* --- hero: what's in it for the visitor ------------------------------- */
  /*
   * The hero used to sell claiming, which is the second thing a visitor wants
   * and only if they happen to own a company. The first thing is the question
   * on the tin, and it is answerable in one field without an account — so the
   * headline is the question now, and the field is the hero.
   */
  heroHeadline: "Who uses what?",
  heroSubline:
    "See which software companies use which tools — and what runs on them.",
  searchPlaceholder: "Search a software company…",
  /** Dry qualifier under the hero search. */
  heroAside: "No rankings. No sales deck. Just who uses what.",
  /** Clickable examples under the field. Real lookups, not decoration. */
  searchExamples: ["Recruit CRM", "PostHog", "Tally", "Vercel", "Stripe"],

  /* --- calls to action -------------------------------------------------- */
  // "Add" was the wrong verb: adding a profile claims nothing, and half the
  // companies people look for already have one waiting.
  ctaPrimary: "Claim your company",
  ctaClaim: "Claim your profile",

  /** The two sides of every profile. */
  poweredBy: "Powered by",
  usedBy: "Used by",

  /* --- the graph -------------------------------------------------------- */
  graphHeading: "The independent software graph",
  graphSubline: "Watch it connect itself.",

  /* --- manifesto: where the belief lives ------------------------------- */
  manifesto: {
    heading: "We're not building another G2.",
    lines: [
      "No pay-to-play rankings.",
      "No 47-field vendor questionnaire.",
      "No analyst essays about your product.",
      "No enterprise logo theatre.",
      "No popularity contest.",
    ],
    closer: "We don't write your story. You show your network.",
    /** A manifesto line, deliberately not a headline. */
    signature: "Small software powers small software.",
  },

  noQuestionnaire:
    "No 47-field vendor questionnaire. No analyst essay. Just what you build and the tools you run on.",

  /** What the whole contribution costs, said in one line. */
  claimPrice: "One field to start · 2 independent tools · no vendor questionnaire",

  /* --- the claim ------------------------------------------------------- */
  stackPrompt: "Add 2 tools you genuinely use.",
  stackPromptSupport:
    "They’ll appear on your stack. Your company will appear in their “Used by”.",

  footerLine: "The independent software graph.",
  footerAside:
    "The enemy was never enterprise software. It's a discovery model that makes independent products invisible.",
} as const;

export const CATEGORIES = [
  "Analytics",
  "Automation",
  "Billing & payments",
  "CRM & sales",
  "Customer support",
  "Design",
  "Developer tools",
  "Email & messaging",
  "Forms & surveys",
  "Hiring & HR",
  "Hosting & infrastructure",
  "Marketing",
  "Productivity",
  "Scheduling",
  "Security",
  "Social proof",
  "Other",
] as const;

export type Category = (typeof CATEGORIES)[number];

/**
 * Sent to every vendor site we read. It points at a domain that resolves on
 * purpose: a site owner who checks their logs and looks us up should find
 * something, and four copies of this string in three files was one rename
 * away from pointing at nothing.
 */
export const BOT_USER_AGENT = `WhoUsesWhatBot/0.1 (+https://${brand.domain})`;
