import { beforeEach, describe, expect, it } from "vitest";
import { countRows, joinedCompany, resetDatabase } from "./helpers";
import {
  createSponsor,
  getSponsorById,
  getSponsorDailyStats,
  getSponsorStats,
  listLiveSponsors,
  updateSponsor,
} from "@/lib/db/sponsors";
import {
  MAX_REPEATS_STORED,
  cleanPage,
  looksLikeBot,
  recordSponsorEvent,
  visitorKey,
} from "@/lib/sponsor-events";
import {
  SPONSOR_DESCRIPTION_MAX,
  SPONSOR_PACKAGES,
  SPONSOR_SLOTS_PER_PAGE,
  SponsorValidationError,
  pickSponsor,
  pickSponsors,
  sponsorStatus,
  toCardData,
  validateDestinationUrl,
  validateLogoUrl,
  validateSponsorInput,
  type SponsorInput,
} from "@/lib/sponsors";

const HUMAN_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function input(overrides: Partial<SponsorInput> = {}): SponsorInput {
  return {
    name: "Tally",
    logoUrl: "https://tally.so/logo.png",
    description: "Forms for independent software companies.",
    destinationUrl: "https://tally.so/?ref=whouseswhat",
    package: "SIDEBAR",
    monthlyPriceCents: 2900,
    categories: null,
    active: true,
    startsOn: null,
    endsOn: null,
    contactEmail: null,
    notes: null,
    ...overrides,
  };
}

beforeEach(async () => {
  await resetDatabase();
});

/* -------------------------------------------------------------------------- */
describe("a sponsor's URLs are checked against abuse", () => {
  it("accepts a public https destination and normalises it", () => {
    expect(validateDestinationUrl("https://tally.so/pricing")).toBe(
      "https://tally.so/pricing",
    );
    expect(validateDestinationUrl("  https://Tally.so  ")).toBe(
      "https://tally.so/",
    );
  });

  it("refuses anything that is not a public web address", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,hi",
      "ftp://files.example.com",
      "tally.so",
      "https://localhost:3000",
      "http://127.0.0.1",
      "http://192.168.1.4/admin",
      "https://user:secret@example.com/",
      "https://exa\nmple.com",
      `https://example.com/${"a".repeat(2100)}`,
      "",
    ]) {
      expect(() => validateDestinationUrl(bad), bad).toThrow(
        SponsorValidationError,
      );
    }
  });

  it("only embeds https logos, and treats a blank logo as none", () => {
    expect(validateLogoUrl("https://cdn.example.com/logo.svg")).toBe(
      "https://cdn.example.com/logo.svg",
    );
    expect(validateLogoUrl("")).toBeNull();
    expect(validateLogoUrl(null)).toBeNull();
    expect(() => validateLogoUrl("http://cdn.example.com/logo.svg")).toThrow(
      SponsorValidationError,
    );
  });
});

describe("what an admin can type", () => {
  it("keeps the description to one short line", () => {
    const long = "x".repeat(SPONSOR_DESCRIPTION_MAX + 1);
    expect(() => validateSponsorInput(input({ description: long }))).toThrow(
      /120 characters/,
    );
    expect(() => validateSponsorInput(input({ description: "  " }))).toThrow(
      /required/,
    );
    const ok = validateSponsorInput(
      input({ description: "  Forms\tfor\n small   teams. " }),
    );
    expect(ok.description).toBe("Forms for small teams.");
  });

  it("refuses an end date before the start date and non-dates", () => {
    expect(() =>
      validateSponsorInput(input({ startsOn: "2026-11-01", endsOn: "2026-10-01" })),
    ).toThrow(/before the start/);
    expect(() => validateSponsorInput(input({ startsOn: "soon" }))).toThrow(
      /calendar date/,
    );
    expect(() => validateSponsorInput(input({ startsOn: "2026-13-40" }))).toThrow(
      /calendar date/,
    );
  });

  it("keeps only known categories, and treats none as every profile", () => {
    const some = validateSponsorInput(
      input({ categories: ["Forms & surveys", "Not a category", "Forms & surveys"] }),
    );
    expect(some.categories).toEqual(["Forms & surveys"]);
    expect(validateSponsorInput(input({ categories: null })).categories).toBeNull();
    expect(() =>
      validateSponsorInput(input({ categories: ["Not a category"] })),
    ).toThrow(/at least one category/);
  });

  it("knows two packages and never prints a price on the public card", () => {
    expect(Object.keys(SPONSOR_PACKAGES)).toEqual(["SIDEBAR", "CATEGORY"]);
    expect(SPONSOR_PACKAGES.SIDEBAR.monthlyPriceCents).toBe(2900);
    expect(SPONSOR_PACKAGES.CATEGORY.monthlyPriceCents).toBe(7900);
    expect(() => validateSponsorInput(input({ monthlyPriceCents: 12.5 }))).toThrow(
      /euros/,
    );
    expect(() =>
      validateSponsorInput(input({ package: "BILLBOARD" as "SIDEBAR" })),
    ).toThrow(/package/i);
  });
});

