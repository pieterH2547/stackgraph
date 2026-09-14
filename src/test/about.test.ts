import { describe, expect, it } from "vitest";
import { buildAbout, buildWhatItDoes } from "@/lib/detect";

const words = (text: string | null) =>
  (text ?? "").split(/\s+/).filter(Boolean).length;

/** Paragraphs as they would appear on a company's own /about page. */
function aboutPage(...paragraphs: string[]): string {
  return `<html><body><main>${paragraphs
    .map((p) => `<p>${p}</p>`)
    .join("")}</main></body></html>`;
}

const SELF =
  "Acme Forms is an independent company based in Ghent. We built it because form builders had drifted into bloat, and we wanted one that a person could use in a minute without training. Our whole team is three people and we intend to keep it that way.";

describe("About is the company's own account of itself", () => {
  it("uses their deliberate description plus their own about page", () => {
    const about = buildAbout(aboutPage(SELF), "Forms that feel like documents.", "Acme");
    expect(about).toContain("Forms that feel like documents.");
    expect(about).toContain("independent company based in Ghent");
    expect(words(about)).toBeGreaterThanOrEqual(25);
    expect(words(about)).toBeLessThanOrEqual(100);
  });

  it("never attributes a customer's words to the company", () => {
    // The failure that made homepage copy unusable as a source: a testimonial
    // reads exactly like self-description once the quote styling is stripped.
    const about = buildAbout(
      aboutPage(
        "I just jumped in and put Acme to work — that's how clean the UX is.",
        "“Acme was a game changer for me.”",
        SELF,
      ),
      null,
      "Acme",
    );
    expect(about).not.toContain("jumped in");
    expect(about).not.toContain("game changer");
    expect(about).toContain("independent company");
  });

  it("drops a team bio, which is true and is not about the company", () => {
    const about = buildAbout(
      aboutPage(SELF, "Wilson is Acme's CTO. He loves building beautiful products."),
      null,
      "Acme",
    );
    expect(about).not.toContain("Wilson");
  });

  it("drops sales copy addressed to the reader", () => {
    const about = buildAbout(
      aboutPage(
        "Buyers' inboxes are flooded with bad offers and fake urgency.",
        "You need to stand out to get the sales you deserve.",
        SELF,
      ),
      null,
      "Acme",
    );
    expect(about).not.toContain("flooded");
    expect(about).not.toContain("deserve");
  });

  it("drops calls to action and prices out of a description", () => {
    const about = buildAbout(
      aboutPage(SELF),
      "Forms that feel like documents. Get started for free.",
      "Acme",
    );
    expect(about).toContain("Forms that feel like documents.");
    expect(about).not.toContain("Get started");
  });

  it("never keeps a half sentence", () => {
    const about = buildAbout(
      aboutPage("We make forms and this paragraph was cut off mid", SELF),
      null,
      "Acme",
    );
    expect(about).not.toContain("cut off mid");
  });

  it("returns nothing rather than a thin one, for a site with no about page", () => {
    expect(buildAbout("", null, "Acme")).toBeNull();
    expect(buildAbout("", "Forms that feel like documents.", "Acme")).toBeNull();
  });
});

describe("What it does comes from a real feature list", () => {
  const features = `<ul>
    <li>Collect responses without writing code</li>
    <li>Conditional logic on every question</li>
    <li>Pay-what-you-want pricing for teams of any size</li>
    <li>Export to Google Sheets and Notion</li>
  </ul>`;

  it("takes short capability phrases from a list of three or more", () => {
    const bullets = buildWhatItDoes(`<body><main>${features}</main></body>`);
    expect(bullets.length).toBeGreaterThanOrEqual(2);
    expect(bullets[0]).toBe("Collect responses without writing code");
  });

  it("ignores a pricing table", () => {
    const pricing = `<body><main><h2>Pricing</h2><p>$19 per month</p><ul>
      <li>3 years of data retention</li>
      <li>Everything in Starter</li>
      <li>Unlimited seats</li>
    </ul></main></body>`;
    expect(buildWhatItDoes(pricing)).toEqual([]);
  });

  it("ignores a nav menu and an FAQ", () => {
    const nav = `<body><main><ul>
      <li><a href="/pricing">Pricing</a></li>
      <li><a href="/docs">Docs</a></li>
      <li><a href="/blog">Blog</a></li>
    </ul></main></body>`;
    expect(buildWhatItDoes(nav)).toEqual([]);

    const faq = `<body><main><ul>
      <li>What are simple website analytics ?</li>
      <li>How is this GDPR compliant ?</li>
      <li>Why is this privacy focused ?</li>
    </ul></main></body>`;
    expect(buildWhatItDoes(faq)).toEqual([]);
  });

  it("shows none rather than one orphan bullet", () => {
    const thin = `<body><main><ul>
      <li>Collect responses without writing code</li>
      <li><a href="/x">Docs</a></li>
      <li>hi</li>
    </ul></main></body>`;
    expect(buildWhatItDoes(thin)).toEqual([]);
  });

  it("caps at four", () => {
    const many = `<body><main><ul>${Array.from(
      { length: 9 },
      (_, i) => `<li>Feature number ${i} that does something</li>`,
    ).join("")}</ul></main></body>`;
    expect(buildWhatItDoes(many)).toHaveLength(4);
  });
});
