import { beforeEach, describe, expect, it } from "vitest";
import {
  claimProfile,
  countRows,
  joinedCompany,
  makeEveryMentionedVendorContactable,
  notificationsFor,
  resetDatabase,
  verifyIdentity,
} from "./helpers";
import {
  countIncomingOnNetwork,
  countUpstreamCredits,
  getCompanyByDomain,
  getCompanyBySlug,
  getNetworkGroupCounts,
  listAllCompanySlugs,
  listCreditedCompanies,
  listIncomingEdges,
  listJoinedCompanies,
  listOutgoingEdges,
  searchCompanies,
  setRelationshipState,
  updateCompany,
} from "@/lib/db/queries";
import {
  addCompany,
  classifyEdge,
  getClaimProgress,
  getProfile,
  settleClaim,
  StackValidationError,
  submitStack,
} from "@/lib/network";
import { getAcquisitionFunnel } from "@/lib/metrics";
import { getDb } from "@/lib/db/client";
import { track } from "@/lib/events";
import { assessEligibility } from "@/lib/eligibility";
import { composeMentionEmail, notifyMention } from "@/lib/notify";
import { getFlywheelMetrics } from "@/lib/metrics";
import { REQUIRED_UPSTREAM } from "@/lib/limits";
import { postClaimDestination, routes } from "@/lib/routes";
import { stackShareText } from "@/lib/share";
import { reportedBySource } from "@/lib/types";
import { absoluteUrl } from "@/lib/url";

beforeEach(async () => {
  await resetDatabase();
});

/* 1 ----------------------------------------------------------------------- */
describe("a company can be created from a website URL", () => {
  it("derives domain, slug and canonical website from any form of the URL", async () => {
    const { company, created } = await addCompany({
      url: "HTTPS://WWW.Acme.dev/pricing?utm=x",
      name: "Acme",
      source: "SELF_ADDED",
    });

    expect(created).toBe(true);
    expect(company.domain).toBe("acme.dev");
    expect(company.website).toBe("https://acme.dev");
    expect(company.slug).toBe("acme");
    expect(company.generation).toBe(0);
  });

  it("rejects things that aren't public websites", async () => {
    await expect(
      addCompany({ url: "http://localhost:3000", source: "SELF_ADDED", name: "x" }),
    ).rejects.toThrow();
    await expect(
      addCompany({ url: "not a url", source: "SELF_ADDED", name: "x" }),
    ).rejects.toThrow();
  });
});

/* 1-4 -------------------------------------------------------------------- */
describe("the claim gate: identity plus two independent tools", () => {
  it("stays unclaimed on identity alone", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    expect(acme.claimVerifiedAt).not.toBeNull();
    expect(acme.status).toBe("UNCLAIMED");

    const progress = await getClaimProgress(acme);
    expect(progress.identityVerified).toBe(true);
    expect(progress.complete).toBe(false);
    expect(progress.upstream).toBe(0);
    expect(progress.upstreamShort).toBe(REQUIRED_UPSTREAM);
  });

  it("stays unclaimed one eligible tool short", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    const result = await submitStack({
      companyId: acme.id,
      tools: [{ website: "tally.so", name: "Tally" }],
    });

    expect(result.progress.upstream).toBe(1);
    expect(result.progress.upstreamShort).toBe(1);
    expect(result.claimCompleted).toBe(false);
    expect(result.company.status).toBe("UNCLAIMED");
  });

  it("claims on two eligible tools, and nobody named has to confirm", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");

    const result = await submitStack({
      companyId: acme.id,
      tools: [
        { website: "tally.so", name: "Tally" },
        { website: "plausible.io", name: "Plausible" },
      ],
    });

    expect(result.progress.upstream).toBe(2);
    expect(result.claimCompleted).toBe(true);
    expect(result.company.status).toBe("CLAIMED");
    expect(result.company.claimedAt).not.toBeNull();

    // Both tools named are still unclaimed: their confirmation was never part
    // of this, and a claim that waited on other people would stall.
    for (const domain of ["tally.so", "plausible.io"]) {
      expect((await getCompanyByDomain(domain))!.status).toBe("UNCLAIMED");
    }
  });

  it("does not count incumbents towards the two, but keeps them in the stack", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");

    const result = await submitStack({
      companyId: acme.id,
      tools: [
        { website: "stripe.com", name: "Stripe" },
        { website: "vercel.com", name: "Vercel" },
        { website: "tally.so", name: "Tally" },
      ],
    });

    // Three edges exist and all three are visible, but only Tally is currency.
    expect(result.connections).toHaveLength(3);
    expect(await listOutgoingEdges(acme.id)).toHaveLength(3);
    expect(result.progress.upstream).toBe(1);
    expect(result.company.status).toBe("UNCLAIMED");

    const second = await submitStack({
      companyId: acme.id,
      tools: [{ website: "plausible.io", name: "Plausible" }],
    });
    expect(second.progress.upstream).toBe(2);
    expect(second.company.status).toBe("CLAIMED");
  });

  it("never asks for customers: a claimed company can have named none", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [
        { website: "tally.so", name: "Tally" },
        { website: "plausible.io", name: "Plausible" },
      ],
    });

    const claimed = (await getCompanyByDomain("acme.dev"))!;
    expect(claimed.status).toBe("CLAIMED");
    // Nothing points at Acme, and that was never required of it.
    expect(await listIncomingEdges(acme.id)).toHaveLength(0);
  });

  it("refuses nothing, and caps a single submission", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");

    await expect(
      submitStack({ companyId: acme.id, tools: [] }),
    ).rejects.toBeInstanceOf(StackValidationError);

    await expect(
      submitStack({
        companyId: acme.id,
        tools: Array.from({ length: 7 }, (_, i) => ({
          website: `tool-${i}.dev`,
          name: `Tool ${i}`,
        })),
      }),
    ).rejects.toBeInstanceOf(StackValidationError);
  });
});

