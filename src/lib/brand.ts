/**
 * Every user-facing brand string lives here, so the voice can be tuned (or the
 * product renamed) in one place instead of thirty.
 *
 * Voice: independent, dry, anti-bloat. Plain language with a point of view.
 * Never: "accelerate growth", "unlock synergies", "all-in-one ecosystem",
 * "you have been listed in our directory".
 */
export const brand = {
  name: "Smallstack",
  wordmark: "SMALLSTACK",
  domain: "smallstack.dev",

  tagline: "Small software powers small software.",
  subline: "See what powers small software — and who it powers.",
  /** Dry qualifier under the hero CTA. */
  heroAside: "No rankings. No sales deck. Just who uses what.",

  ctaPrimary: "Add your company",
  ctaClaim: "Claim your profile",
  ctaSeeWhoUsesYou: "See who uses you",

  /** The two sides of every profile. */
  poweredBy: "Powered by",
  usedBy: "Used by",

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
  },

  /** The graph section, on the homepage. */
  graphHeading: "The independent software graph",
  graphSubline: "Watch small software connect itself.",

  noQuestionnaire:
    "No 47-field vendor questionnaire. No analyst essay. Just what you build, what powers you, and who you power.",

  stackPrompt: "Which independent tools help power your company?",
  stackPromptSupport:
    "Two you genuinely use. Half of what a claim costs, and half of the whole form.",
  customersPrompt: "Which software companies use your product?",
  customersPromptSupport:
    "Two of them. Shown as your word until they confirm it — and their confirmation is never needed for your claim.",

  /** The point of the whole thing, in one line, for footers and share cards. */
  footerLine: "Small software powers small software.",
  footerAside:
    "The enemy was never enterprise software. It's a discovery model that makes small useful products invisible.",
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
