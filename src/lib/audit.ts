/**
 * Telling a test record from a company.
 *
 * Lives here rather than in the audit script so the patterns can be tested:
 * the only way this is useful is if it catches `Probe 1789743723689` and
 * leaves `Protest Analytics` alone, and that is a claim worth a test rather
 * than a regex nobody ever runs twice.
 *
 * Nothing here decides anything. It flags rows for a person to look at, and
 * the audit that uses it writes nothing.
 */

/**
 * Anchored or word-bounded on purpose. An unanchored /test/ would flag
 * "Contest", "Latest" and "Protest", and a list of false positives is how an
 * audit stops being read.
 *
 * The long-digit arm catches `Probe 1789743723689` — a millisecond timestamp
 * in a name is nobody's product.
 */
const PROBE_NAME =
  /(^|\s)(probe|catprobe|pandaprobe|beamprobe|map-?fix|smoke ?test|test ?record|dummy|placeholder|lorem ipsum|foo ?bar|asdf)(\s|$)|\b\d{10,}\b/i;

/**
 * Domains reserved for testing (RFC 2606 and RFC 6761), plus the prefixes a
 * throwaway row tends to carry.
 */
const PROBE_DOMAIN =
  /^(probe|catprobe|pandaprobe|beamprobe|test|testing|example|localhost|dummy|placeholder)[.-]|\.(test|example|invalid|localhost)$|(^|\.)example\.(com|org|net)$/i;

export type TestRecordSignal = "name" | "domain" | null;

/**
 * Which field, if either, reads as a test record. Returns the field rather
 * than a boolean so the audit can say what it saw.
 */
export function looksLikeTestRecord(
  name: string,
  domain: string,
): TestRecordSignal {
  if (PROBE_NAME.test(name ?? "")) return "name";
  if (PROBE_DOMAIN.test(domain ?? "")) return "domain";
  return null;
}

/**
 * Is there anything on this profile for a reader to read?
 *
 * The test behind both the sitemap filter and the profile's own `robots`
 * tag, so the two cannot disagree about which pages we are advertising.
 *
 * Deliberately generous. An imported profile carrying the vendor's own
 * one-line description is a real company somebody may well be searching
 * for, and being findable is the entire reason an unclaimed profile exists.
 * The only thing this excludes is a page with a name on it and nothing else.
 */
export function hasSomethingToRead(
  company: {
    description?: string | null;
    about?: string | null;
    whatItDoes?: string[] | null;
  },
  edgeCount: number,
): boolean {
  if (edgeCount > 0) return true;
  if ((company.description ?? "").trim() !== "") return true;
  if ((company.about ?? "").trim() !== "") return true;
  return (company.whatItDoes ?? []).length > 0;
}
