import { describe, expect, it } from "vitest";
import { mapCategory } from "@/lib/import/category";
import {
  byImportPriority,
  dedupeByDomain,
  IMPORT_THRESHOLD,
  scoreRecord,
  summarize,
  type RawRecord,
  type Scored,
} from "@/lib/import/launchllama";
import { parseCsv, parseSourceFile, toCsv } from "@/lib/import/table";
import { tryNormalizeSiteUrl } from "@/lib/url";

function score(
  raw: RawRecord,
  enriched?: Parameters<typeof scoreRecord>[1]["enriched"],
): Scored {
  return scoreRecord(raw, {
    enriched,
    now: Date.parse("2026-09-01T00:00:00Z"),
    normalizeSite: tryNormalizeSiteUrl,
    mapCategory,
  });
}

/** A row that any real export would contain: a plausible micro-SaaS. */
const GOOD: RawRecord = {
  Name: "Quietdesk",
  Website: "https://quietdesk.io",
  Description: "Async standup software for remote teams. Integrates with Slack.",
  Category: "Productivity",
  "Team size": "1-10",
  "Launch date": "2026-02-01",
  Twitter: "@quietdesk",
};

describe("field mapping survives whatever the export calls things", () => {
  it("reads the same row under different column names", () => {
    const a = score(GOOD);
    const b = score({
      title: "Quietdesk",
      product_url: "quietdesk.io",
      tagline: "Async standup software for remote teams. Integrates with Slack.",
      tags: "Productivity",
      company_size: "1-10",
      launched_at: "2026-02-01",
      maker: "@quietdesk",
    });

    expect(b.name).toBe(a.name);
    expect(b.domain).toBe("quietdesk.io");
    expect(b.icpScore).toBe(a.icpScore);
  });

  it("normalizes the website to a domain and canonical origin", () => {
    const row = score({ ...GOOD, Website: "HTTPS://WWW.Quietdesk.io/pricing?x=1" });
    expect(row.domain).toBe("quietdesk.io");
    expect(row.website).toBe("https://quietdesk.io");
  });
});

describe("the rubric only counts evidence", () => {
  it("scores the six criteria it can see and leaves the rest unknown", () => {
    const row = score(GOOD);

    expect(row.signals.software).toBe("yes");
    expect(row.signals.smallTeam).toBe("yes");
    expect(row.signals.active).toBe("yes");
    expect(row.signals.b2bUseCase).toBe("yes");
    expect(row.signals.contactable).toBe("yes");
    expect(row.icpScore).toBeGreaterThanOrEqual(IMPORT_THRESHOLD);
    expect(row.importRecommended).toBe(true);
  });

  it("marks what it cannot know as unknown rather than guessing", () => {
    const row = score({
      Name: "Thing",
      Website: "thing.dev",
      Description: "A tool for teams.",
    });

    expect(row.signals.smallTeam).toBe("unknown");
    expect(row.signals.active).toBe("unknown");
    expect(row.signals.stackRichness).toBe("unknown");
    // Unknowns never inflate a score, so this row is not recommended on hope.
    expect(row.icpScore).toBeLessThan(IMPORT_THRESHOLD);
    expect(row.importRecommended).toBe(false);
    // Two of six determined from a one-line description is exactly "medium":
    // it is software with a B2B audience, and nothing else is established.
    expect(row.confidence).toBe("medium");
  });

  it("lets a site read answer the three criteria an export cannot", () => {
    const bare: RawRecord = {
      Name: "Olva",
      Website: "olva.ai",
      Description: "Voice notes that become structured records for field teams.",
    };
    expect(score(bare).icpScore).toBeLessThan(IMPORT_THRESHOLD);

    const enriched = score(bare, {
      reachable: true,
      contactEmail: "hello@olva.ai",
      detectedTools: ["plausible.io", "tally.so"],
    });

    expect(enriched.signals.active).toBe("yes");
    expect(enriched.signals.contactable).toBe("yes");
    expect(enriched.signals.stackRichness).toBe("yes");
    expect(enriched.confidence).toBe("high");
    expect(enriched.importRecommended).toBe(true);
  });

  it("records a dead site as an exclusion, not a low score", () => {
    const row = score(GOOD, { reachable: false });
    expect(row.exclusionReason).toBe("site did not respond");
    expect(row.importRecommended).toBe(false);
  });

  it("counts an unreachable contact route as negative evidence", () => {
    const row = score(
      { Name: "Thing", Website: "thing.dev", Description: "A tool for teams." },
      { reachable: true, contactEmail: null, detectedTools: [] },
    );
    expect(row.signals.contactable).toBe("no");
    expect(row.signals.stackRichness).toBe("no");
  });
});

