/** Shared by the server actions and the client editor, so neither imports the
 * other's world. */

/**
 * The claim price: identity, plus two independent tools you genuinely use.
 *
 * A company only ever reports facts about its own stack. One edge then does
 * both jobs:
 *
 *   the source company creates the relationship
 *   the target company receives the proof
 *
 * So `Acme uses Tally` puts Tally in Acme's `powered by` and Acme in Tally's
 * `used by`, from a single statement by the only party entitled to make it.
 * Nobody has to confirm anything — a claim that depended on other people would
 * stall the network — and no vendor ever submits its own customer list.
 *
 * Only network-eligible (small/independent) tools count towards the two.
 * Anyone can list Stripe, and it stays visible in the stack; it just isn't
 * what earns the claim.
 */
export const REQUIRED_UPSTREAM = 2;

/** Per submission. Room for a couple of incumbents alongside the required two. */
export const MAX_TOOLS = 6;

/**
 * The one-liner a company writes about itself. A cap, not a target: the field
 * is two rows high on purpose, because the profile's value is the graph around
 * it and not the prose on it.
 */
export const MAX_DESCRIPTION = 200;
