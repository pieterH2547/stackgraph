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
 * 2. The hero answers "what do I get", not "what do we believe". The belief
 *    belongs in the manifesto; the hero has to be a reason to claim.
 */
export const brand = {
  name: "Stackgraph",
  wordmark: "STACKGRAPH",
  domain: "stackgraph.dev",

  /** The category this sits in. Not a slogan, not a name. */
  category: "the independent software graph",

  /* --- hero: what's in it for the visitor ------------------------------- */
  heroHeadline: "Find out who uses your software.",
  heroSubline:
    "Stackgraph maps which independent software companies run on which. Claim your company to see who uses your product — and to credit the tools that power you.",
  /** Dry qualifier under the hero CTA. */
  heroAside: "No rankings. No sales deck. Just who uses what.",

  /* --- calls to action -------------------------------------------------- */
  // "Add" was the wrong verb: adding a profile claims nothing, and half the
  // companies people look for already have one waiting.
  ctaPrimary: "Claim your company",
  ctaClaim: "Claim your profile",
  ctaSeeWhoUsesYou: "See who uses you",

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