/* 3 ----------------------------------------------------------------------- */
describe("an existing vendor is reused, not duplicated", () => {
  it("connects two companies to the same vendor profile", async () => {
    const first = await joinedCompany("first.dev", "First");
    const second = await joinedCompany("second.dev", "Second");

    await submitStack({
      companyId: first.id,
      tools: [{ website: "https://tally.so", name: "Tally" }],
    });
    const before = await countRows("companies");

    await submitStack({
      companyId: second.id,
      // A different spelling of the same company.
      tools: [{ website: "https://www.tally.so/pricing", name: "Tally Forms" }],
    });

    expect(await countRows("companies")).toBe(before);

    const tally = await getCompanyByDomain("tally.so");
    expect(tally).not.toBeNull();
    // The first name entered stands; a later mention doesn't rewrite it.
    expect(tally?.name).toBe("Tally");
    expect(await listIncomingEdges(tally!.id)).toHaveLength(2);
  });

  it("finds existing vendors by name and domain for the picker", async () => {
    const company = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: company.id,
      tools: [{ website: "plausible.io", name: "Plausible" }],
    });

    expect((await searchCompanies("plaus")).map((c) => c.domain)).toContain(
      "plausible.io",
    );
    expect((await searchCompanies("plausible.io")).length).toBeGreaterThan(0);
  });
});

/* 4 + 12 ------------------------------------------------------------------ */
describe("an unknown vendor gets an unclaimed profile that claims nothing", () => {
  it("creates it automatically, one generation deeper", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [{ website: "loops.so", name: "Loops" }],
    });

    const loops = await getCompanyByDomain("loops.so");
    expect(loops).not.toBeNull();
    expect(loops!.status).toBe("UNCLAIMED");
    expect(loops!.source).toBe("MENTIONED");
    expect(loops!.generation).toBe(acme.generation + 1);
  });

  it("never implies the vendor participated", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [{ website: "loops.so", name: "Loops" }],
    });

    const loops = (await getCompanyByDomain("loops.so"))!;
    expect(loops.status).toBe("UNCLAIMED");
    expect(loops.claimedAt).toBeNull();
    expect(loops.claimVerifiedAt).toBeNull();
    expect(loops.claimName).toBeNull();
    expect(loops.claimRole).toBeNull();
    expect(loops.contactEmail).toBeNull();
    expect(loops.description).toBeNull();
    // Nothing was read from their site in tests, so nothing is attributed to it.
    expect(loops.detectedAt).toBeNull();

    const { subject, body } = composeMentionEmail({
      vendor: loops,
      mentionedBy: acme,
      mentionCount: 1,
      claimUrl: absoluteUrl(routes.claim(loops.slug)),
    });

    expect(subject).toBe("Someone actually uses your software");
    expect(body).toContain("Acme says Loops helps power their company");
    for (const forbidden of ["directory", "listed", "backlink", "SEO"]) {
      expect(body.toLowerCase()).not.toContain(forbidden.toLowerCase());
      expect(subject.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

/* 5 + 6 ------------------------------------------------------------------- */
describe("relationships point the right way and never duplicate", () => {
  it("records source → target, not the reverse, and attributes who said it", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [{ website: "tally.so", name: "Tally" }],
    });

    const tally = (await getCompanyByDomain("tally.so"))!;
    const outgoing = await listOutgoingEdges(acme.id);
    const incoming = await listIncomingEdges(tally.id);

    expect(outgoing).toHaveLength(1);
    expect(outgoing[0].source.id).toBe(acme.id);
    expect(outgoing[0].target.id).toBe(tally.id);
    expect(outgoing[0].reportedByCompanyId).toBe(acme.id);
    expect(reportedBySource(outgoing[0])).toBe(true);
    expect(incoming[0].source.id).toBe(acme.id);
    expect(await listOutgoingEdges(tally.id)).toHaveLength(0);
  });

  it("keeps one edge per pair however many times it is submitted", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");

    await submitStack({
      companyId: acme.id,
      tools: [{ website: "tally.so", name: "Tally" }],
    });
    await submitStack({
      companyId: acme.id,
      tools: [{ website: "tally.so", name: "Tally" }],
    });
    // Also within a single submission.
    await submitStack({
      companyId: acme.id,
      tools: [
        { website: "resend.com", name: "Resend" },
        { website: "https://www.resend.com", name: "Resend" },
      ],
    });

    expect(await countRows("relationships")).toBe(2);
  });

  it("refuses to let a company list itself", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    await expect(
      submitStack({
        companyId: acme.id,
        tools: [{ existingCompanyId: acme.id }],
      }),
    ).rejects.toBeInstanceOf(StackValidationError);
    expect(await countRows("relationships")).toBe(0);
  });
});

/* 7 ----------------------------------------------------------------------- */
describe("large tools appear in the graph but stay out of the loop", () => {
  it("marks incumbents ineligible, never notifies them, and gives no credit", async () => {
    expect(assessEligibility("stripe.com").networkEligible).toBe(false);
    expect(assessEligibility("vercel.com").networkEligible).toBe(false);
    expect(assessEligibility("openai.com").networkEligible).toBe(false);
    expect(assessEligibility("tally.so").networkEligible).toBe(true);

    const acme = await joinedCompany("acme.dev", "Acme");
    const result = await submitStack({
      companyId: acme.id,
      tools: [
        { website: "stripe.com", name: "Stripe" },
        { website: "vercel.com", name: "Vercel" },
        { website: "tally.so", name: "Tally" },
      ],
    });

    const stripe = result.connections.find(
      (c) => c.company.domain === "stripe.com",
    )!;
    const tally = result.connections.find(
      (c) => c.company.domain === "tally.so",
    )!;

    // All three are in the stack…
    expect(result.connections).toHaveLength(3);
    expect(stripe.createdRelationship).toBe(true);
    // …but only the small one counts or starts the loop.
    expect(stripe.countsAsCredit).toBe(false);
    expect(stripe.edgeKind).toBe("STACK_ONLY");
    expect(tally.countsAsCredit).toBe(true);
    expect(tally.edgeKind).toBe("ACQUISITION");

    expect(result.progress.upstream).toBe(1);
    expect(await notificationsFor(stripe.company.id)).toHaveLength(0);
    expect(await notificationsFor(tally.company.id)).toHaveLength(1);
  });
});

