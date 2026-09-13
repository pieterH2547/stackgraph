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
  countDownstreamCredits,
  countIncomingOnNetwork,
  countUpstreamCredits,
  getCompanyByDomain,
  getCompanyBySlug,
  listIncomingEdges,
  listOutgoingEdges,
  searchCompanies,
  updateCompany,
} from "@/lib/db/queries";
import {
  addCompany,
  classifyEdge,
  getClaimProgress,
  getProfile,
  settleClaim,
  StackValidationError,
  submitCustomers,
  submitStack,
} from "@/lib/network";
import { assessEligibility } from "@/lib/eligibility";
import { composeMentionEmail, notifyMention } from "@/lib/notify";
import { getFlywheelMetrics } from "@/lib/metrics";
import { REQUIRED_DOWNSTREAM, REQUIRED_UPSTREAM } from "@/lib/limits";
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

/* 2 ----------------------------------------------------------------------- */
describe("the claim gate: both sides of the company", () => {
  it("stays unclaimed on identity alone", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    expect(acme.claimVerifiedAt).not.toBeNull();
    expect(acme.status).toBe("UNCLAIMED");

    const progress = await getClaimProgress(acme);
    expect(progress.identityVerified).toBe(true);
    expect(progress.complete).toBe(false);
    expect(progress.upstreamShort).toBe(REQUIRED_UPSTREAM);
    expect(progress.downstreamShort).toBe(REQUIRED_DOWNSTREAM);
  });

  it("stays unclaimed with only the upstream half", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    const result = await submitStack({
      companyId: acme.id,
      tools: [
        { website: "tally.so", name: "Tally" },
        { website: "plausible.io", name: "Plausible" },
      ],
    });

    expect(result.progress.upstream).toBe(2);
    expect(result.progress.downstream).toBe(0);
    expect(result.claimCompleted).toBe(false);
    expect(result.company.status).toBe("UNCLAIMED");
  });

  it("completes the claim on 2 + 2, and nobody named has to confirm", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [
        { website: "tally.so", name: "Tally" },
        { website: "plausible.io", name: "Plausible" },
      ],
    });

    const result = await submitCustomers({
      companyId: acme.id,
      customers: [
        { website: "northwind.dev", name: "Northwind" },
        { website: "kettle.app", name: "Kettle" },
      ],
    });

    expect(result.claimCompleted).toBe(true);
    expect(result.company.status).toBe("CLAIMED");
    expect(result.company.claimedAt).not.toBeNull();

    // The four companies named are all still unclaimed — their confirmation
    // was never required.
    for (const domain of [
      "tally.so",
      "plausible.io",
      "northwind.dev",
      "kettle.app",
    ]) {
      expect((await getCompanyByDomain(domain))!.status).toBe("UNCLAIMED");
    }
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
      kind: "USES_YOU",
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

