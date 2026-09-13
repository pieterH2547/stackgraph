import type { EligibilityReason } from "./types";

/**
 * Big tools may appear in the graph. Small tools *are* the graph.
 *
 * `networkEligible` decides one thing only: whether mentioning this company
 * starts the vendor acquisition loop (unclaimed profile gets notified, claim
 * invited, next generation activated). Ineligible companies stay fully visible
 * as stack data — they just don't get chased.
 *
 * This is deliberately a denylist of obvious incumbents plus "assume
 * independent" for everything else, not an employee-count verification engine.
 * Admin can override any row.
 */
const INCUMBENT_DOMAINS = new Set([
  // payments & billing
  "stripe.com",
  "paypal.com",
  "adyen.com",
  "chargebee.com",
  "paddle.com",
  // cloud & hosting
  "aws.amazon.com",
  "amazon.com",
  "azure.microsoft.com",
  "microsoft.com",
  "cloud.google.com",
  "google.com",
  "vercel.com",
  "netlify.com",
  "cloudflare.com",
  "heroku.com",
  "digitalocean.com",
  "render.com",
  // ai
  "openai.com",
  "anthropic.com",
  "gemini.google.com",
  "huggingface.co",
  // dev platforms
  "github.com",
  "gitlab.com",
  "atlassian.com",
  "jira.com",
  "docker.com",
  "mongodb.com",
  "datadoghq.com",
  "sentry.io",
  "twilio.com",
  "sendgrid.com",
  // work & productivity suites
  "slack.com",
  "notion.so",
  "figma.com",
  "canva.com",
  "airtable.com",
  "asana.com",
  "monday.com",
  "clickup.com",
  "zoom.us",
  "dropbox.com",
  "box.com",
  "linear.app",
  "zapier.com",
  // sales, marketing, support at scale
  "salesforce.com",
  "hubspot.com",
  "zendesk.com",
  "intercom.com",
  "mailchimp.com",
  "klaviyo.com",
  "typeform.com",
  "calendly.com",
  "docusign.com",
  "segment.com",
  "amplitude.com",
  "mixpanel.com",
  "shopify.com",
  "squarespace.com",
  "wix.com",
  "webflow.com",
  // enterprise
  "oracle.com",
  "sap.com",
  "ibm.com",
  "adobe.com",
  "servicenow.com",
  "workday.com",
  "snowflake.com",
  "databricks.com",
  // consumer / social
  "apple.com",
  "meta.com",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "x.com",
  "twitter.com",
  "youtube.com",
  "discord.com",
  "reddit.com",
  "tiktok.com",
]);

export interface EligibilityVerdict {
  networkEligible: boolean;
  eligibilityReason: EligibilityReason;
}

export function assessEligibility(domain: string): EligibilityVerdict {
  const host = domain.toLowerCase().replace(/^www\./, "");
  const isIncumbent =
    INCUMBENT_DOMAINS.has(host) ||
    [...INCUMBENT_DOMAINS].some((d) => host.endsWith(`.${d}`));

  return isIncumbent
    ? { networkEligible: false, eligibilityReason: "INCUMBENT_DENYLIST" }
    : { networkEligible: true, eligibilityReason: "ASSUMED_INDEPENDENT" };
}

export function isKnownIncumbent(domain: string): boolean {
  return !assessEligibility(domain).networkEligible;
}

export const ELIGIBILITY_REASON_LABEL: Record<EligibilityReason, string> = {
  INCUMBENT_DENYLIST: "Large/incumbent tool — visible as stack data, not chased",
  ASSUMED_INDEPENDENT: "Assumed independent — part of the active network",
  ADMIN_OVERRIDE: "Set by hand in admin",
};