/* 8 ----------------------------------------------------------------------- */
describe("every edge does something: acquisition or proof", () => {
  it("classifies an unclaimed independent vendor as acquisition", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    const result = await submitStack({
      companyId: acme.id,
      tools: [{ website: "tally.so", name: "Tally" }],
    });
    expect(result.connections[0].edgeKind).toBe("ACQUISITION");
  });

  it("classifies an already-claimed vendor as proof, so overlap isn't wasted", async () => {
    const tally = await claimProfile(
      await joinedCompany("tally.so", "Tally"),
    );
    expect(classifyEdge(tally)).toBe("PROOF");

    const acme = await joinedCompany("acme.dev", "Acme");
    const result = await submitStack({
      companyId: acme.id,
      tools: [{ existingCompanyId: tally.id }],
    });

    expect(result.connections[0].edgeKind).toBe("PROOF");
    // No new node, but the used-by count went up — that's the other job.
    expect(await listIncomingEdges(tally.id)).toHaveLength(1);
  });
});

/* 9-10 -------------------------------------------------------------------- */
describe("a mentioned vendor can claim and start the next generation", () => {
  it("sends a verified vendor straight back into the flywheel", () => {
    expect(postClaimDestination("tally")).toBe("/stack/tally?after=claim");
    expect(postClaimDestination("tally")).toContain(routes.stack("tally"));
  });

  it("claims on two tools and creates a third generation", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [{ website: "tally.so", name: "Tally" }],
    });

    const mentioned = (await getCompanyByDomain("tally.so"))!;
    expect(mentioned.status).toBe("UNCLAIMED");

    // Identity verified, but that alone claims nothing.
    const tally = await verifyIdentity(mentioned);
    expect(tally.status).toBe("UNCLAIMED");

    const finished = await submitStack({
      companyId: tally.id,
      tools: [
        { website: "posthog.com", name: "PostHog" },
        { website: "resend.com", name: "Resend" },
      ],
    });

    expect(finished.claimCompleted).toBe(true);
    expect(finished.company.status).toBe("CLAIMED");

    const posthog = (await getCompanyByDomain("posthog.com"))!;
    const resend = (await getCompanyByDomain("resend.com"))!;
    expect(posthog.generation).toBe(2);
    expect(resend.generation).toBe(2);
    expect(posthog.status).toBe("UNCLAIMED");

    // And they were invited, which is what keeps the loop turning. With no
    // address detected (the suite never reads websites) the invitation waits
    // for a human rather than guessing an address.
    expect((await notificationsFor(posthog.id))[0]?.status).toBe(
      "QUEUED_NO_ADDRESS",
    );
  });
});

/* 11 --------------------------------------------------------------------- */
describe("claim notifications dedupe", () => {
  it("turns five mentions in a week into one email, counting them all", async () => {
    const { company: vendor } = await addCompany({
      url: "tally.so",
      name: "Tally",
      source: "MENTIONED",
      contactEmail: "hello@tally.so",
    });

    for (let i = 0; i < 5; i++) {
      const mentioner = await joinedCompany(`user-${i}.dev`, `User ${i}`);
      await submitStack({
        companyId: mentioner.id,
        tools: [{ existingCompanyId: vendor.id }],
      });
    }

    const notifications = await notificationsFor(vendor.id);
    const sent = notifications.filter((n) => n.status === "SENT");
    const suppressed = notifications.filter(
      (n) => n.status === "SUPPRESSED_COOLDOWN",
    );

    expect(sent).toHaveLength(1);
    expect(suppressed).toHaveLength(4);

    // The wording gets stronger as the count climbs.
    const latest = suppressed[suppressed.length - 1];
    expect(latest.subject).toBe("5 software companies say they use Tally");
    expect(latest.body).toContain("5 independent software companies now say");
  });

  it("queues instead of inventing an address, and never chases a claimed vendor", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [{ website: "loops.so", name: "Loops" }],
    });

    const loops = (await getCompanyByDomain("loops.so"))!;
    expect((await notificationsFor(loops.id))[0].status).toBe(
      "QUEUED_NO_ADDRESS",
    );

    const claimed = await claimProfile(loops);
    const other = await joinedCompany("other.dev", "Other");
    await submitStack({
      companyId: other.id,
      tools: [{ existingCompanyId: claimed.id }],
    });

    const result = await notifyMention({
      vendorId: claimed.id,
      mentionedById: other.id,
    });
    expect(result.outcome).toBe("SKIPPED_ALREADY_CLAIMED");
  });

  it("has exactly one trigger: somebody put your product in their stack", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [{ website: "tally.so", name: "Tally" }],
    });

    const tally = (await getCompanyByDomain("tally.so"))!;
    const notification = (await notificationsFor(tally.id))[0];
    expect(notification.subject).toBe("Someone actually uses your software");
    expect(notification.body).toContain("Acme says Tally helps power");
    // Nothing is ever sent about a customer list, because none is collected.
    expect(notification.body).not.toContain("uses their product");
  });
});

/* 13 --------------------------------------------------------------------- */
describe("there is one kind of edge", () => {
  it("records uses, and nothing that reads as an endorsement", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [
        { website: "tally.so", name: "Tally" },
        { website: "plausible.io", name: "Plausible" },
      ],
    });

    const edges = await listOutgoingEdges(acme.id);
    expect(edges).toHaveLength(2);
    for (const edge of edges) {
      // "Acme uses Tally" is a fact about Acme. A recommendation would be a
      // claim about Tally, which this graph never makes on anyone's behalf.
      expect(Object.keys(edge)).not.toContain("type");
      expect(edge.state).toBe("SELF_REPORTED");
    }

    // Submitting the same tool again is one fact, not two.
    await submitStack({
      companyId: acme.id,
      tools: [{ website: "plausible.io", name: "Plausible" }],
    });
    expect(await countRows("relationships")).toBe(2);
  });
});

