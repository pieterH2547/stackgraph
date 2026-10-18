import { beforeEach, describe, expect, it } from "vitest";
import {
  claimProfile,
  countRows,
  joinedCompany,
  resetDatabase,
} from "./helpers";
import { getDb } from "@/lib/db/client";
import {
  deleteRelationship,
  listIncomingEdges,
  setRelationshipState,
  updateCompany,
} from "@/lib/db/queries";
import { submitStack } from "@/lib/network";
import {
  badgeAvailable,
  countBadgeUsedBy,
  getBadgeStats,
  getBadgeSubject,
  recordBadgeClick,
  recordBadgeView,
} from "@/lib/badge/stats";
import {
  BADGE_CACHE_CONTROL,
  clearBadgeMemo,
  parseBadgeFile,
  serveBadge,
} from "@/lib/badge/serve";
import {
  badgeCopy,
  cleanBadgeName,
  escapeXml,
  MAX_BADGE_NAME,
  renderBadge,
} from "@/lib/badge/svg";
import { badgeAlt, badgeEmbedHtml } from "@/lib/badge/embed";
import { routes } from "@/lib/routes";
import { uniqueSlug } from "@/lib/slug";
import type { Company } from "@/lib/types";

beforeEach(async () => {
  await resetDatabase();
  clearBadgeMemo();
});

