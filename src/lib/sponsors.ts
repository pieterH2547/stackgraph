import { CATEGORIES } from "./brand";
import { tryNormalizeSiteUrl } from "./url";

/**
 * Sponsorship, kept deliberately apart from the graph.
 *
 * A sponsor buys one compact, labelled card. It buys nothing else: no edge,
 * no claim, no place in an ordering, no mention on another company's profile.
 * The data model has no foreign key into `companies` or `relationships` and
 * nothing in this module reads either table, so the separation is structural
 * rather than a matter of discipline. A test holds it to that.
 *
 * This file is the pure half — types, packages, validation and selection —
 * and is safe to import from a client component. The database and the
 * request-reading parts live in `db/sponsors.ts` and `sponsor-events.ts`.
 */

export type SponsorPackage = "SIDEBAR" | "CATEGORY";

/**
 * The rate card, in cents, shown in admin only. The public site never prints
 * a price: there is no checkout, and a number on a page is a promise about a
 * product that is still being tested.
 *
 * CATEGORY is sold as a package and stored as one, but the category-page
 * placement it implies is not built yet; today both packages render the same
 * sidebar card, with CATEGORY limited to the categories it names.
 */
export const SPONSOR_PACKAGES: Record<
  SponsorPackage,
  { label: string; monthlyPriceCents: number; currency: "EUR" }
> = {
  SIDEBAR: { label: "Sidebar sponsor", monthlyPriceCents: 2900, currency: "EUR" },
  CATEGORY: {
    label: "Category sponsor",
    monthlyPriceCents: 7900,
    currency: "EUR",
  },
};

export const SPONSOR_DESCRIPTION_MAX = 120;
export const SPONSOR_NAME_MAX = 60;
export const SPONSOR_URL_MAX = 2048;

export interface Sponsor {
  id: string;
  name: string;
  logoUrl: string | null;
  description: string;
  destinationUrl: string;
  package: SponsorPackage;
  monthlyPriceCents: number | null;
  currency: string;
  /** Category names this placement is limited to. Null means every profile. */
  categories: string[] | null;
  active: boolean;
  /** Inclusive calendar date, YYYY-MM-DD in UTC. Null means no bound. */
  startsOn: string | null;
  endsOn: string | null;
  contactEmail: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What the public card needs, and nothing it must not have. */
export interface SponsorCardData {
  id: string;
  name: string;
  logoUrl: string | null;
  description: string;
  destinationUrl: string;
}

export function toCardData(sponsor: Sponsor): SponsorCardData {
  return {
    id: sponsor.id,
    name: sponsor.name,
    logoUrl: sponsor.logoUrl,
    description: sponsor.description,
    destinationUrl: sponsor.destinationUrl,
  };
}

/* -------------------------------------------------------------------------- */
/* validation                                                                 */
/* -------------------------------------------------------------------------- */

export class SponsorValidationError extends Error {}

export interface SponsorInput {
  name: string;
  logoUrl: string | null;
  description: string;
  destinationUrl: string;
  package: SponsorPackage;
  monthlyPriceCents: number | null;
  categories: string[] | null;
  active: boolean;
  startsOn: string | null;
  endsOn: string | null;
  contactEmail: string | null;
  notes: string | null;
}

/** A sponsor's URL may point at a public website and nowhere else. */
export function validateDestinationUrl(input: string): string {
  const raw = input.trim();
  if (!raw) throw new SponsorValidationError("A destination URL is required.");
  if (raw.length > SPONSOR_URL_MAX) {
    throw new SponsorValidationError("That URL is too long.");
  }
  // Checked before parsing: the URL parser silently drops tabs and newlines,
  // which would let "https://exa\nmple.com" through as a different host than
  // the one a reviewer saw.
  if (/[\u0000-\u001f\u007f]/.test(raw)) {
    throw new SponsorValidationError(
      "That URL contains characters that don't belong in one.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new SponsorValidationError(
      "The destination must be a full URL, starting with https://.",
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new SponsorValidationError("Only http and https destinations work.");
  }
  if (parsed.username || parsed.password) {
    throw new SponsorValidationError("A destination URL cannot carry credentials.");
  }
  // Same test the company flow applies: a real public host, nothing local or
  // private, nothing that is only a word.
  if (!tryNormalizeSiteUrl(parsed.origin)) {
    throw new SponsorValidationError("That destination isn't a public website.");
  }

  return parsed.toString();
}

/** Logos are embedded on our pages, so they must be https and a public host. */
export function validateLogoUrl(input: string | null): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const url = validateDestinationUrl(raw);
  if (!url.startsWith("https://")) {
    throw new SponsorValidationError("A logo URL has to be https.");
  }
  return url;
}

function cleanText(value: string, max: number, what: string): string {
  // Control characters have no business in a card; a newline in a name is
  // either a paste accident or an attempt to draw something we didn't lay out.
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!text) throw new SponsorValidationError(`${what} is required.`);
  if (text.length > max) {
    throw new SponsorValidationError(`${what} can be at most ${max} characters.`);
  }
  return text;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function validateDateOnly(value: string | null, what: string): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  if (!DATE_ONLY.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    throw new SponsorValidationError(`${what} must be a calendar date.`);
  }
  return raw;
}