/* 5-7 -------------------------------------------------------------------- */
describe("one edge, two profiles: the source states it, the target gains it", () => {
  it("puts A in B's used-by and B in A's powered-by from a single statement", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [{ website: "tally.so", name: "Tally" }],
    });

    const tally = (await getCompanyByDomain("tally.so"))!;

    // A's own side.
    const acmeProfile = await getProfile(acme);
    expect(acmeProfile.outgoing.map((e) => e.target.domain)).toEqual([
      "tally.so",
    ]);
    expect(acmeProfile.incoming).toHaveLength(0);

    // B's side, which B never wrote.
    const tallyProfile = await getProfile(tally);
    expect(tallyProfile.incoming.map((e) => e.source.domain)).toEqual([
      "acme.dev",
    ]);
    expect(tallyProfile.outgoing).toHaveLength(0);
  });

  it("attributes every incoming edge to the company that made the statement", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    const kettle = await joinedCompany("kettle.app", "Kettle");
    await submitStack({
      companyId: acme.id,
      tools: [{ website: "tally.so", name: "Tally" }],
    });
    await submitStack({
      companyId: kettle.id,
      tools: [{ website: "tally.so", name: "Tally" }],
    });

    const tally = (await getCompanyByDomain("tally.so"))!;
    const profile = await getProfile(tally);
    expect(profile.incoming.map((e) => e.source.domain).sort()).toEqual([
      "acme.dev",
      "kettle.app",
    ]);

    // The invariant the public copy rests on: there is only ever one phrasing,
    // "<source> says it uses <target>", because the source is the only party
    // that can create an edge at all.
    for (const edge of profile.incoming) {
      expect(reportedBySource(edge)).toBe(true);
      expect(edge.reportedByCompanyId).toBe(edge.source.id);
      expect(edge.reportedByCompanyId).not.toBe(tally.id);
    }

    expect(await getCompanyBySlug(tally.slug)).not.toBeNull();
  });

  it("offers no way for a vendor to report a user of its own product", async () => {
    const network = await import("@/lib/network");
    const actions = await import("@/actions/stack");

    // The flow is gone, not hidden: nothing in the domain or the action layer
    // can write an edge on somebody else's behalf.
    expect(network).not.toHaveProperty("submitCustomers");
    expect(actions).not.toHaveProperty("saveCustomers");
    expect(Object.keys(network).filter((k) => /customer/i.test(k))).toEqual([]);
    expect(Object.keys(actions).filter((k) => /customer/i.test(k))).toEqual([]);
  });
});

/* 15 --------------------------------------------------------------------- */
describe("progressive unlock", () => {
  it("counts the mentions and how many are already on the network", async () => {
    const claimed = await claimProfile(await joinedCompany("one.dev", "One"));
    const unclaimed = await joinedCompany("two.dev", "Two");

    await submitStack({
      companyId: claimed.id,
      tools: [{ website: "tally.so", name: "Tally" }],
    });
    await submitStack({
      companyId: unclaimed.id,
      tools: [{ website: "tally.so", name: "Tally" }],
    });

    const tally = (await getCompanyByDomain("tally.so"))!;
    const profile = await getProfile(tally);

    expect(profile.usedByCount).toBe(2);
    expect(await countIncomingOnNetwork(tally.id)).toBe(1);
  });
});

/* 16 --------------------------------------------------------------------- */
describe("disputes", () => {
  it("lets the credited vendor remove an edge without touching anyone's claim", async () => {
    // Acme credits Tally. Tally is the only party with anything to object to,
    // since the statement is Acme's own.
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [
        { website: "tally.so", name: "Tally" },
        { website: "plausible.io", name: "Plausible" },
      ],
    });
    expect((await getCompanyByDomain("acme.dev"))!.status).toBe("CLAIMED");

    const tally = (await getCompanyByDomain("tally.so"))!;
    const edge = (await listIncomingEdges(tally.id))[0];
    expect(edge.source.domain).toBe("acme.dev");

    const { deleteRelationship } = await import("@/lib/db/queries");
    await deleteRelationship(edge.id);

    // The edge is out of the public graph on both sides…
    expect(await listIncomingEdges(tally.id)).toHaveLength(0);
    expect(await listOutgoingEdges(acme.id)).toHaveLength(1);
    // …and Acme keeps the claim it already earned. A claim other people could
    // revoke would make every claim hostage to someone else.
    expect((await getCompanyByDomain("acme.dev"))!.status).toBe("CLAIMED");
  });
});

/* 17 --------------------------------------------------------------------- */
describe("share links work and credit the other tools", () => {
  it("builds an absolute share URL and names the tools, not the sharer alone", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [
        { website: "tally.so", name: "Tally" },
        { website: "plausible.io", name: "Plausible" },
        { website: "loops.so", name: "Loops" },
      ],
    });

    const edges = await listOutgoingEdges(acme.id);
    expect(absoluteUrl(routes.share(acme.slug))).toBe(
      "http://localhost:3000/share/acme",
    );
    // The share text names the tools and stops. No slogan riding along.
    expect(stackShareText(acme, edges)).toBe(
      "Acme runs on Tally, Plausible and Loops.",
    );
  });
});

