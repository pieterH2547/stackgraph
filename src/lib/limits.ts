/** Shared by the server actions and the client editor, so neither imports the
 * other's world. */

/**
 * The claim price: both sides of the company.
 *
 *   What powers you?   2 independent tools
 *   Who do you power?  2 software companies
 *
 * Four edges per claim, and nobody named has to confirm anything for the claim
 * to complete — a claim that depended on other people would stall the network.
 * Only small/independent vendors count on the upstream side; anyone can list
 * Stripe.
 */
export const REQUIRED_UPSTREAM = 2;
export const REQUIRED_DOWNSTREAM = 2;

/** Per submission. Room for a couple of incumbents alongside the required two. */
export const MAX_TOOLS = 6;
export const MAX_CUSTOMERS = 4;
