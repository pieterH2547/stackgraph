import { CATEGORIES } from "../brand";

/**
 * Free text from an export onto one of our categories. Deliberately blunt: a
 * wrong category on a thin profile is worse than none, so anything it can't
 * place stays empty and the founder picks when they claim.
 *
 * The first-wave categories the cohort is aimed at come first, so an ambiguous
 * row lands on the one we care about rather than on "Productivity".
 */
const RULES: { category: (typeof CATEGORIES)[number]; pattern: RegExp }[] = [
  { category: "Hiring & HR", pattern: /\b(hiring|recruit\w*|applicant|ats\b|candidate|interview|onboarding of employees|hr\b|people ops|payroll|talent|job post\w*)\b/ },
  { category: "Analytics", pattern: /\b(analytics|metrics|tracking|dashboards?|reporting|attribution|heatmaps?|session recording|bi\b|data viz\w*)\b/ },
  { category: "Forms & surveys", pattern: /\b(forms?|surveys?|quiz\w*|polls?|questionnaire|typeform|feedback collection)\b/ },
  { category: "Automation", pattern: /\b(automat\w+|workflows?|no[- ]code|zapier|integrations? platform|rpa\b|triggers?|webhooks?)\b/ },
  { category: "Customer support", pattern: /\b(support|helpdesk|help desk|ticketing|live chat|chatbot for customers|knowledge base|faq)\b/ },
  { category: "Marketing", pattern: /\b(marketing|seo\b|ads?\b|campaigns?|landing pages?|social media|content calendar|newsletter tool|growth)\b/ },
  // Not a bare "api": nearly every SaaS mentions having one, which made this
  // rule swallow billing, forms and hiring products alike.
  { category: "Developer tools", pattern: /\b(developer|devtool|sdk|ci\/cd|deploy\w*|monitoring|logging|code review|git\b|database tool|api (?:for developers|platform|gateway|management)|unit test\w*)\b/ },
  { category: "Scheduling", pattern: /\b(schedul\w+|calendar|booking|appointments?|meetings?|availability)\b/ },
  { category: "CRM & sales", pattern: /\b(crm\b|sales|pipeline|leads?|prospect\w*|outreach|deals?|quotes?|proposals?)\b/ },
  { category: "Social proof", pattern: /\b(testimonials?|reviews? widget|social proof|case stud\w+|ratings? widget|trust badges?)\b/ },
  { category: "Billing & payments", pattern: /\b(billing|invoic\w+|payments?|subscriptions?|checkout|revenue|accounting|tax\b)\b/ },
  { category: "Email & messaging", pattern: /\b(email|inbox|smtp|transactional mail|sms\b|messaging|push notifications?)\b/ },
  { category: "Design", pattern: /\b(design|mockups?|prototyp\w+|ui kit|icons?|illustrations?|figma|brand assets?)\b/ },
  { category: "Hosting & infrastructure", pattern: /\b(hosting|infrastructure|servers?|cdn\b|dns\b|containers?|serverless|storage|backups?)\b/ },
  { category: "Security", pattern: /\b(security|auth\w*|sso\b|2fa|encryption|compliance|soc 2|gdpr|pentest\w*|secrets? manage\w*)\b/ },
  { category: "Productivity", pattern: /\b(productivity|notes?|to[- ]?do|tasks?|projects? management|docs?|wiki|time tracking|focus)\b/ },
];

export function mapCategory(text: string): string {
  const haystack = text.toLowerCase();
  for (const rule of RULES) {
    if (rule.pattern.test(haystack)) return rule.category;
  }
  return "";
}
