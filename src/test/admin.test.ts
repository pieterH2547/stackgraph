import { beforeEach, describe, expect, it } from "vitest";
import { claimProfile, countRows, joinedCompany, resetDatabase } from "./helpers";
import { getDb } from "@/lib/db/client";
import {
  deleteCompany,
  getCompanyByDomain,
  getCompanyById,
  listIncomingEdges,
  listOutgoingEdges,
} from "@/lib/db/queries";
import { submitStack } from "@/lib/network";
import {
  addMember,
  createLoginToken,
  getMembership,
  spendLoginToken,
  upsertUser,
} from "@/lib/auth/store";

beforeEach(async () => {
  await resetDatabase();
});

/**
 * The shape of the real case this was built for: somebody claims a profile
 * they should not have, names two tools, and one of those tools is a profile
 * that exists only because they typed it.
 */
async function graph() {
  // Acme claims by naming Tally and Plausible; both profiles are conjured.
  const acme = await joinedCompany("acme.dev", "Acme");
  await submitStack({
    companyId: acme.id,
    tools: [
      { website: "tally.so", name: "Tally" },
      { website: "plausible.io", name: "Plausible" },
    ],
  });
  // Kettle also names Tally, so Tally is more than Acme's word.
  const kettle = await claimProfile(await joinedCompany("kettle.app", "Kettle"));
  await submitStack({
    companyId: kettle.id,
    tools: [{ website: "tally.so", name: "Tally" }],
  });
  // Northwind says it uses Acme.
  const northwind = await joinedCompany("northwind.dev", "Northwind");
  await submitStack({
    companyId: northwind.id,
    tools: [{ existingCompanyId: acme.id }],
  });

  const owner = await upsertUser({ email: "sam@acme.dev", provider: "email" });
  await addMember({ userId: owner.id, companyId: acme.id });
  const token = await createLoginToken({
    email: "sam@acme.dev",
    intentCompanyId: acme.id,
    claimDraft: JSON.stringify({ companyId: acme.id, name: "Acme Inc" }),
  });

  return {
    acme: (await getCompanyById(acme.id))!,
    kettle,
    northwind,
    owner,
    token,
  };
}

describe("removing a company from admin", () => {
  it("takes the company, its edges in both directions and what only it conjured", async () => {
    const { acme, northwind, owner, token } = await graph();
    expect(acme.status).toBe("CLAIMED");
    expect(await countRows("relationships")).toBe(4);

    const result = await deleteCompany(acme.id);
    expect(result?.removed.domain).toBe("acme.dev");
    expect(result?.edges).toBe(3);
    expect(result?.alsoRemoved.map((c) => c.domain)).toEqual(["plausible.io"]);

    // The company and both directions of its edges are gone.
    expect(await getCompanyByDomain("acme.dev")).toBeNull();
    expect(await listOutgoingEdges(northwind.id)).toHaveLength(0);

    // Plausible existed only on Acme's word; Tally is also Kettle's word.
    expect(await getCompanyByDomain("plausible.io")).toBeNull();
    const tally = (await getCompanyByDomain("tally.so"))!;
    expect((await listIncomingEdges(tally.id)).map((e) => e.source.domain)).toEqual([
      "kettle.app",
    ]);
    expect(await countRows("relationships")).toBe(1);

    // Nobody else's claim or profile was touched.
    expect((await getCompanyByDomain("kettle.app"))!.status).toBe("CLAIMED");
    expect(await getCompanyByDomain("northwind.dev")).not.toBeNull();

    // Ownership, the sign-in intent and the funnel no longer mention it.
    expect(await getMembership(owner.id, acme.id)).toBeNull();
    expect(await countRows("company_members")).toBe(0);
    const spent = await spendLoginToken(token.token);
    expect(spent).not.toBeNull();
    expect(spent!.intentCompanyId).toBeNull();
    expect(spent!.claimDraft).toBeNull();
    const { rows } = await getDb().execute({
      sql: `SELECT COUNT(*) AS n FROM events WHERE company_id = ?1 OR target_company_id = ?1`,
      args: [acme.id],
    });
    expect(Number(rows[0]?.n)).toBe(0);
    expect(await countRows("claims")).toBe(0);
  });

  it("answers null for a company that is not there", async () => {
    expect(await deleteCompany("nope")).toBeNull();
  });

  it("never takes a conjured profile that somebody else credits, claimed, or added", async () => {
    const acme = await joinedCompany("acme.dev", "Acme");
    const loops = await claimProfile(await joinedCompany("loops.so", "Loops"));
    await submitStack({
      companyId: acme.id,
      tools: [
        { existingCompanyId: loops.id },
        { website: "resend.com", name: "Resend" },
      ],
    });
    const other = await joinedCompany("other.dev", "Other");
    await submitStack({
      companyId: other.id,
      tools: [{ website: "resend.com", name: "Resend" }],
    });

    const result = await deleteCompany(acme.id);
    expect(result?.alsoRemoved).toEqual([]);
    expect(await getCompanyByDomain("loops.so")).not.toBeNull();
    expect(await getCompanyByDomain("resend.com")).not.toBeNull();
    expect(await listOutgoingEdges(other.id)).toHaveLength(1);
  });
});