/* 9 + 10 ------------------------------------------------------------------ */
describe("a mentioned vendor can claim and start the next generation", () => {
  it("sends a verified vendor straight back into the flywheel", () => {
    expect(postClaimDestination("tally")).toBe("/stack/tally?after=claim");
    expect(postClaimDestination("tally")).toContain(routes.stack("tally"));
  });

  it("claims on 2 + 2 and creates a third generation", async () => {
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

    await submitStack({
      companyId: tally.id,
      tools: [
        { website: "posthog.com", name: "PostHog" },
        { website: "resend.com", name: "Resend" },
      ],
    });
    const finished = await submitCustomers({
      companyId: tally.id,
      customers: [
        { existingCompanyId: acme.id },
        { website: "kettle.app", name: "Kettle" },
      ],
    });

    expect(finished.claimCompleted).toBe(true);
    expect(finished.company.status).toBe("CLAIMED");

    const posthog = (await getCompanyByDomain("posthog.com"))!;
    const kettle = (await getCompanyByDomain("kettle.app"))!;
    expect(posthog.generation).toBe(2);
    expect(kettle.generation).toBe(2);
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

  it("writes to a named customer with the other trigger", async () => {
    const tally = await joinedCompany("tally.so", "Tally");
    await submitCustomers({
      companyId: tally.id,
      customers: [{ website: "acme.dev", name: "Acme" }],
    });

    const acme = (await getCompanyByDomain("acme.dev"))!;
    const notification = (await notificationsFor(acme.id))[0];
    expect(notification.subject).toBe("Tally says you use their product");
    expect(notification.body).toContain("confirm or correct");
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

/* 14 --------------------------------------------------------------------- */
describe("a profile shows both sides, and says whose word each is", () => {
  it("separates powered-by from used-by and attributes both", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    await submitStack({
      companyId: acme.id,
      tools: [{ website: "tally.so", name: "Tally" }],
    });

    const tally = await verifyIdentity(
      (await getCompanyByDomain("tally.so"))!,
    );
    await submitStack({
      companyId: tally.id,
      tools: [{ website: "resend.com", name: "Resend" }],
    });
    await submitCustomers({
      companyId: tally.id,
      customers: [{ website: "kettle.app", name: "Kettle" }],
    });

    const profile = await getProfile(tally);
    expect(profile.outgoing.map((e) => e.target.domain)).toEqual([
      "resend.com",
    ]);
    expect(profile.incoming.map((e) => e.source.domain).sort()).toEqual([
      "acme.dev",
      "kettle.app",
    ]);

    // Acme said it itself; Kettle was named by Tally.
    const fromAcme = profile.incoming.find(
      (e) => e.source.domain === "acme.dev",
    )!;
    const fromTally = profile.incoming.find(
      (e) => e.source.domain === "kettle.app",
    )!;
    expect(reportedBySource(fromAcme)).toBe(true);
    expect(reportedBySource(fromTally)).toBe(false);
    expect(fromTally.reportedByCompanyId).toBe(tally.id);

    expect(await getCompanyBySlug(tally.slug)).not.toBeNull();
  });

  it("counts only the vendor's own claims towards the downstream half", async () => {
    const tally = await joinedCompany("tally.so", "Tally");
    const acme = await joinedCompany("acme.dev", "Acme");

    // Acme saying it uses Tally is proof for Tally, but it is not Tally's
    // half of the claim — that has to be Tally's own word.
    await submitStack({
      companyId: acme.id,
      tools: [{ existingCompanyId: tally.id }],
    });

    expect(await countDownstreamCredits(tally.id)).toBe(0);

    await submitCustomers({
      companyId: tally.id,
      customers: [{ website: "kettle.app", name: "Kettle" }],
    });
    expect(await countDownstreamCredits(tally.id)).toBe(1);
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
  it("takes a disputed relationship out of the graph without touching a claim", async () => {
    const tally = await joinedCompany("tally.so", "Tally");
    await submitCustomers({
      companyId: tally.id,
      customers: [
        { website: "acme.dev", name: "Acme" },
        { website: "kettle.app", name: "Kettle" },
      ],
    });
    await submitStack({
      companyId: tally.id,
      tools: [
        { website: "resend.com", name: "Resend" },
        { website: "plausible.io", name: "Plausible" },
      ],
    });

    const claimed = (await getCompanyByDomain("tally.so"))!;
    expect(claimed.status).toBe("CLAIMED");

    // Acme disputes: the edge leaves the public graph…
    const acme = (await getCompanyByDomain("acme.dev"))!;
    const edge = (await listOutgoingEdges(acme.id))[0];
    expect(edge.target.id).toBe(tally.id);

    const { deleteRelationship } = await import("@/lib/db/queries");
    await deleteRelationship(edge.id);

    expect(await listOutgoingEdges(acme.id)).toHaveLength(0);
    // …and Tally is still claimed.
    expect((await getCompanyByDomain("tally.so"))!.status).toBe("CLAIMED");
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
    await submitCustomers({
      companyId: acme.id,
      customers: [
        { website: "northwind.dev", name: "Northwind" },
        { website: "kettle.app", name: "Kettle" },
      ],
    });

    const m = await getFlywheelMetrics();

    // Acme is claimed and has five edges, four of which do something.
    expect(m.claimedVendors).toBe(1);
    expect(m.edgesPerClaimedVendor).toBe(4);
    expect(m.edges.acquisition).toBe(4);
    expect(m.edges.stackOnly).toBe(1);

    // Nobody was reachable, so nothing propagates however good the graph looks.
    expect(m.contactableRate).toBe(0);
    expect(m.kFactor).toBe(0);
  });

  it("reports a healthy K when vendors are reachable and do claim", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");

    // Two reachable independent vendors, named by Acme.
    await submitStack({
      companyId: acme.id,
      tools: [
        { website: "tally.so", name: "Tally" },
        { website: "loops.so", name: "Loops" },
      ],
    });
    await submitCustomers({
      companyId: acme.id,
      customers: [
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

    // All four verify and finish both halves.
    for (const domain of ["tally.so", "loops.so", "northwind.dev", "kettle.app"]) {
      const vendor = await verifyIdentity(
        (await getCompanyByDomain(domain))!,
      );
      await submitStack({
        companyId: vendor.id,
        tools: [
          { website: `a-${domain}`, name: "A" },
          { website: `b-${domain}`, name: "B" },
        ],
      });
      await submitCustomers({
        companyId: vendor.id,
        customers: [
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
    await submitCustomers({
      companyId: acme.id,
      customers: [
        { website: "northwind.dev", name: "Northwind" },
        { website: "kettle.app", name: "Kettle" },
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
