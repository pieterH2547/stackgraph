import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countRows, joinedCompany, resetDatabase } from "./helpers";
import {
  addDestination,
  parseAddDraft,
  readAddDraft,
  serializeAddDraft,
  settleAdd,
  type AddDraft,
} from "@/lib/auth/add";
import { parseDraft } from "@/lib/auth/draft";
import { getMembership, spendLoginToken, upsertUser, addMember } from "@/lib/auth/store";
import { getCompanyByDomain } from "@/lib/db/queries";
import { submitStack } from "@/lib/network";
import { requestAddLink } from "@/actions/company";
import { MAIL_UNAVAILABLE_MESSAGE } from "@/lib/email";

/**
 * A company can only add itself. These tests hold the line that let somebody
 * put "Facebook ✓ Claimed" on the graph: no profile exists until an address
 * on the company's own domain opens the link, and CLAIMED still waits for two
 * independent tools.
 */

const env = process.env as Record<string, string | undefined>;
let savedNodeEnv: string | undefined;

beforeEach(async () => {
  await resetDatabase();
  savedNodeEnv = env.NODE_ENV;
});

afterEach(() => {
  if (savedNodeEnv === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = savedNodeEnv;
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

function draftFor(url: string, fields: Record<string, string> = {}): AddDraft {
  const read = readAddDraft(form({ url, name: "Acme", ...fields }));
  if ("error" in read) throw new Error(read.error);
  return read.draft;
}

/* -------------------------------------------------------------------------- */
describe("the add form", () => {
  it("reads a clean draft from the confirm form", () => {
    const draft = draftFor("https://www.Acme.dev/pricing", {
      description: "Async standups.",
      category: "Productivity",
      audience: "remote teams",
      logoUrl: "https://acme.dev/logo.png",
    });
    expect(draft).toMatchObject({
      kind: "add",
      domain: "acme.dev",
      website: "https://acme.dev",
      name: "Acme",
      category: "Productivity",
      logoUrl: "https://acme.dev/logo.png",
    });
  });

  it("refuses a missing name and an unusable address", () => {
    expect("error" in readAddDraft(form({ url: "acme.dev", name: "A" }))).toBe(true);
    expect("error" in readAddDraft(form({ url: "localhost", name: "Acme" }))).toBe(true);
  });

  it("drops a category that is not ours and a logo that is not a web address", () => {
    const draft = draftFor("acme.dev", {
      category: "Best Overall",
      logoUrl: "javascript:alert(1)",
    });
    expect(draft.category).toBe("");
    expect(draft.logoUrl).toBe("");
  });

  it("round-trips, and is never mistaken for a claim draft or the reverse", () => {
    const draft = draftFor("acme.dev");
    const raw = serializeAddDraft(draft);
    expect(parseAddDraft(raw)).toEqual(draft);
    expect(parseDraft(raw)).toBeNull();
    expect(parseAddDraft(JSON.stringify({ companyId: "x", name: "Acme" }))).toBeNull();
  });

  it("refuses a draft whose domain does not match its website", () => {
    const tampered = { ...draftFor("acme.dev"), domain: "facebook.com" };
    expect(parseAddDraft(JSON.stringify(tampered))).toBeNull();
    expect(parseAddDraft("{nope")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
describe("opening the link", () => {
  it("creates the profile for an address on its own domain, unclaimed until two tools", async () => {
    const user = await upsertUser({ email: "sam@acme.dev", provider: "email" });
    const result = await settleAdd({
      user,
      draft: draftFor("acme.dev", { description: "Async standups." }),
    });

    expect(result.status).toBe("ADDED");
    const acme = (await getCompanyByDomain("acme.dev"))!;
    expect(acme.source).toBe("SELF_ADDED");
    expect(acme.description).toBe("Async standups.");
    expect(acme.claimVerifiedAt).not.toBeNull();
    expect(acme.status).toBe("UNCLAIMED");
    expect(await getMembership(user.id, acme.id)).not.toBeNull();
    expect(addDestination(result, "acme.dev")).toBe("/manage/acme");

    await submitStack({
      companyId: acme.id,
      tools: [
        { website: "tally.so", name: "Tally" },
        { website: "plausible.io", name: "Plausible" },
      ],
    });
    expect((await getCompanyByDomain("acme.dev"))!.status).toBe("CLAIMED");
  });

  it("refuses a stranger and writes nothing: the Facebook case", async () => {
    for (const email of ["someone@gmail.com", "someone@goodlads.cc"]) {
      const user = await upsertUser({ email, provider: "google" });
      const result = await settleAdd({ user, draft: draftFor("facebook.com") });
      expect(result.status).toBe("REFUSED");
      expect(addDestination(result, "facebook.com")).toBe(
        "/add?error=not-your-domain&domain=facebook.com",
      );
    }
    expect(await getCompanyByDomain("facebook.com")).toBeNull();
    expect(await countRows("companies")).toBe(0);
    expect(await countRows("company_members")).toBe(0);
  });

  it("becomes a claim when the domain appeared in the meantime", async () => {
    // Somebody credited Acme while the link sat in the inbox.
    const kettle = await joinedCompany("kettle.app", "Kettle");
    await submitStack({
      companyId: kettle.id,
      tools: [{ website: "acme.dev", name: "acme.dev" }],
    });

    const user = await upsertUser({ email: "sam@acme.dev", provider: "email" });
    const result = await settleAdd({
      user,
      draft: draftFor("acme.dev", { name: "Acme", description: "Async standups." }),
    });

    expect(result.status).toBe("EXISTING");
    const acme = (await getCompanyByDomain("acme.dev"))!;
    expect(acme.name).toBe("Acme");
    expect(acme.description).toBe("Async standups.");
    expect(await getMembership(user.id, acme.id)).not.toBeNull();
    expect(await countRows("companies")).toBe(2);
  });

  it("never hands a managed company to a second person", async () => {
    const first = await upsertUser({ email: "sam@acme.dev", provider: "email" });
    await settleAdd({ user: first, draft: draftFor("acme.dev") });

    const second = await upsertUser({ email: "eve@acme.dev", provider: "email" });
    const result = await settleAdd({
      user: second,
      draft: draftFor("acme.dev", { name: "Not Acme" }),
    });
    expect(result.status).toBe("EXISTING");
    if (result.status !== "EXISTING") return;
    expect(result.outcome.status).toBe("REFUSED");
    expect((await getCompanyByDomain("acme.dev"))!.name).toBe("Acme");
    expect(addDestination(result, "acme.dev")).toContain("claim=refused");
  });
});

/* -------------------------------------------------------------------------- */
describe("asking for the link", () => {
  function confirmForm(email: string, url = "https://acme.dev") {
    return form({ url, name: "Acme", description: "Async standups.", email });
  }

  it("creates nothing, and holds the draft on the token", async () => {
    const state = await requestAddLink({}, confirmForm("sam@acme.dev"));
    expect(state.error).toBeUndefined();
    expect(state.sent).toContain("Link sent to sam@acme.dev.");

    expect(await countRows("companies")).toBe(0);
    expect(await countRows("login_tokens")).toBe(1);

    // In development the link is on screen; spend it the way the route does.
    const token = /token=([\w-]+)/.exec(state.sent ?? "")?.[1] ?? "";
    const spent = await spendLoginToken(token);
    expect(spent?.intentCompanyId).toBeNull();
    expect(parseAddDraft(spent?.claimDraft)).toMatchObject({
      domain: "acme.dev",
      description: "Async standups.",
    });
  });

  it("refuses a free mailbox or another domain before any link exists", async () => {
    const free = await requestAddLink({}, confirmForm("sam@gmail.com"));
    expect(free.error).toContain("free mailbox");
    expect(free.sent).toBeUndefined();

    const other = await requestAddLink({}, confirmForm("sam@goodlads.cc", "https://facebook.com"));
    expect(other.error).toContain("Only someone at facebook.com can add it");

    expect(await countRows("login_tokens")).toBe(0);
    expect(await countRows("companies")).toBe(0);
  });

  it("keeps what was typed when it refuses", async () => {
    const state = await requestAddLink({}, confirmForm("sam@gmail.com"));
    expect(state.values).toMatchObject({
      name: "Acme",
      description: "Async standups.",
      email: "sam@gmail.com",
    });
  });

  it("refuses on a production deployment that cannot mail", async () => {
    env.NODE_ENV = "production";
    const state = await requestAddLink({}, confirmForm("sam@acme.dev"));
    expect(state.error).toBe(MAIL_UNAVAILABLE_MESSAGE);
    expect(await countRows("login_tokens")).toBe(0);
  });

  it("does not re-add a company that someone already manages", async () => {
    const owner = await upsertUser({ email: "sam@acme.dev", provider: "email" });
    const acme = await joinedCompany("acme.dev", "Acme");
    await addMember({ userId: owner.id, companyId: acme.id });

    // An existing domain is sent on to its profile, never created twice.
    // Outside a request that hand-off throws (it reads who is asking, then
    // redirects); what this holds is that nothing was written before it.
    await expect(requestAddLink({}, confirmForm("eve@acme.dev"))).rejects.toThrow();
    expect(await countRows("companies")).toBe(1);
    expect(await countRows("login_tokens")).toBe(0);
  });
});