/* 18 --------------------------------------------------------------------- */
describe("the effective K-factor", () => {
  it("is zero before anything has been reached or claimed", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [
        { website: "tally.so", name: "Tally" },
        { website: "plausible.io", name: "Plausible" },
      ],
    });

    const m = await getFlywheelMetrics();
    expect(m.funnel.vendorsIdentified).toBe(2);
    expect(m.contactableRate).toBe(0);
    expect(m.kFactor).toBe(0);
    expect(m.selfSustaining).toBe(false);
  });

  it("multiplies all four factors, and contactability can kill it", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [
        { website: "tally.so", name: "Tally" },
        { website: "plausible.io", name: "Plausible" },
        // An incumbent: in the graph, out of the maths.
        { website: "stripe.com", name: "Stripe" },
      ],
    });
    const m = await getFlywheelMetrics();

    // Acme is claimed and has three edges. Only two of them do a job, and the
    // K numerator counts jobs, not rows — Stripe is in the graph, out of the
    // maths.
    expect(m.claimedVendors).toBe(1);
    expect(m.edgesPerClaimedVendor).toBe(2);
    expect(m.edges.acquisition).toBe(2);
    expect(m.edges.stackOnly).toBe(1);

    // Nobody was reachable, so nothing propagates however good the graph looks.
    expect(m.contactableRate).toBe(0);
    expect(m.kFactor).toBe(0);
  });

  it("reports a healthy K when vendors are reachable and do claim", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");

    // Four reachable independent vendors, all credited by Acme.
    await submitStack({
      companyId: acme.id,
      tools: [
        { website: "tally.so", name: "Tally" },
        { website: "loops.so", name: "Loops" },
        { website: "northwind.dev", name: "Northwind" },
        { website: "kettle.app", name: "Kettle" },
      ],
    });

    // Contact routes found for those four, invitations delivered.
    for (const domain of ["tally.so", "loops.so", "northwind.dev", "kettle.app"]) {
      const vendor = (await getCompanyByDomain(domain))!;
      await updateCompany(vendor.id, { contactEmail: `hi@${domain}` });
      await notifyMention({
        vendorId: vendor.id,
        mentionedById: acme.id,
        force: true,
      });
    }

    // All four verify and contribute their own stacks.
    for (const domain of ["tally.so", "loops.so", "northwind.dev", "kettle.app"]) {
      const vendor = await verifyIdentity(
        (await getCompanyByDomain(domain))!,
      );
      await submitStack({
        companyId: vendor.id,
        tools: [
          { website: `a-${domain}`, name: "A" },
          { website: `b-${domain}`, name: "B" },
          { website: `c-${domain}`, name: "C" },
          { website: `d-${domain}`, name: "D" },
        ],
      });
    }

    // Their own four vendors each turn out to be reachable too, so the whole
    // identified population is contactable.
    await makeEveryMentionedVendorContactable();

    const m = await getFlywheelMetrics();
    expect(m.contactableRate).toBe(1);
    expect(m.notificationToClaimRate).toBe(1);
    expect(m.claimToContributionRate).toBe(1);
    expect(m.edgesPerClaimedVendor).toBe(4);
    expect(m.kFactor).toBeGreaterThanOrEqual(1);
    expect(m.selfSustaining).toBe(true);

    // Third generation exists and has claimed: the thesis holding.
    expect(m.deepestClaimedGeneration).toBeGreaterThanOrEqual(1);
    expect(m.generations.find((g) => g.generation === 2)?.total).toBe(16);
    expect(m.medianCycleHours).not.toBeNull();
  });
});

/* 19 --------------------------------------------------------------------- */
describe("settleClaim is idempotent", () => {
  it("does not re-claim or double-count an already claimed company", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [
        { website: "tally.so", name: "Tally" },
        { website: "loops.so", name: "Loops" },
      ],
    });
    const claimed = (await getCompanyByDomain("acme.dev"))!;
    const first = claimed.claimedAt;

    const again = await settleClaim(claimed);
    expect(again.claimCompleted).toBe(false);
    expect((await getCompanyByDomain("acme.dev"))!.claimedAt).toBe(first);
    expect(await countUpstreamCredits(claimed.id)).toBe(2);
  });
});

/* 20 --------------------------------------------------------------------- */
describe("tools spotted on a website are not relationships", () => {
  it("stores them without creating an edge, a credit or a notification", async () => {
    const { company } = await addCompany({
      url: "olva.ai",
      name: "Olva",
      source: "MENTIONED",
    });

    const withSignals = await updateCompany(company.id, {
      detectedStack: [
        { domain: "vercel.com", name: "Vercel" },
        { domain: "plausible.io", name: "Plausible" },
      ],
      detectedAt: new Date().toISOString(),
      detectedFrom: "website",
    });

    // They come back as data…
    expect(withSignals!.detectedStack).toEqual([
      { domain: "vercel.com", name: "Vercel" },
      { domain: "plausible.io", name: "Plausible" },
    ]);

    // …and they are nothing else. No edges, so no proof anywhere, no claim
    // progress, no profiles conjured for them, and nobody written to.
    expect(await countRows("relationships")).toBe(0);
    expect(await listOutgoingEdges(company.id)).toHaveLength(0);
    expect(await countUpstreamCredits(company.id)).toBe(0);
    expect((await getClaimProgress(withSignals!)).upstream).toBe(0);
    expect(await getCompanyByDomain("vercel.com")).toBeNull();
    expect(await getCompanyByDomain("plausible.io")).toBeNull();
    expect(await countRows("notifications")).toBe(0);
  });

  it("survives a malformed row rather than taking the profile down", async () => {
    const { company } = await addCompany({
      url: "olva.ai",
      name: "Olva",
      source: "MENTIONED",
    });

    const { getDb } = await import("@/lib/db/client");
    for (const value of ["not json", "{}", "[]", '[{"name":"No domain"}]']) {
      await getDb().execute({
        sql: `UPDATE companies SET detected_stack = ? WHERE id = ?`,
        args: [value, company.id],
      });
      expect((await getCompanyByDomain("olva.ai"))!.detectedStack).toBeNull();
    }
  });
});

