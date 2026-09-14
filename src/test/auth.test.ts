import { beforeEach, describe, expect, it } from "vitest";
import { resetDatabase } from "./helpers";
import { domainProvesOwnership, settleOwnership } from "@/lib/auth/claim";
import {
  addMember,
  companyHasMembers,
  createLoginToken,
  createSession,
  getMembership,
  getSessionUser,
  listMemberships,
  spendLoginToken,
  upsertUser,
} from "@/lib/auth/store";
import { addCompany } from "@/lib/network";
import { getCompanyByDomain } from "@/lib/db/queries";

beforeEach(async () => {
  await resetDatabase();
});

async function company(domain: string, name: string) {
  const { company } = await addCompany({
    url: domain,
    name,
    source: "SEED",
    status: "UNCLAIMED",
  });
  return company;
}

/* -------------------------------------------------------------------------- */
describe("whether an address proves ownership of a domain", () => {
  it("accepts the company's own domain and its subdomains", () => {
    for (const email of ["sam@acme.dev", "sam@mail.acme.dev"]) {
      expect(domainProvesOwnership(email, "acme.dev").proves, email).toBe(true);
    }
    // Listed under a subdomain is our imprecision, not theirs.
    expect(domainProvesOwnership("sam@acme.dev", "app.acme.dev").proves).toBe(true);
  });

  it("refuses a free mailbox, and says that is why", () => {
    for (const email of ["sam@gmail.com", "sam@outlook.com", "sam@proton.me"]) {
      const result = domainProvesOwnership(email, "acme.dev");
      expect(result.proves, email).toBe(false);
      expect(result.freeMailbox, email).toBe(true);
    }
  });

  it("refuses a lookalike domain that merely shares a suffix", () => {
    // The attack this exists to stop.
    for (const [email, domain] of [
      ["sam@notacme.dev", "acme.dev"],
      ["sam@acme.dev.evil.com", "acme.dev"],
      ["sam@acme.dev", "notacme.dev"],
      ["sam@evilacme.dev", "acme.dev"],
    ] as const) {
      expect(domainProvesOwnership(email, domain).proves, `${email} / ${domain}`).toBe(
        false,
      );
    }
  });

  it("refuses nonsense rather than throwing", () => {
    expect(domainProvesOwnership("", "acme.dev").proves).toBe(false);
    expect(domainProvesOwnership("sam@acme.dev", "").proves).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
describe("settling ownership", () => {
  it("approves a work address on the company's domain and writes the membership", async () => {
    const acme = await company("acme.dev", "Acme");
    const user = await upsertUser({ email: "sam@acme.dev", provider: "google" });

    const outcome = await settleOwnership({ user, companyId: acme.id });
    expect(outcome).toEqual({ status: "APPROVED", reason: "DOMAIN_MATCH" });

    expect(await getMembership(user.id, acme.id)).not.toBeNull();
    expect((await getCompanyByDomain("acme.dev"))!.status).toBe("CLAIMED");
  });

  it("leaves a free-mailbox claim pending, and grants nothing", async () => {
    const acme = await company("acme.dev", "Acme");
    const user = await upsertUser({ email: "sam@gmail.com", provider: "google" });

    const outcome = await settleOwnership({ user, companyId: acme.id });
    expect(outcome).toEqual({ status: "PENDING", reason: "FREE_EMAIL" });

    // Pending must never look like ownership.
    expect(await getMembership(user.id, acme.id)).toBeNull();
    expect(await companyHasMembers(acme.id)).toBe(false);
    expect((await getCompanyByDomain("acme.dev"))!.status).toBe("UNCLAIMED");
  });

  it("leaves a mismatched work address pending", async () => {
    const acme = await company("acme.dev", "Acme");
    const user = await upsertUser({ email: "sam@other.dev", provider: "email" });
    expect(await settleOwnership({ user, companyId: acme.id })).toEqual({
      status: "PENDING",
      reason: "DOMAIN_MISMATCH",
    });
  });

  it("refuses to hand a managed company to a stranger", async () => {
    const acme = await company("acme.dev", "Acme");
    const owner = await upsertUser({ email: "sam@acme.dev", provider: "google" });
    await settleOwnership({ user: owner, companyId: acme.id });

    // Even with a matching domain: first claim wins, the rest is a support
    // conversation rather than a takeover.
    const other = await upsertUser({ email: "eve@acme.dev", provider: "google" });
    expect(await settleOwnership({ user: other, companyId: acme.id })).toEqual({
      status: "REFUSED",
      reason: "ALREADY_CLAIMED",
    });
    expect(await getMembership(other.id, acme.id)).toBeNull();
  });

  it("is idempotent for the owner, so a second visit is not a second claim", async () => {
    const acme = await company("acme.dev", "Acme");
    const user = await upsertUser({ email: "sam@acme.dev", provider: "google" });

    await settleOwnership({ user, companyId: acme.id });
    expect(await settleOwnership({ user, companyId: acme.id })).toEqual({
      status: "APPROVED",
      reason: "ALREADY_MEMBER",
    });
    expect(await listMemberships(user.id)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
describe("identity survives the browser", () => {
  it("is the same person through either door", async () => {
    const viaLink = await upsertUser({ email: "Sam@Acme.dev", provider: "email" });
    const viaGoogle = await upsertUser({
      email: "sam@acme.dev",
      name: "Sam",
      provider: "google",
    });
    expect(viaGoogle.id).toBe(viaLink.id);
    expect(viaGoogle.email).toBe("sam@acme.dev");
  });

  it("never overwrites a name we already have", async () => {
    await upsertUser({ email: "sam@acme.dev", name: "Sam Rivera", provider: "email" });
    const again = await upsertUser({
      email: "sam@acme.dev",
      name: "S. R.",
      provider: "google",
    });
    expect(again.name).toBe("Sam Rivera");
  });

  it("finds the same companies from a new session", async () => {
    const acme = await company("acme.dev", "Acme");
    const user = await upsertUser({ email: "sam@acme.dev", provider: "google" });
    await settleOwnership({ user, companyId: acme.id });

    // A different machine: a fresh session row, same membership.
    const session = await createSession(user.id);
    const seen = await getSessionUser(session);
    expect(seen!.id).toBe(user.id);
    expect(await listMemberships(seen!.id)).toHaveLength(1);
  });

  it("rejects an unknown or expired session", async () => {
    expect(await getSessionUser("nope")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
describe("sign-in links", () => {
  it("remembers what was being claimed, so nothing restarts after login", async () => {
    const acme = await company("acme.dev", "Acme");
    const token = await createLoginToken({
      email: "sam@acme.dev",
      intentCompanyId: acme.id,
    });
    const spent = await spendLoginToken(token.token);
    expect(spent!.intentCompanyId).toBe(acme.id);
  });

  it("works exactly once", async () => {
    const token = await createLoginToken({ email: "sam@acme.dev" });
    expect(await spendLoginToken(token.token)).not.toBeNull();
    // A forwarded link is already spent.
    expect(await spendLoginToken(token.token)).toBeNull();
  });

  it("refuses an unknown token", async () => {
    expect(await spendLoginToken("nope")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
describe("membership is the authority", () => {
  it("does not leak one company's membership into another", async () => {
    const acme = await company("acme.dev", "Acme");
    const other = await company("kettle.app", "Kettle");
    const user = await upsertUser({ email: "sam@acme.dev", provider: "google" });
    await addMember({ userId: user.id, companyId: acme.id });

    expect(await getMembership(user.id, acme.id)).not.toBeNull();
    expect(await getMembership(user.id, other.id)).toBeNull();
  });

  it("does not duplicate a membership", async () => {
    const acme = await company("acme.dev", "Acme");
    const user = await upsertUser({ email: "sam@acme.dev", provider: "google" });
    await addMember({ userId: user.id, companyId: acme.id });
    await addMember({ userId: user.id, companyId: acme.id });
    expect(await listMemberships(user.id)).toHaveLength(1);
  });
});