describe("exclusions drop what the ICP rules out", () => {
  const cases: [string, string][] = [
    ["We are a design agency building apps for clients.", "agency or consultancy"],
    ["A marketplace for freelance writers.", "marketplace or directory without a software product"],
    ["Web3 wallet with token rewards.", "crypto or token project"],
    ["A meditation app for your commute.", "consumer-only app"],
    ["1:1 coaching for founders.", "service business, not software"],
    ["Weekend project, no longer maintained.", "open-source project with no commercial product"],
  ];

  for (const [description, reason] of cases) {
    it(`drops "${description.slice(0, 34)}…" as ${reason}`, () => {
      const row = score({ Name: "X", Website: "x.dev", Description: description });
      expect(row.exclusionReason).toBe(reason);
      expect(row.importRecommended).toBe(false);
    });
  }

  it("never recommends a row without a usable website", () => {
    expect(score({ Name: "X", Description: "A tool for teams." }).exclusionReason)
      .toBe("no website in the source row");
    expect(
      score({ Name: "X", Website: "not a url", Description: "A tool for teams." })
        .exclusionReason,
    ).toBe("unusable website address");
  });

  it("excludes a row with nothing to judge", () => {
    expect(score({ Name: "X", Website: "x.dev" }).exclusionReason).toBe(
      "no description or category to judge",
    );
  });

  it("keeps an excluded row out however well it would otherwise score", () => {
    const row = score({ ...GOOD, Description: `${GOOD.Description} We are an agency.` });
    expect(row.icpScore).toBeGreaterThanOrEqual(IMPORT_THRESHOLD);
    expect(row.importRecommended).toBe(false);
  });
});

describe("categories", () => {
  it("maps the first-wave categories from free text", () => {
    expect(mapCategory("applicant tracking for recruiters")).toBe("Hiring & HR");
    expect(mapCategory("privacy-friendly website analytics")).toBe("Analytics");
    expect(mapCategory("build forms and surveys")).toBe("Forms & surveys");
    expect(mapCategory("collect testimonials")).toBe("Social proof");
  });

  it("leaves what it cannot place empty rather than guessing", () => {
    expect(mapCategory("a thing that does stuff")).toBe("");
  });
});

describe("dedupe and ordering", () => {
  it("keeps the better row for a repeated domain", () => {
    const weak = score({ Name: "Q", Website: "quietdesk.io", Description: "A tool for teams." });
    const strong = score(GOOD);

    const unique = dedupeByDomain([weak, strong]);
    expect(unique).toHaveLength(1);
    expect(unique[0].icpScore).toBe(strong.icpScore);
  });

  it("orders by score, then confidence, then contactability", () => {
    const rows = [
      score({ Name: "A", Website: "a.dev", Description: "A tool for teams." }),
      score(GOOD),
      score({ ...GOOD, Name: "B", Website: "b.dev", Twitter: "" }),
    ].sort(byImportPriority);

    expect(rows[0].domain).toBe("quietdesk.io");
    expect(rows[rows.length - 1].domain).toBe("a.dev");
  });

  it("summarises into the buckets the report prints", () => {
    const summary = summarize([
      score(GOOD),
      score({ Name: "X", Website: "x.dev", Description: "We are an agency." }),
      score({ Name: "Y", Website: "y.dev", Description: "A tool for teams." }),
    ]);

    expect(summary.total).toBe(3);
    expect(summary.excluded).toBe(1);
    expect(summary.recommended).toBe(1);
    // The agency row scores too, it is simply never recommended.
    expect(summary.buckets["0-3"]).toBe(2);
    expect(summary.topCategories[0].count).toBe(1);
  });
});

describe("reading and writing the review file", () => {
  it("handles quotes, commas and CRLF in a source CSV", () => {
    const rows = parseCsv(
      'name,description\r\n"Acme, Inc.","They said ""hi"" to teams"\r\nPlain,Simple\r\n',
    );
    expect(rows).toEqual([
      { name: "Acme, Inc.", description: 'They said "hi" to teams' },
      { name: "Plain", description: "Simple" },
    ]);
  });

  it("round-trips a row through the CSV writer", () => {
    const csv = toCsv(["a", "b"], [{ a: 'x,"y"', b: 2 }]);
    expect(parseCsv(csv)).toEqual([{ a: 'x,"y"', b: "2" }]);
  });

  it("reads JSON as an array, wrapped, or nested", () => {
    const flat = parseSourceFile('[{"name":"A","website":"a.dev"}]', "x.json");
    expect(flat).toEqual([{ name: "A", website: "a.dev" }]);

    const wrapped = parseSourceFile(
      '{"data":[{"name":"A","meta":{"url":"a.dev"},"tags":["x","y"]}]}',
      "x.json",
    );
    expect(wrapped[0]).toEqual({ name: "A", meta_url: "a.dev", tags: "x, y" });
  });

  it("rejects JSON with no records rather than importing nothing quietly", () => {
    expect(() => parseSourceFile('{"ok":true}', "x.json")).toThrow(/no array/i);
  });

  it("strips a BOM so the first column name still matches", () => {
    expect(parseCsv("﻿name,website\nA,a.dev\n")[0].name).toBe("A");
  });
});