/* 21 --------------------------------------------------------------------- */
describe("a credit can be withdrawn by whoever gave it", () => {
  it("removes the edge and the profile it conjured", async () => {
    // The real case: apolo.io typed for apollo.io, and the graph created a
    // profile for a Costa Rican payments company and said SourcrLab runs on it.
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [
        { website: "apolo.io", name: "Apolo" },
        { website: "plausible.io", name: "Plausible" },
      ],
    });
    expect((await getCompanyByDomain("acme.dev"))!.status).toBe("CLAIMED");

    const wrong = (await getCompanyByDomain("apolo.io"))!;
    expect(wrong.source).toBe("MENTIONED");

    const edge = (await listOutgoingEdges(acme.id)).find(
      (e) => e.target.domain === "apolo.io",
    )!;

    const { deleteRelationship, deleteOrphanedMention } = await import(
      "@/lib/db/queries"
    );
    await deleteRelationship(edge.id);
    expect(await deleteOrphanedMention(wrong.id)).toBe(true);

    // Gone from both sides, and the profile nobody asked for is gone too.
    expect(await getCompanyByDomain("apolo.io")).toBeNull();
    expect(await listOutgoingEdges(acme.id)).toHaveLength(1);
  });

  it("keeps a claim that was already earned", async () => {
    // A claim undone by later editing would depend on your current stack
    // rather than on having shown it, which punishes an honest correction.
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [
        { website: "tally.so", name: "Tally" },
        { website: "plausible.io", name: "Plausible" },
      ],
    });

    const edge = (await listOutgoingEdges(acme.id))[0];
    const { deleteRelationship } = await import("@/lib/db/queries");
    await deleteRelationship(edge.id);

    const after = (await getCompanyByDomain("acme.dev"))!;
    expect(after.status).toBe("CLAIMED");
    expect(await countUpstreamCredits(after.id)).toBe(1);
  });

  it("never deletes a profile that is anything more than a mention", async () => {
    const { deleteOrphanedMention } = await import("@/lib/db/queries");

    // Claimed.
    const claimed = await claimProfile(await joinedCompany("one.dev", "One"));
    expect(await deleteOrphanedMention(claimed.id)).toBe(false);

    // Added by its own founder rather than mentioned.
    const self = await joinedCompany("two.dev", "Two");
    expect(await deleteOrphanedMention(self.id)).toBe(false);

    // Mentioned, but identity verified — somebody is on their way in.
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [{ website: "tally.so", name: "Tally" }],
    });
    const tally = await verifyIdentity((await getCompanyByDomain("tally.so"))!);
    const { deleteRelationship } = await import("@/lib/db/queries");
    await deleteRelationship((await listOutgoingEdges(acme.id))[0].id);
    expect(await deleteOrphanedMention(tally.id)).toBe(false);
    expect(await getCompanyByDomain("tally.so")).not.toBeNull();
  });

  it("never deletes a profile something else still points at", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    const kettle = await joinedCompany("kettle.app", "Kettle");
    for (const company of [acme, kettle]) {
      await submitStack({
        companyId: company.id,
        tools: [{ website: "tally.so", name: "Tally" }],
      });
    }

    const tally = (await getCompanyByDomain("tally.so"))!;
    const { deleteRelationship, deleteOrphanedMention } = await import(
      "@/lib/db/queries"
    );
    // Acme retracts; Kettle still says it uses Tally.
    await deleteRelationship((await listOutgoingEdges(acme.id))[0].id);
    expect(await deleteOrphanedMention(tally.id)).toBe(false);
    expect(await getCompanyByDomain("tally.so")).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* a hosted page never becomes a vendor                                       */
/* -------------------------------------------------------------------------- */

describe("crediting a page on somebody else's platform", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("refuses it, and creates no profile owning the platform's domain", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");

    await expect(
      submitStack({
        companyId: acme.id,
        tools: [{ website: "https://tally.so/r/MevyAE", name: "Our feedback form" }],
      }),
    ).rejects.toBeInstanceOf(StackValidationError);

    // The damage this prevents: a profile that owns tally.so without being
    // Tally, which every later credit to Tally would then be pointed at.
    expect(await getCompanyByDomain("tally.so")).toBeNull();
    expect(await listOutgoingEdges(acme.id)).toHaveLength(0);
  });

  it("keeps the good tools in the same submission and reports the bad one", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");

    const result = await submitStack({
      companyId: acme.id,
      tools: [
        { website: "plausible.io", name: "Plausible" },
        { website: "https://tally.so/r/MevyAE", name: "Our feedback form" },
      ],
    });

    expect(result.connections).toHaveLength(1);
    expect(result.connections[0].company.domain).toBe("plausible.io");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("tally.so");
    expect(await getCompanyByDomain("tally.so")).toBeNull();
  });

  it("still lets a company credit the platform itself", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");

    const result = await submitStack({
      companyId: acme.id,
      tools: [{ website: "tally.so", name: "Tally" }],
    });

    expect(result.errors).toHaveLength(0);
    const tally = await getCompanyByDomain("tally.so");
    expect(tally).not.toBeNull();
    expect(tally!.name).toBe("Tally");
  });

  it("two companies crediting Tally land on the same Tally", async () => {
    // The property the production row broke: one domain, one vendor.
    const acme = await joinedCompany("acme.dev", "Acme");
    const beta = await joinedCompany("beta.dev", "Beta");

    await submitStack({
      companyId: acme.id,
      tools: [{ website: "https://tally.so", name: "Tally" }],
    });
    await submitStack({
      companyId: beta.id,
      tools: [{ website: "www.tally.so/", name: "Tally" }],
    });

    const tally = await getCompanyByDomain("tally.so");
    expect(tally).not.toBeNull();
    expect(await listIncomingEdges(tally!.id)).toHaveLength(2);
    expect(await countRows("companies")).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */
/* the network page groups                                                    */
/* -------------------------------------------------------------------------- */

describe("how the network page groups a profile", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("puts a self-added company with no credits outside Credited", async () => {
    // The production shape: somebody added their company, never finished, and
    // nobody has ever said they use it. It is not "credited" by anything.
    await joinedCompany("lonely.dev", "Lonely");

    const credited = await listCreditedCompanies(60);
    const joined = await listJoinedCompanies(60);
    const totals = await getNetworkGroupCounts();

    expect(credited.map((c) => c.domain)).not.toContain("lonely.dev");
    expect(joined.map((c) => c.domain)).toContain("lonely.dev");
    expect(totals.credited).toBe(0);
    expect(totals.joined).toBe(1);
  });

  it("moves it into Credited the moment somebody credits it", async () => {
    const lonely = await joinedCompany("lonely.dev", "Lonely");
    const acme = await joinedCompany("acme.dev", "Acme");

    await submitStack({
      companyId: acme.id,
      tools: [{ website: "lonely.dev", name: "Lonely" }],
    });

    const credited = await listCreditedCompanies(60);
    const totals = await getNetworkGroupCounts();

    expect(credited.map((c) => c.id)).toContain(lonely.id);
    expect((await listJoinedCompanies(60)).map((c) => c.id)).not.toContain(
      lonely.id,
    );
    expect(totals.credited).toBe(1);
  });

  it("counts an imported profile as credited once a company names it", async () => {
    // Crisp's shape: source LAUNCHLLAMA, but a real company says it uses it.
    const { company: imported } = await addCompany({
      url: "crisp.chat",
      name: "Crisp",
      source: "LAUNCHLLAMA",
      status: "UNCLAIMED",
    });
    const acme = await joinedCompany("acme.dev", "Acme");

    expect((await getNetworkGroupCounts()).sourced).toBe(1);

    await submitStack({
      companyId: acme.id,
      tools: [{ website: "crisp.chat", name: "Crisp" }],
    });

    const totals = await getNetworkGroupCounts();
    expect((await listCreditedCompanies(60)).map((c) => c.id)).toContain(
      imported.id,
    );
    expect(totals.sourced).toBe(0);
    expect(totals.credited).toBe(1);
  });

  it("drops it back out of Credited when the vendor disputes the edge", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [{ website: "vendor.dev", name: "Vendor" }],
    });
    const vendor = (await getCompanyByDomain("vendor.dev"))!;
    expect((await getNetworkGroupCounts()).credited).toBe(1);

    const [edge] = await listIncomingEdges(vendor.id);
    await setRelationshipState(edge.id, "DISPUTED");

    const totals = await getNetworkGroupCounts();
    expect((await listCreditedCompanies(60)).map((c) => c.id)).not.toContain(
      vendor.id,
    );
    expect(totals.credited).toBe(0);
  });

  it("every profile lands in exactly one group", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    await joinedCompany("lonely.dev", "Lonely");
    await addCompany({ url: "imported.dev", name: "Imported", source: "LAUNCHLLAMA" });
    await submitStack({
      companyId: acme.id,
      tools: [
        { website: "vendor.dev", name: "Vendor" },
        { website: "stripe.com", name: "Stripe" },
      ],
    });
    await claimProfile(acme);

    const totals = await getNetworkGroupCounts();
    const sum =
      totals.claimed +
      totals.credited +
      totals.joined +
      totals.sourced +
      totals.incumbents;

    expect(sum).toBe(await countRows("companies"));
  });
});