/**
 * Everything an admin can type, checked on the server before it is stored.
 * Throws `SponsorValidationError` with a sentence the form can show.
 */
export function validateSponsorInput(input: SponsorInput): SponsorInput {
  const name = cleanText(input.name, SPONSOR_NAME_MAX, "Name");
  const description = cleanText(
    input.description,
    SPONSOR_DESCRIPTION_MAX,
    "Description",
  );
  const destinationUrl = validateDestinationUrl(input.destinationUrl);
  const logoUrl = validateLogoUrl(input.logoUrl);

  if (!(input.package in SPONSOR_PACKAGES)) {
    throw new SponsorValidationError("Unknown package.");
  }

  const price = input.monthlyPriceCents;
  if (price !== null && (!Number.isInteger(price) || price < 0)) {
    throw new SponsorValidationError(
      "The monthly price must be an amount in euros, like 29 or 29.50.",
    );
  }

  const known = CATEGORIES as readonly string[];
  const categories =
    input.categories === null
      ? null
      : [...new Set(input.categories.filter((c) => known.includes(c)))];
  if (categories !== null && categories.length === 0) {
    throw new SponsorValidationError(
      "Pick at least one category, or leave all of them unticked for every profile.",
    );
  }

  const startsOn = validateDateOnly(input.startsOn, "Start date");
  const endsOn = validateDateOnly(input.endsOn, "End date");
  if (startsOn && endsOn && endsOn < startsOn) {
    throw new SponsorValidationError("The end date is before the start date.");
  }

  const contactEmail = (input.contactEmail ?? "").trim() || null;
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    throw new SponsorValidationError("That contact email doesn't look right.");
  }

  const notes = (input.notes ?? "").trim() || null;
  if (notes && notes.length > 2000) {
    throw new SponsorValidationError("Notes can be at most 2000 characters.");
  }

  return {
    name,
    description,
    destinationUrl,
    logoUrl,
    package: input.package,
    monthlyPriceCents: price,
    categories,
    active: input.active,
    startsOn,
    endsOn,
    contactEmail,
    notes,
  };
}

/* -------------------------------------------------------------------------- */
/* when a sponsor runs                                                        */
/* -------------------------------------------------------------------------- */

/** Today as a YYYY-MM-DD string in UTC, the unit the date fields use. */
export function dateOnly(now: Date | number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export type SponsorStatus = "LIVE" | "SCHEDULED" | "ENDED" | "INACTIVE";

/** The one line an admin needs: is this running, and if not, why not. */
export function sponsorStatus(
  sponsor: Pick<Sponsor, "active" | "startsOn" | "endsOn">,
  today: string = dateOnly(),
): SponsorStatus {
  if (!sponsor.active) return "INACTIVE";
  if (sponsor.endsOn && sponsor.endsOn < today) return "ENDED";
  if (sponsor.startsOn && sponsor.startsOn > today) return "SCHEDULED";
  return "LIVE";
}

export function isLive(
  sponsor: Pick<Sponsor, "active" | "startsOn" | "endsOn">,
  today: string = dateOnly(),
): boolean {
  return sponsorStatus(sponsor, today) === "LIVE";
}

/** True when this sponsor may appear on a profile in the given category. */
export function targets(
  sponsor: Pick<Sponsor, "categories">,
  category: string | null,
): boolean {
  if (sponsor.categories === null) return true;
  return category !== null && sponsor.categories.includes(category);
}

/**
 * Stable, cheap hash for rotation. Not for security — only so the same page
 * shows the same sponsor across reloads while different pages spread the
 * placements fairly.
 */
function rotationIndex(seed: string, modulo: number): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % modulo;
}

/**
 * Which live sponsor a profile shows.
 *
 * A sponsor that named this page's category beats one that runs everywhere,
 * because that is what the narrower package is for. Among equals the choice
 * rotates by the page, so two sponsors sharing a window each get roughly half
 * the profiles rather than one of them getting all of them.
 *
 * This is the only ordering decision sponsorship ever makes, and it orders
 * sponsors — never companies.
 */
export function pickSponsor<T extends Pick<Sponsor, "active" | "startsOn" | "endsOn" | "categories">>(
  sponsors: T[],
  context: { category: string | null; pageKey: string; today?: string },
): T | null {
  const today = context.today ?? dateOnly();
  const live = sponsors.filter(
    (s) => isLive(s, today) && targets(s, context.category),
  );
  if (live.length === 0) return null;

  const targeted = live.filter((s) => s.categories !== null);
  const pool = targeted.length > 0 ? targeted : live;
  return pool[rotationIndex(context.pageKey, pool.length)];
}
