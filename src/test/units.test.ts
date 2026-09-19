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
    // Grouped once the graph is big enough for the digits to run together.
    expect(padCount(999)).toBe("999");
    expect(padCount(3010)).toBe("3,010");
  });

  it("falls back to initials when a logo is missing", () => {
    expect(initials("Acme")).toBe("AC");
    expect(initials("Small Stack")).toBe("SS");
  });
});

/**
 * Copy is part of the model here, so the two statements the product makes
 * about itself are asserted rather than trusted: there is one phrasing for a
 * relationship, and the old two-sided claim language is gone from the source
 * that renders the pages.
 */
describe("the public story matches the model", () => {
  it("prices a claim at two independent tools and nothing else", async () => {
    const { REQUIRED_UPSTREAM, ...rest } = await import("@/lib/limits");
    expect(REQUIRED_UPSTREAM).toBe(2);
    expect(rest).not.toHaveProperty("REQUIRED_DOWNSTREAM");
    expect(rest).not.toHaveProperty("MAX_CUSTOMERS");
  });

  it("says the consequence of a credit in the brand copy", async () => {
    const { brand } = await import("@/lib/brand");
    expect(brand.stackPrompt).toBe("Add 2 tools you genuinely use.");
    expect(brand.stackPromptSupport).toContain("Used by");
    expect(brand.claimPrice).toContain("2 independent tools");
    expect(brand).not.toHaveProperty("customersPrompt");
    expect(brand).not.toHaveProperty("customersPromptSupport");
  });

  it("leaves no two-sided claim language in the rendered source", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    async function walk(dir: string): Promise<string[]> {
      const entries = await readdir(dir, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) files.push(...(await walk(path)));
        else if (/\.tsx?$/.test(entry.name) && !path.includes("/test/")) {
          files.push(path);
        }
      }
      return files;
    }

    const stale = [
      "Who do you power",
      "who you power",
      "two customers",
      "REQUIRED_DOWNSTREAM",
      "submitCustomers",
      "saveCustomers",
      "suggestUsedBy",
      "says you use their product",
      "uses its product",
      "half of what a claim costs",
      "unlock this half",
      "Both confirmed",
    ];

    const offenders: string[] = [];
    for (const file of await walk("src")) {
      const text = await readFile(file, "utf8");
      for (const phrase of stale) {
        if (text.includes(phrase)) offenders.push(`${file}: ${phrase}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("suggestions never add anything by themselves", () => {
  it("returns candidates and writes nothing", async () => {
    const { suggestPoweredBy } = await import("@/lib/signals");
    const { countRows } = await import("./helpers");

    // Site reading is disabled in tests, so this is the no-network path: it
    // still has to be a pure read that touches no table.
    const edgesBefore = await countRows("relationships");
    const companiesBefore = await countRows("companies");
    const suggestions = await suggestPoweredBy(
      "https://acme.dev",
      "acme.dev",
    );
    expect(Array.isArray(suggestions)).toBe(true);
    expect(await countRows("relationships")).toBe(edgesBefore);
    expect(await countRows("companies")).toBe(companiesBefore);
  });

  it("offers no used-by suggestion surface at all", async () => {
    const signals = await import("@/lib/signals");
    expect(signals).not.toHaveProperty("suggestUsedBy");
  });
});