/* -------------------------------------------------------------------------- */
/* the acquisition funnel                                                     */
/* -------------------------------------------------------------------------- */

describe("the acquisition funnel", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("counts nothing before anything has happened", async () => {
    expect(await getAcquisitionFunnel()).toEqual({
      selfAdded: 0,
      verifiedClaims: 0,
      outgoingCredits: 0,
      mentionedProfiles: 0,
      followOnClaims: 0,
      attribution: { clicked: 0, invited: 0, organic: 0 },
    });
  });

  it("follows one company through every step", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");

    expect((await getAcquisitionFunnel()).selfAdded).toBe(1);
    expect((await getAcquisitionFunnel()).verifiedClaims).toBe(0);

    await submitStack({
      companyId: acme.id,
      tools: [
        { website: "plausible.io", name: "Plausible" },
        { website: "tally.so", name: "Tally" },
      ],
    });

    const funnel = await getAcquisitionFunnel();
    expect(funnel.selfAdded).toBe(1);
    // Two eligible credits is the whole claim, so it completed here.
    expect(funnel.verifiedClaims).toBe(1);
    expect(funnel.outgoingCredits).toBe(2);
    expect(funnel.mentionedProfiles).toBe(2);
    expect(funnel.followOnClaims).toBe(0);
  });

  it("counts the second turn only when a credited profile claims", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [
        { website: "plausible.io", name: "Plausible" },
        { website: "tally.so", name: "Tally" },
      ],
    });

    const tally = (await getCompanyByDomain("tally.so"))!;
    expect(tally.source).toBe("MENTIONED");
    expect((await getAcquisitionFunnel()).followOnClaims).toBe(0);

    await claimProfile(tally);

    const funnel = await getAcquisitionFunnel();
    expect(funnel.followOnClaims).toBe(1);
    // A mentioned profile claiming is not a self-add: the distinction is the
    // whole point of the number.
    expect(funnel.selfAdded).toBe(1);
    expect(funnel.verifiedClaims).toBe(1);
  });

  it("does not count a disputed edge as a credit given", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [{ website: "vendor.dev", name: "Vendor" }],
    });
    expect((await getAcquisitionFunnel()).outgoingCredits).toBe(1);

    const vendor = (await getCompanyByDomain("vendor.dev"))!;
    const [edge] = await listIncomingEdges(vendor.id);
    await setRelationshipState(edge.id, "DISPUTED");

    expect((await getAcquisitionFunnel()).outgoingCredits).toBe(0);
  });

  it("leaves imported profiles out of the self-add step", async () => {
    await addCompany({ url: "imported.dev", name: "Imported", source: "LAUNCHLLAMA" });
    await addCompany({ url: "seeded.dev", name: "Seeded", source: "SEED" });
    await joinedCompany("acme.dev", "Acme");

    const funnel = await getAcquisitionFunnel();
    expect(funnel.selfAdded).toBe(1);
    expect(funnel.mentionedProfiles).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* what we ask to have indexed                                                */
/* -------------------------------------------------------------------------- */

describe("the sitemap", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("leaves out a profile with nothing on it at all", async () => {
    // No description, no about, no capability, no edge: a name and a line
    // saying nobody has said anything. The only genuinely thin shape here.
    await joinedCompany("lonely.dev", "Lonely");
    expect(await listAllCompanySlugs()).toHaveLength(0);
  });

  it("keeps an unclaimed profile that has something to read", async () => {
    // The imported cohort's shape, and 3,009 of the 3,074 live profiles.
    // Being findable in search is the whole reason these exist, so they
    // stay in the sitemap whether or not anyone has credited them.
    await addCompany({
      url: "imported.dev",
      name: "Imported",
      description: "Turns long videos into searchable transcripts.",
      source: "LAUNCHLLAMA",
      status: "UNCLAIMED",
    });

    expect((await listAllCompanySlugs()).map((r) => r.slug)).toContain(
      "imported",
    );
  });

  it("includes a profile as soon as it has an edge, either way round", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [{ website: "vendor.dev", name: "Vendor" }],
    });

    const slugs = (await listAllCompanySlugs()).map((row) => row.slug);
    // The company that gave the credit and the one that received it.
    expect(slugs).toContain("acme");
    expect(slugs).toContain("vendor");
  });

  it("leaves out demo rows", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [{ website: "vendor.dev", name: "Vendor" }],
    });
    await getDb().execute({
      sql: `UPDATE companies SET is_demo = 1 WHERE id = ?`,
      args: [acme.id],
    });

    const slugs = (await listAllCompanySlugs()).map((row) => row.slug);
    expect(slugs).not.toContain("acme");
  });

  it("reports when the profile last changed, not when it was created", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    const created = acme.createdAt;

    await submitStack({
      companyId: acme.id,
      tools: [{ website: "vendor.dev", name: "Vendor" }],
    });

    const entry = (await listAllCompanySlugs()).find((r) => r.slug === "acme")!;
    // A new edge is exactly the change a crawler should come back for.
    expect(entry.updatedAt >= created).toBe(true);
  });

  it("drops a profile again when its only edge is disputed", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [{ website: "vendor.dev", name: "Vendor" }],
    });
    const vendor = (await getCompanyByDomain("vendor.dev"))!;
    const [edge] = await listIncomingEdges(vendor.id);
    await setRelationshipState(edge.id, "DISPUTED");

    expect(await listAllCompanySlugs()).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* what brought a credited profile back                                       */