/* -------------------------------------------------------------------------- */
describe("when a sponsor runs", () => {
  const today = "2026-10-18";

  it("is live only when switched on and inside an inclusive window", () => {
    expect(sponsorStatus({ active: false, startsOn: null, endsOn: null }, today)).toBe("INACTIVE");
    expect(sponsorStatus({ active: true, startsOn: null, endsOn: null }, today)).toBe("LIVE");
    expect(sponsorStatus({ active: true, startsOn: "2026-10-19", endsOn: null }, today)).toBe("SCHEDULED");
    expect(sponsorStatus({ active: true, startsOn: "2026-10-01", endsOn: "2026-10-17" }, today)).toBe("ENDED");
    // The end date is the last day it shows, not the first day it doesn't.
    expect(sponsorStatus({ active: true, startsOn: "2026-10-01", endsOn: "2026-10-18" }, today)).toBe("LIVE");
    expect(sponsorStatus({ active: true, startsOn: "2026-10-18", endsOn: "2026-10-18" }, today)).toBe("LIVE");
  });

  it("shows nothing when nothing is live, and never an inactive or expired one", () => {
    const sponsors = [
      { id: "off", active: false, startsOn: null, endsOn: null, categories: null },
      { id: "past", active: true, startsOn: null, endsOn: "2026-01-01", categories: null },
      { id: "future", active: true, startsOn: "2027-01-01", endsOn: null, categories: null },
    ];
    expect(
      pickSponsor(sponsors, { category: "Analytics", pageKey: "acme", today }),
    ).toBeNull();
  });

  it("prefers a sponsor that named the page's category over one that runs everywhere", () => {
    const everywhere = { id: "all", active: true, startsOn: null, endsOn: null, categories: null };
    const analytics = {
      id: "analytics",
      active: true,
      startsOn: null,
      endsOn: null,
      categories: ["Analytics"],
    };
    const sponsors = [everywhere, analytics];

    expect(pickSponsor(sponsors, { category: "Analytics", pageKey: "a", today })?.id).toBe("analytics");
    expect(pickSponsor(sponsors, { category: "Design", pageKey: "a", today })?.id).toBe("all");
    expect(pickSponsor(sponsors, { category: null, pageKey: "a", today })?.id).toBe("all");
    expect(pickSponsor([analytics], { category: null, pageKey: "a", today })).toBeNull();
  });

  it("rotates between equal sponsors by page, stably", () => {
    const sponsors = ["one", "two", "three"].map((id) => ({
      id,
      active: true,
      startsOn: null,
      endsOn: null,
      categories: null,
    }));
    const pages = Array.from({ length: 60 }, (_, i) => `company-${i}`);
    const chosen = pages.map(
      (pageKey) => pickSponsor(sponsors, { category: null, pageKey, today })?.id,
    );

    // Every sponsor gets some pages, and the same page gets the same sponsor.
    expect(new Set(chosen).size).toBe(3);
    expect(pickSponsor(sponsors, { category: null, pageKey: "company-7", today })?.id).toBe(chosen[7]);
  });

  it("fills the panel with targeted sponsors first, at most three, each once", () => {
    const live = (id: string, categories: string[] | null) => ({
      id,
      active: true,
      startsOn: null,
      endsOn: null,
      categories,
    });
    const sponsors = [
      live("all-1", null),
      live("all-2", null),
      live("all-3", null),
      live("analytics", ["Analytics"]),
      live("design", ["Design"]),
      { ...live("off", null), active: false },
    ];

    const panel = pickSponsors(sponsors, { category: "Analytics", pageKey: "acme", today });
    expect(panel).toHaveLength(SPONSOR_SLOTS_PER_PAGE);
    expect(panel[0].id).toBe("analytics");
    expect(new Set(panel.map((s) => s.id)).size).toBe(panel.length);
    expect(panel.map((s) => s.id)).not.toContain("design");
    expect(panel.map((s) => s.id)).not.toContain("off");

    // A page in no category gets only the run-everywhere sponsors.
    const plain = pickSponsors(sponsors, { category: null, pageKey: "acme", today });
    expect(plain.every((s) => s.categories === null)).toBe(true);

    // Across pages, every run-everywhere sponsor gets to lead.
    const leaders = new Set(
      Array.from({ length: 60 }, (_, i) =>
        pickSponsors(sponsors, { category: null, pageKey: `p-${i}`, today })[0].id,
      ),
    );
    expect(leaders).toEqual(new Set(["all-1", "all-2", "all-3"]));
  });

  it("reads only live rows from the database", async () => {
    await createSponsor(input({ name: "Live" }));
    await createSponsor(input({ name: "Off", active: false }));
    await createSponsor(input({ name: "Later", startsOn: "2099-01-01" }));
    await createSponsor(input({ name: "Over", endsOn: "2000-01-01" }));

    const live = await listLiveSponsors("2026-10-18");
    expect(live.map((s) => s.name)).toEqual(["Live"]);
  });

  it("hands the card only what the card shows", async () => {
    const sponsor = await createSponsor(
      input({ contactEmail: "cfo@tally.so", notes: "paid by invoice" }),
    );
    expect(Object.keys(toCardData(sponsor)).sort()).toEqual(
      ["description", "destinationUrl", "id", "logoUrl", "name"],
    );
  });
});