/** A claimed vendor that `n` other companies say they use. */
async function creditedVendor(n: number): Promise<Company> {
  const vendor = await claimProfile(await joinedCompany("tally.so", "Tally"));
  for (let i = 0; i < n; i++) {
    const user = await joinedCompany(`user-${i}.dev`, `User ${i}`);
    await submitStack({
      companyId: user.id,
      tools: [{ existingCompanyId: vendor.id }],
    });
  }
  return vendor;
}

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost:3000${path}`, { headers });
}

async function markDemo(companyId: string): Promise<void> {
  await getDb().execute({
    sql: `UPDATE companies SET is_demo = 1 WHERE id = ?`,
    args: [companyId],
  });
}

/* -------------------------------------------------------------------------- */
describe("what the badge counts", () => {
  it("shows the real number of companies that say they use the product", async () => {
    const vendor = await creditedVendor(3);

    const subject = await getBadgeSubject(vendor.slug);
    expect(subject?.count).toBe(3);

    const { svg, title } = renderBadge({ name: vendor.name, count: 3 });
    expect(title).toBe("3 software companies on Who Uses What say they use Tally.");
    expect(svg).toContain(">3 software companies<");
    expect(svg).toContain(">SAY THEY USE TALLY<");
  });

  it("uses the singular, and the profile's own phrasing, for one", () => {
    const { headline, subline, title } = badgeCopy("Tally", 1);
    expect(headline).toBe("1 software company");
    expect(subline).toBe("says it uses Tally");
    expect(title).toBe("1 software company on Who Uses What says it uses Tally.");
  });

  it("leaves a disputed relationship out, like the profile does", async () => {
    const vendor = await creditedVendor(3);
    const [first, second] = await listIncomingEdges(vendor.id);

    await setRelationshipState(first.id, "DISPUTED");
    expect(await countBadgeUsedBy(vendor.id)).toBe(2);

    // The current dispute path deletes the row outright; that counts down too.
    await deleteRelationship(second.id);
    expect(await countBadgeUsedBy(vendor.id)).toBe(1);
  });

  it("never counts a statement from the demo fixture", async () => {
    const vendor = await creditedVendor(2);
    const [edge] = await listIncomingEdges(vendor.id);
    await markDemo(edge.source.id);

    expect(await countBadgeUsedBy(vendor.id)).toBe(1);
  });

  it("shows no number at all when nobody has credited the company", async () => {
    const vendor = await creditedVendor(0);
    const subject = await getBadgeSubject(vendor.slug);
    expect(subject?.count).toBe(0);

    const { headline, subline, title } = badgeCopy(vendor.name, 0);
    expect(headline).toBe("Tally");
    expect(subline).toBe("on Who Uses What");
    expect(title).not.toMatch(/\d/);

    const { svg } = renderBadge({ name: vendor.name, count: 0 });
    expect(svg).not.toContain("software compan");
    expect(svg).not.toContain(">0");
  });

  it("formats a large count the way the site does", () => {
    expect(badgeCopy("Tally", 1204).headline).toBe("1,204 software companies");
  });

  it("never says anything about verified customers", () => {
    for (const count of [0, 1, 2, 50]) {
      const { svg, title } = renderBadge({ name: "Tally", count });
      expect(title.toLowerCase()).not.toContain("verified");
      expect(title.toLowerCase()).not.toContain("customer");
      // The one place the words appear is the description denying them.
      expect(svg).toContain("Not a verified customer list");
      expect(svg).toContain("Self-reported");
    }
  });
});

/* -------------------------------------------------------------------------- */
describe("who gets a badge", () => {
  it("serves a claimed company and refuses an unclaimed one", async () => {
    const claimed = await creditedVendor(1);
    const unclaimed = await joinedCompany("acme.dev", "Acme");

    expect(badgeAvailable(claimed)).toBe(true);
    expect(badgeAvailable(unclaimed)).toBe(false);

    const ok = await serveBadge(`${claimed.slug}.svg`, get(`/badge/${claimed.slug}.svg`));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(await ok.text()).toContain("<svg");

    const no = await serveBadge(`${unclaimed.slug}.svg`, get(`/badge/${unclaimed.slug}.svg`));
    expect(no.status).toBe(404);
    expect(no.headers.get("content-type")).toContain("text/plain");
    expect(await no.text()).not.toContain("<svg");
  });

  it("refuses a demo company: an invented graph gets no badge", async () => {
    const vendor = await creditedVendor(2);
    await markDemo(vendor.id);

    const response = await serveBadge(`${vendor.slug}.svg`, get(`/badge/${vendor.slug}.svg`));
    expect(response.status).toBe(404);
  });

  it("refuses anything that is not a slug", async () => {
    for (const file of [
      "../../etc/passwd",
      "acme<svg>",
      "Acme.svg",
      "",
      "-leading-dash",
      "a".repeat(80),
      "acme.png",
      "acme.svg.svg",
      "acme%20inc",
    ]) {
      expect(parseBadgeFile(file), file).toBeNull();
      const response = await serveBadge(file, get(`/badge/${encodeURIComponent(file)}`));
      expect(response.status, file).toBe(404);
    }
    expect(await countRows("badge_stats")).toBe(0);
  });

  it("answers an unknown slug with a short-lived miss", async () => {
    const response = await serveBadge("nobody.svg", get("/badge/nobody.svg"));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("max-age=");
  });

  it("accepts the slug with or without the extension", async () => {
    const vendor = await creditedVendor(1);
    const withExt = await serveBadge(`${vendor.slug}.svg`, get(`/badge/${vendor.slug}.svg`));
    const bare = await serveBadge(vendor.slug, get(`/badge/${vendor.slug}`));
    expect(bare.status).toBe(200);
    expect(bare.headers.get("etag")).toBe(withExt.headers.get("etag"));
  });
});

/* -------------------------------------------------------------------------- */
describe("the SVG is safe to serve", () => {
  it("escapes a hostile company name everywhere it appears", async () => {
    const vendor = await creditedVendor(1);
    // Short enough to survive truncation whole, so every character is tested.
    await updateCompany(vendor.id, {
      name: `Ta<script>x</script>&"'`,
    });

    const response = await serveBadge(`${vendor.slug}.svg`, get(`/badge/${vendor.slug}.svg`));
    const svg = await response.text();

    expect(svg).not.toMatch(/<script/i);
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("&lt;SCRIPT&gt;");
    expect(svg).toContain("&amp;");
    expect(svg).toContain("&quot;");
    expect(svg).toContain("&apos;");
  });

  it("strips control characters and bounds the name", () => {
    expect(cleanBadgeName("Ta\u0000lly\u001f \n Forms")).toBe("Tally Forms");
    expect(cleanBadgeName("   ")).toBe("This company");

    const long = cleanBadgeName("A".repeat(100));
    expect(long.length).toBe(MAX_BADGE_NAME);
    expect(long.endsWith("…")).toBe(true);
  });

  it("contains nothing that loads, runs or links", () => {
    const { svg } = renderBadge({ name: "Tally", count: 12 });
    for (const forbidden of [
      /<script/i,
      /<image/i,
      /<foreignObject/i,
      /<use/i,
      /<a\s/i,
      /href=/i,
      /javascript:/i,
      /\son[a-z]+=/i,
      /<style/i,
      /@import/i,
    ]) {
      expect(svg).not.toMatch(forbidden);
    }
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  });

  it("is served with the headers that keep it an image", async () => {
    const vendor = await creditedVendor(1);
    const response = await serveBadge(`${vendor.slug}.svg`, get(`/badge/${vendor.slug}.svg`));

    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("escapes XML the five ways", () => {
    expect(escapeXml(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;",
    );
  });

  it("renders a dark theme of the same size, and ignores a theme it does not have", async () => {
    const vendor = await creditedVendor(4);
    const light = renderBadge({ name: vendor.name, count: 4 });
    const dark = renderBadge({ name: vendor.name, count: 4, theme: "dark" });
    expect(dark.width).toBe(light.width);
    expect(dark.height).toBe(light.height);
    expect(dark.title).toBe(light.title);
    expect(dark.svg).not.toBe(light.svg);

    const plain = await serveBadge(`${vendor.slug}.svg`, get(`/badge/${vendor.slug}.svg`));
    const neon = await serveBadge(`${vendor.slug}.svg`, get(`/badge/${vendor.slug}.svg?theme=neon`));
    expect(await neon.text()).toBe(await plain.text());
  });
});

/* -------------------------------------------------------------------------- */
describe("caching", () => {
  it("tells browsers and the CDN to hold the image", async () => {
    const vendor = await creditedVendor(1);
    const response = await serveBadge(`${vendor.slug}.svg`, get(`/badge/${vendor.slug}.svg`));

    expect(response.headers.get("cache-control")).toBe(BADGE_CACHE_CONTROL);
    expect(BADGE_CACHE_CONTROL).toContain("s-maxage=");
    expect(BADGE_CACHE_CONTROL).toContain("stale-while-revalidate=");
    expect(response.headers.get("etag")).toMatch(/^"[A-Za-z0-9_-]+"$/);
  });

  it("answers 304 when the browser already has this exact image", async () => {
    const vendor = await creditedVendor(2);
    const first = await serveBadge(`${vendor.slug}.svg`, get(`/badge/${vendor.slug}.svg`));
    const etag = first.headers.get("etag")!;

    const again = await serveBadge(
      `${vendor.slug}.svg`,
      get(`/badge/${vendor.slug}.svg`, { "if-none-match": etag }),
    );
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect(again.headers.get("etag")).toBe(etag);
    expect(again.headers.get("cache-control")).toBe(BADGE_CACHE_CONTROL);
  });

  it("serves from a short memo at the origin, then reads again", async () => {
    const vendor = await creditedVendor(2);
    const path = `/badge/${vendor.slug}.svg`;

    expect(await (await serveBadge(`${vendor.slug}.svg`, get(path))).text()).toContain(
      ">2 software companies<",
    );

    const [edge] = await listIncomingEdges(vendor.id);
    await deleteRelationship(edge.id);

    // Within the memo window the badge is allowed to lag the profile…
    expect(await (await serveBadge(`${vendor.slug}.svg`, get(path))).text()).toContain(
      ">2 software companies<",
    );
    // …and once it expires the database is read again.
    clearBadgeMemo();
    expect(await (await serveBadge(`${vendor.slug}.svg`, get(path))).text()).toContain(
      ">1 software company<",
    );
  });
});

/* -------------------------------------------------------------------------- */
describe("measurement", () => {
  it("counts a load at the origin as a view and a badge arrival as a click", async () => {
    const vendor = await creditedVendor(1);

    await serveBadge(`${vendor.slug}.svg`, get(`/badge/${vendor.slug}.svg`));
    await serveBadge(`${vendor.slug}.svg`, get(`/badge/${vendor.slug}.svg?theme=dark`));
    await recordBadgeClick(vendor.id);

    expect(await getBadgeStats(vendor.id)).toEqual({ views: 2, clicks: 1, days: 30 });
  });

  it("counts a 304 as a view: the browser did show the badge again", async () => {
    const vendor = await creditedVendor(1);
    const first = await serveBadge(`${vendor.slug}.svg`, get(`/badge/${vendor.slug}.svg`));
    await serveBadge(
      `${vendor.slug}.svg`,
      get(`/badge/${vendor.slug}.svg`, { "if-none-match": first.headers.get("etag")! }),
    );
    expect((await getBadgeStats(vendor.id)).views).toBe(2);
  });

  it("does not count the owner's own preview", async () => {
    const vendor = await creditedVendor(1);
    await serveBadge(`${vendor.slug}.svg`, get(`/badge/${vendor.slug}.svg?preview=1`));
    expect((await getBadgeStats(vendor.id)).views).toBe(0);
  });

  it("hands the write to `defer` when it is given one", async () => {
    const vendor = await creditedVendor(1);
    const queued: Promise<void>[] = [];

    await serveBadge(`${vendor.slug}.svg`, get(`/badge/${vendor.slug}.svg`), {
      defer: (task) => {
        queued.push(task());
      },
    });
    expect(queued).toHaveLength(1);
    await Promise.all(queued);
    expect((await getBadgeStats(vendor.id)).views).toBe(1);
  });

  it("keeps one tally per company per day, and nothing about the visitor", async () => {
    const vendor = await creditedVendor(1);
    await recordBadgeView(vendor.id, "2026-10-18");
    await recordBadgeView(vendor.id, "2026-10-18");
    await recordBadgeClick(vendor.id, "2026-10-18");
    expect(await countRows("badge_stats")).toBe(1);

    const { rows } = await getDb().execute(`PRAGMA table_info(badge_stats)`);
    expect(rows.map((row) => String(row.name)).sort()).toEqual(
      ["clicks", "company_id", "day", "views"],
    );
  });

  it("reports a window, not all time", async () => {
    const vendor = await creditedVendor(1);
    const now = new Date("2026-10-18T12:00:00Z");
    await recordBadgeView(vendor.id, "2026-10-18");
    await recordBadgeView(vendor.id, "2026-09-19");
    await recordBadgeView(vendor.id, "2026-09-18");
    await recordBadgeView(vendor.id, "2020-01-01");

    expect((await getBadgeStats(vendor.id, 30, now)).views).toBe(2);
    expect((await getBadgeStats(vendor.id, 7, now)).views).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
describe("the embed code", () => {
  const input = {
    imageUrl: "http://localhost:3000/badge/tally.svg",
    profileUrl: "http://localhost:3000/c/tally?ref=badge",
    alt: badgeAlt("Tally"),
    width: 340,
    height: 48,
  };

  it("links to the public profile with nofollow, and offers a version with no link at all", () => {
    const linked = badgeEmbedHtml({ ...input, kind: "linked" });
    expect(linked).toContain('href="http://localhost:3000/c/tally?ref=badge"');
    expect(linked).toContain('rel="nofollow noopener"');
    expect(linked).toContain('<img src="http://localhost:3000/badge/tally.svg"');
    expect(linked).toContain('width="340" height="48"');

    const image = badgeEmbedHtml({ ...input, kind: "image" });
    expect(image.startsWith("<img ")).toBe(true);
    expect(image).not.toContain("<a ");
    expect(image).not.toContain("href=");
  });

  it("hides nothing and stuffs nothing", () => {
    for (const kind of ["linked", "image"] as const) {
      const html = badgeEmbedHtml({ ...input, kind });
      expect(html).not.toContain("style=");
      expect(html).not.toContain("display:none");
      expect(html).not.toContain('width="0"');
      expect(html).not.toContain('height="1"');
      expect(html).not.toMatch(/hidden/i);
    }
    expect(badgeAlt("Tally")).toBe("Companies that say they use Tally, on Who Uses What");
    // The alt carries no live number: the HTML on somebody's site does not update.
    expect(badgeAlt("Tally")).not.toMatch(/\d/);
  });

  it("escapes attribute values", () => {
    const html = badgeEmbedHtml({
      ...input,
      kind: "linked",
      alt: badgeAlt(`Tally "Forms" <3`),
      profileUrl: `http://localhost:3000/c/tally?ref=badge&x="<`,
    });
    expect(html).toContain("&quot;Forms&quot; &lt;3");
    expect(html).toContain("&amp;x=&quot;&lt;");
    expect(html).not.toContain('"<');
  });

  it("has one address for each thing", () => {
    expect(routes.badge("tally")).toBe("/c/tally/badge");
    expect(routes.badgeImage("tally")).toBe("/badge/tally.svg");
    expect(routes.badgeImage("tally", "dark")).toBe("/badge/tally.svg?theme=dark");
    expect(routes.profileFromBadge("tally")).toBe("/c/tally?ref=badge");
  });

  it("keeps `badge` out of company slugs", async () => {
    expect(await uniqueSlug("badge", async () => false)).toBe("badge-hq");
  });
});