/* -------------------------------------------------------------------------- */

describe("attributing a follow-on claim", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  /** A credited profile, ready to claim. */
  async function creditedVendor() {
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [{ website: "vendor.dev", name: "Vendor" }],
    });
    return (await getCompanyByDomain("vendor.dev"))!;
  }

  it("counts a claim we cannot explain as organic, not as the flywheel", async () => {
    const vendor = await creditedVendor();
    await claimProfile(vendor);

    const { attribution, followOnClaims } = await getAcquisitionFunnel();
    expect(followOnClaims).toBe(1);
    expect(attribution).toEqual({ clicked: 0, invited: 0, organic: 1 });
  });

  it("counts them as clicked when they came through our link", async () => {
    const vendor = await creditedVendor();
    await track("claim_clicked", {
      companyId: vendor.id,
      props: { ref: "email" },
    });
    await claimProfile(vendor);

    const { attribution } = await getAcquisitionFunnel();
    expect(attribution).toEqual({ clicked: 1, invited: 0, organic: 0 });
  });

  it("does not treat an undelivered notification as having reached anyone", async () => {
    // The production setting: no RESEND_API_KEY, so the notification is
    // written with status SENT over the outbox transport and no mail leaves.
    const vendor = await creditedVendor();
    await track("claim_email_sent", {
      companyId: vendor.id,
      props: { transport: "outbox" },
    });
    await claimProfile(vendor);

    const { attribution } = await getAcquisitionFunnel();
    expect(attribution).toEqual({ clicked: 0, invited: 0, organic: 1 });
  });

  it("counts a real email as an invitation", async () => {
    const vendor = await creditedVendor();
    await track("claim_email_sent", {
      companyId: vendor.id,
      props: { transport: "resend" },
    });
    await claimProfile(vendor);

    const { attribution } = await getAcquisitionFunnel();
    expect(attribution).toEqual({ clicked: 0, invited: 1, organic: 0 });
  });

  it("prefers the click when both are present, and counts each company once", async () => {
    const vendor = await creditedVendor();
    await track("claim_email_sent", {
      companyId: vendor.id,
      props: { transport: "resend" },
    });
    await track("claim_clicked", { companyId: vendor.id, props: { ref: "email" } });
    await claimProfile(vendor);

    const { attribution, followOnClaims } = await getAcquisitionFunnel();
    expect(attribution).toEqual({ clicked: 1, invited: 0, organic: 0 });
    expect(attribution.clicked + attribution.invited + attribution.organic).toBe(
      followOnClaims,
    );
  });

  it("ignores a click that only happened after the claim", async () => {
    const vendor = await creditedVendor();
    const claimed = await claimProfile(vendor);
    // Tracked with a timestamp strictly after claimed_at.
    await getDb().execute({
      sql: `INSERT INTO events (id, name, company_id, target_company_id, props, created_at)
            VALUES (?, 'claim_clicked', ?, NULL, NULL, ?)`,
      args: [
        "later-click",
        vendor.id,
        new Date(Date.parse(claimed.claimedAt!) + 60_000).toISOString(),
      ],
    });

    const { attribution } = await getAcquisitionFunnel();
    expect(attribution).toEqual({ clicked: 0, invited: 0, organic: 1 });
  });

  it("never attributes a self-added company's own claim to the loop", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    await track("claim_clicked", { companyId: acme.id, props: { ref: "email" } });
    await submitStack({
      companyId: acme.id,
      tools: [
        { website: "plausible.io", name: "Plausible" },
        { website: "tally.so", name: "Tally" },
      ],
    });

    const { attribution, followOnClaims, verifiedClaims } =
      await getAcquisitionFunnel();
    expect(verifiedClaims).toBe(1);
    // They were never a MENTIONED profile, so they are not a second turn.
    expect(followOnClaims).toBe(0);
    expect(attribution).toEqual({ clicked: 0, invited: 0, organic: 0 });
  });
});
