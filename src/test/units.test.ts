import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "./helpers";
import { claimDomainMatches, isValidEmail } from "@/lib/claims";
import { isDerivedName } from "@/lib/detect";
import { assessEligibility } from "@/lib/eligibility";
import { initials, padCount, timeAgo } from "@/lib/format";
import { slugify, uniqueSlug } from "@/lib/slug";
import { createCompany } from "@/lib/db/queries";
import { nameFromDomain, normalizeSiteUrl, tryNormalizeSiteUrl } from "@/lib/url";

describe("site URLs", () => {
  it("normalizes every spelling of the same company to one domain", () => {
    for (const input of [
      "tally.so",
      "https://tally.so",
      "https://www.tally.so/",
      "http://WWW.Tally.so/pricing#x",
    ]) {
      expect(normalizeSiteUrl(input).domain).toBe("tally.so");
      expect(normalizeSiteUrl(input).website).toBe("https://tally.so");
    }
  });

  it("keeps subdomains that are part of the identity", () => {
    expect(normalizeSiteUrl("app.example.com").domain).toBe("app.example.com");
  });

  it("refuses private, local and non-web addresses", () => {
    for (const input of [
      "localhost",
      "http://127.0.0.1:3000",
      "http://192.168.1.4",
      "ftp://files.example.com",
      "nonsense",
      "",
    ]) {
      expect(tryNormalizeSiteUrl(input)).toBeNull();
    }
  });

  it("guesses a readable name from a domain", () => {
    expect(nameFromDomain("tally.so")).toBe("Tally");
    expect(nameFromDomain("cal-dot.com")).toBe("Cal Dot");
  });
});

describe("slugs", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("makes clean, URL-safe slugs", () => {
    expect(slugify("Acme Inc.")).toBe("acme-inc");
    expect(slugify("Café Söftware")).toBe("cafe-software");
    expect(slugify("!!!")).toBe("company");
  });

  it("avoids collisions and reserved route names", async () => {
    const taken = new Set(["acme", "admin-hq"]);
    expect(await uniqueSlug("Acme", async (s) => taken.has(s))).toBe("acme-2");
    expect(await uniqueSlug("admin", async (s) => taken.has(s))).toBe(
      "admin-hq-2",
    );
  });

  it("gives two same-named companies different slugs", async () => {
    const first = await createCompany({
      name: "Acme",
      domain: "acme.dev",
      website: "https://acme.dev",
      source: "SEED",
    });
    const second = await createCompany({
      name: "Acme",
      domain: "acme.io",
      website: "https://acme.io",
      source: "SEED",
    });

    expect(first.slug).toBe("acme");
    expect(second.slug).toBe("acme-2");
  });
});

describe("detected names", () => {
  it("lets a vendor's own capitalisation win over a domain guess", () => {
    expect(isDerivedName("Posthog", "posthog.com")).toBe(true);
    expect(isDerivedName("posthog.com", "posthog.com")).toBe(true);
    expect(isDerivedName("Cal Dot", "cal-dot.com")).toBe(true);
  });

  it("never overwrites a name someone actually typed", () => {
    expect(isDerivedName("Tally Forms", "tally.so")).toBe(false);
    expect(isDerivedName("PostHog Analytics", "posthog.com")).toBe(false);
  });
});

describe("eligibility", () => {
  it("treats unknown domains as independent and incumbents as not", () => {
    expect(assessEligibility("some-tiny-tool.dev")).toEqual({
      networkEligible: true,
      eligibilityReason: "ASSUMED_INDEPENDENT",
    });
    expect(assessEligibility("stripe.com").eligibilityReason).toBe(
      "INCUMBENT_DENYLIST",
    );
  });

  it("catches incumbent subdomains too", () => {
    expect(assessEligibility("docs.stripe.com").networkEligible).toBe(false);
    expect(assessEligibility("www.slack.com").networkEligible).toBe(false);
  });
});

describe("claim verification", () => {
  it("accepts an address on the company's own domain", () => {
    expect(claimDomainMatches("marie@tally.so", "tally.so")).toBe(true);
    expect(claimDomainMatches("marie@mail.tally.so", "tally.so")).toBe(true);
  });

  it("does not treat free mail or a stranger's domain as proof", () => {
    expect(claimDomainMatches("marie@gmail.com", "tally.so")).toBe(false);
    expect(claimDomainMatches("someone@competitor.com", "tally.so")).toBe(false);
  });

  it("validates email shape", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("nope")).toBe(false);
  });
});

describe("formatting", () => {
  it("renders relative time the way the feed shows it", () => {
    const now = Date.parse("2026-01-01T12:00:00Z");
    const ago = (ms: number) => timeAgo(new Date(now - ms).toISOString(), now);

    expect(ago(5_000)).toBe("just now");
    expect(ago(12 * 60_000)).toBe("12 min ago");
    expect(ago(3 * 3600_000)).toBe("3h ago");
    expect(ago(4 * 86_400_000)).toBe("4d ago");
  });

  it("pads counts for the mono metadata style", () => {
    expect(padCount(4)).toBe("04");
    expect(padCount(14)).toBe("14");
  });

  it("falls back to initials when a logo is missing", () => {
    expect(initials("Acme")).toBe("AC");
    expect(initials("Small Stack")).toBe("SS");
  });
});
