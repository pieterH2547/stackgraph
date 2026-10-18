import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "./helpers";
import { claimDomainMatches, isValidEmail } from "@/lib/claims";
import { looksLikeTestRecord } from "@/lib/audit";
import { isDerivedName } from "@/lib/detect";
import { assessEligibility } from "@/lib/eligibility";
import { initials, padCount, timeAgo } from "@/lib/format";
import { slugify, uniqueSlug } from "@/lib/slug";
import { createCompany } from "@/lib/db/queries";
import {
  hostedPage,
  hostedPageMessage,
  InvalidSiteUrlError,
  nameFromDomain,
  normalizeCompanySiteUrl,
  normalizeSiteUrl,
  tryNormalizeSiteUrl,
} from "@/lib/url";

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

/* -------------------------------------------------------------------------- */
/* pages on somebody else's platform                                          */
/* -------------------------------------------------------------------------- */

describe("a page on a platform is not a company", () => {
  it("refuses the exact shape that took over tally.so", () => {
    // A form somebody built on Tally. Normalising this to a registrable
    // domain is what gave one directory row ownership of Tally's identity.
    const page = hostedPage("https://tally.so/r/MevyAE");
    expect(page).not.toBeNull();
    expect(page!.host).toBe("tally.so");
    expect(() => normalizeCompanySiteUrl("https://tally.so/r/MevyAE")).toThrow(
      InvalidSiteUrlError,
    );
  });

  it("still lets Tally itself be Tally", () => {
    // The whole point of the graph is that companies can credit Tally. Only
    // the path is the problem, never the host on its own.
    for (const input of ["tally.so", "https://tally.so", "https://www.tally.so/"]) {
      expect(hostedPage(input)).toBeNull();
      expect(normalizeCompanySiteUrl(input).domain).toBe("tally.so");
    }
  });

  it("treats homepage decoration as the homepage", () => {
    for (const input of [
      "https://tally.so/",
      "https://tally.so/en",
      "https://tally.so/home",
      "https://tally.so/index.html",
    ]) {
      expect(hostedPage(input), input).toBeNull();
    }
  });

  it("reads the platform's own marketing pages as the platform", () => {
    // Somebody crediting Tally will paste whichever Tally page they had open,
    // and every one of these is still Tally talking about itself.
    for (const input of [
      "https://tally.so/pricing",
      "https://www.tally.so/pricing",
      "https://tally.so/templates",
      "https://tally.so/blog/some-post",
      "https://tally.so/help",
      "https://github.com/pricing",
    ]) {
      expect(hostedPage(input), input).toBeNull();
    }
    expect(normalizeCompanySiteUrl("https://www.tally.so/pricing").domain).toBe(
      "tally.so",
    );
  });

  it("covers the other platforms whose paths belong to their customers", () => {
    for (const input of [
      "https://github.com/someone/their-repo",
      "https://notion.so/Some-Page-abc123",
      "https://docs.google.com/forms/d/e/1FAIpQ/viewform",
      "https://apps.apple.com/us/app/something/id123",
      "https://producthunt.com/posts/something",
      "https://x.com/someone",
      "https://substack.com/@someone",
      "https://calendly.com/someone/30min",
    ]) {
      expect(hostedPage(input), input).not.toBeNull();
    }
  });

  it("leaves a deep link on a company's own domain alone", () => {
    // People paste these constantly and the domain really is theirs. Only
    // somebody else's platform plus a path proves this isn't their site.
    for (const input of [
      "https://acme.dev/pricing",
      "https://acme.dev/product/overview",
      "http://WWW.Tally.so/pricing#x",
    ]) {
      expect(hostedPage(input.replace(/tally\.so/i, "acme.dev")), input).toBeNull();
    }
    expect(normalizeCompanySiteUrl("https://acme.dev/pricing").domain).toBe(
      "acme.dev",
    );
  });

  it("says which platform it saw, so the message can be useful", () => {
    const page = hostedPage("https://tally.so/r/MevyAE")!;
    const message = hostedPageMessage(page, "DopamineLess");
    expect(message).toContain("DopamineLess");
    expect(message).toContain("tally.so");
  });

  it("never throws on rubbish: unparseable input stays the other guard's job", () => {
    for (const input of ["", "   ", "nonsense", "ftp://x"]) {
      expect(hostedPage(input), input).toBeNull();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* telling a test record from a company                                       */
/* -------------------------------------------------------------------------- */

describe("spotting a test record", () => {
  it("catches the shapes sitting in production", () => {
    expect(looksLikeTestRecord("Probe 1789743723689", "probe.example.com")).toBe(
      "name",
    );
    expect(looksLikeTestRecord("CatProbe SEO", "catprobe-seo.com")).toBe("name");
    expect(looksLikeTestRecord("PandaProbe Cloud", "pandaprobe.cloud")).toBe(
      "name",
    );
    expect(looksLikeTestRecord("Map Fix Probe", "mapfix.dev")).toBe("name");
    expect(looksLikeTestRecord("Something", "test-harness.dev")).toBe("domain");
    expect(looksLikeTestRecord("Something", "acme.example.com")).toBe("domain");
  });

  it("leaves real companies alone", () => {
    // An unanchored /test/ or /probe/ would flag every one of these, and an
    // audit full of false positives is an audit nobody reads twice.
    for (const [name, domain] of [
      ["Protest Analytics", "protestanalytics.com"],
      ["Contest App", "contestapp.com"],
      ["Latest", "latest.dev"],
      ["Testimonial Hero", "testimonialhero.com"],
      ["Probench", "probench.io"],
      ["Attest", "attest.com"],
      ["Greatest Hits", "greatesthits.fm"],
    ] as const) {
      expect(looksLikeTestRecord(name, domain), `${name} / ${domain}`).toBeNull();
    }
  });

  it("does not trip over a normal number in a name", () => {
    expect(looksLikeTestRecord("Nano Banana 2 Lite", "nanobanana2.com")).toBeNull();
    expect(looksLikeTestRecord("Krea 3", "krea.ai")).toBeNull();
    expect(looksLikeTestRecord("1Password", "1password.com")).toBeNull();
  });
});