/* -------------------------------------------------------------------------- */
describe("counting impressions and clicks without counting people", () => {
  it("derives a daily key that stores neither the address nor the browser", () => {
    const key = visitorKey("203.0.113.9", HUMAN_UA, "2026-10-18");
    expect(key).toMatch(/^[a-f0-9]{32}$/);
    expect(key).not.toContain("203.0.113.9");
    expect(visitorKey("203.0.113.9", HUMAN_UA, "2026-10-18")).toBe(key);
    expect(visitorKey("203.0.113.9", HUMAN_UA, "2026-10-19")).not.toBe(key);
    expect(visitorKey("203.0.113.10", HUMAN_UA, "2026-10-18")).not.toBe(key);
  });

  it("recognises crawlers, fetchers and an absent user agent", () => {
    expect(looksLikeBot(HUMAN_UA)).toBe(false);
    expect(looksLikeBot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
    expect(looksLikeBot("curl/8.4.0")).toBe(true);
    expect(looksLikeBot("python-requests/2.31")).toBe(true);
    expect(looksLikeBot("Chrome Lighthouse")).toBe(true);
    expect(looksLikeBot(null)).toBe(true);
    expect(looksLikeBot("")).toBe(true);
  });

  it("keeps the page path and drops any query string", () => {
    expect(cleanPage("/c/tally")).toBe("/c/tally");
    expect(cleanPage("/c/tally?utm=x&email=a@b.co")).toBe("/c/tally");
    expect(cleanPage("https://evil.example/c/tally")).toBeNull();
    expect(cleanPage(42)).toBeNull();
    expect(cleanPage(`/${"x".repeat(200)}`)).toBeNull();
  });

  it("counts a first impression, flags the second from the same browser, and reports both", async () => {
    const sponsor = await createSponsor(input());
    const view = {
      sponsorId: sponsor.id,
      kind: "IMPRESSION" as const,
      page: "/c/acme",
      ip: "203.0.113.9",
      userAgent: HUMAN_UA,
      today: "2026-10-18",
    };

    expect(await recordSponsorEvent(view)).toBe("RECORDED");
    expect(await recordSponsorEvent(view)).toBe("RECORDED_REPEAT");
    expect(await recordSponsorEvent({ ...view, ip: "203.0.113.10" })).toBe("RECORDED");

    const stats = (await getSponsorStats()).get(sponsor.id);
    expect(stats?.impressionsRaw).toBe(3);
    expect(stats?.impressions).toBe(2);
  });

  it("keeps a crawler's impression in raw and out of filtered", async () => {
    const sponsor = await createSponsor(input());
    await recordSponsorEvent({
      sponsorId: sponsor.id,
      kind: "IMPRESSION",
      page: "/c/acme",
      ip: "66.249.66.1",
      userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1)",
    });
    await recordSponsorEvent({
      sponsorId: sponsor.id,
      kind: "IMPRESSION",
      page: "/c/acme",
      ip: "203.0.113.9",
      userAgent: HUMAN_UA,
    });

    const stats = (await getSponsorStats()).get(sponsor.id);
    expect(stats?.impressionsRaw).toBe(2);
    expect(stats?.impressions).toBe(1);
  });

  it("quotes CTR on the filtered numbers", async () => {
    const sponsor = await createSponsor(input());
    const base = { sponsorId: sponsor.id, page: "/c/acme", userAgent: HUMAN_UA };

    for (const ip of ["203.0.113.1", "203.0.113.2", "203.0.113.3", "203.0.113.4"]) {
      await recordSponsorEvent({ ...base, kind: "IMPRESSION", ip });
    }
    // One reader clicks twice; that is one click.
    await recordSponsorEvent({ ...base, kind: "CLICK", ip: "203.0.113.1" });
    await recordSponsorEvent({ ...base, kind: "CLICK", ip: "203.0.113.1" });
    // A crawler "clicks" too, and is counted raw only.
    await recordSponsorEvent({ ...base, kind: "CLICK", ip: "66.249.66.1", userAgent: "curl/8" });

    const stats = (await getSponsorStats()).get(sponsor.id);
    expect(stats?.clicksRaw).toBe(3);
    expect(stats?.clicks).toBe(1);
    expect(stats?.ctr).toBeCloseTo(0.25);
    expect(stats?.ctrRaw).toBeCloseTo(0.75);
  });

  it("never hashes a visitor who asked not to be tracked, and counts them once", async () => {
    const sponsor = await createSponsor(input());
    const view = {
      sponsorId: sponsor.id,
      kind: "IMPRESSION" as const,
      page: "/c/acme",
      ip: "203.0.113.9",
      userAgent: HUMAN_UA,
      untracked: true,
    };
    expect(await recordSponsorEvent(view)).toBe("RECORDED");
    expect(await recordSponsorEvent(view)).toBe("RECORDED");

    const { getDb } = await import("@/lib/db/client");
    const { rows } = await getDb().execute(
      `SELECT visitor_key, is_repeat FROM sponsor_events`,
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.visitor_key === null)).toBe(true);
    expect((await getSponsorStats()).get(sponsor.id)?.impressions).toBe(2);
  });

  it("drops beacons for unknown or not-live sponsors, and stops storing a flood", async () => {
    const off = await createSponsor(input({ active: false }));
    const base = { page: "/c/acme", ip: "203.0.113.9", userAgent: HUMAN_UA };

    expect(
      await recordSponsorEvent({ ...base, sponsorId: "nope", kind: "IMPRESSION" }),
    ).toBe("DROPPED_UNKNOWN");
    expect(
      await recordSponsorEvent({ ...base, sponsorId: off.id, kind: "IMPRESSION" }),
    ).toBe("DROPPED_NOT_LIVE");

    const live = await createSponsor(input());
    const outcomes: string[] = [];
    for (let i = 0; i < MAX_REPEATS_STORED + 3; i++) {
      outcomes.push(
        await recordSponsorEvent({ ...base, sponsorId: live.id, kind: "CLICK" }),
      );
    }
    expect(outcomes[0]).toBe("RECORDED");
    expect(outcomes.filter((o) => o === "DROPPED_FLOOD")).toHaveLength(3);
    expect(await countRows("sponsor_events")).toBe(MAX_REPEATS_STORED);
  });

  it("breaks the report down by day", async () => {
    const sponsor = await createSponsor(input());
    await recordSponsorEvent({
      sponsorId: sponsor.id,
      kind: "IMPRESSION",
      page: "/c/acme",
      ip: "203.0.113.9",
      userAgent: HUMAN_UA,
    });
    const daily = await getSponsorDailyStats(sponsor.id, 30);
    expect(daily).toHaveLength(1);
    expect(daily[0].day).toBe(new Date().toISOString().slice(0, 10));
    expect(daily[0].impressions).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
describe("sponsorship stays out of the graph", () => {
  it("creates, edits and measures a sponsor without touching a company or an edge", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    const companiesBefore = await countRows("companies");
    const edgesBefore = await countRows("relationships");

    const sponsor = await createSponsor(input({ categories: ["Analytics"] }));
    await updateSponsor(sponsor.id, input({ name: "Tally Forms" }));
    await recordSponsorEvent({
      sponsorId: sponsor.id,
      kind: "CLICK",
      page: `/c/${acme.slug}`,
      ip: "203.0.113.9",
      userAgent: HUMAN_UA,
    });

    expect((await getSponsorById(sponsor.id))?.name).toBe("Tally Forms");
    expect(await countRows("companies")).toBe(companiesBefore);
    expect(await countRows("relationships")).toBe(edgesBefore);
    expect(await countRows("claims")).toBe(0);
  });

  it("has no query into companies or relationships, and labels every paid link", async () => {
    const { readFile } = await import("node:fs/promises");

    // The sponsor modules may mention the tables in a comment that promises to
    // leave them alone; they may not name them in SQL.
    const graphSql = /\b(FROM|JOIN|UPDATE|INTO|DELETE FROM)\s+(companies|relationships|claims|company_members)\b/i;
    for (const file of [
      "src/lib/sponsors.ts",
      "src/lib/db/sponsors.ts",
      "src/lib/sponsor-events.ts",
      "src/actions/sponsors.ts",
    ]) {
      const text = await readFile(file, "utf8");
      expect(text, file).not.toMatch(graphSql);
    }

    const card = await readFile("src/components/SponsorCard.tsx", "utf8");
    expect(card).toContain('rel="sponsored noopener noreferrer"');
    expect(card).toContain("brand.sponsoredLabel");

    const { brand } = await import("@/lib/brand");
    expect(brand.sponsoredLabel).toBe("Sponsored");
  });
});
