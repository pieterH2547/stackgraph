import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who may act for a company.
 *
 * The rest of the suite can avoid request state; this file cannot, because
 * the whole question is which cookie is on the request. So `next/headers` is
 * stubbed with a store the test writes directly, and nothing else is faked —
 * the membership rows and edit tokens are real.
 */

const jar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name)! } : undefined,
    set: (name: string, value: string) => jar.set(name, value),
    delete: (name: string) => jar.delete(name),
  }),
}));

const { resetDatabase } = await import("./helpers");
const { canActFor, canManage } = await import("@/lib/auth/session");
const { canEdit } = await import("@/lib/session");
const { addMember, createSession, upsertUser } = await import(
  "@/lib/auth/store"
);
const { getEditToken } = await import("@/lib/db/queries");
const { addCompany } = await import("@/lib/network");

const EDITOR_COOKIE = "ss_editor";
const SESSION_COOKIE = "wuw_session";

async function company(domain: string, name: string) {
  const { company } = await addCompany({
    url: domain,
    name,
    source: "SELF_ADDED",
    status: "UNCLAIMED",
  });
  return company;
}

/** Signs a verified owner in, the way the ownership flow leaves things. */
async function signInAsOwnerOf(companyId: string, email: string) {
  const user = await upsertUser({ email, provider: "google" });
  await addMember({ userId: user.id, companyId, role: "OWNER" });
  jar.set(SESSION_COOKIE, await createSession(user.id));
  return user;
}

beforeEach(async () => {
  jar.clear();
  await resetDatabase();
});

describe("a verified owner on a browser that never held the old cookie", () => {
  it("may act, even though the edit-token cookie is absent", async () => {
    const acme = await company("acme.dev", "Acme");
    await signInAsOwnerOf(acme.id, "sam@acme.dev");

    // The exact production shape: claimed on one device, acting on another.
    expect(await canEdit(acme.id)).toBe(false);
    expect(await canManage(acme.id)).toBe(true);
    expect(await canActFor(acme.id)).toBe(true);
  });

  it("may not act for a company they do not own", async () => {
    const acme = await company("acme.dev", "Acme");
    const kettle = await company("kettle.app", "Kettle");
    await signInAsOwnerOf(acme.id, "sam@acme.dev");

    expect(await canActFor(kettle.id)).toBe(false);
  });
});

describe("the legacy edit-token cookie", () => {
  it("still works on its own, for claims made before accounts existed", async () => {
    const acme = await company("acme.dev", "Acme");
    jar.set(EDITOR_COOKIE, (await getEditToken(acme.id))!);

    expect(await canManage(acme.id)).toBe(false);
    expect(await canActFor(acme.id)).toBe(true);
  });

  it("does not carry to another company", async () => {
    const acme = await company("acme.dev", "Acme");
    const kettle = await company("kettle.app", "Kettle");
    jar.set(EDITOR_COOKIE, (await getEditToken(acme.id))!);

    expect(await canActFor(kettle.id)).toBe(false);
  });

  it("is not satisfied by a guessed or stale value", async () => {
    const acme = await company("acme.dev", "Acme");
    for (const value of ["", "not-a-token", "a.b.c", "x".repeat(32)]) {
      jar.set(EDITOR_COOKIE, value);
      expect(await canActFor(acme.id), value).toBe(false);
    }
  });
});

describe("a stranger", () => {
  it("may not act for anybody, with no cookies at all", async () => {
    const acme = await company("acme.dev", "Acme");
    expect(await canActFor(acme.id)).toBe(false);
  });

  it("may not act with a signed-in session that owns nothing", async () => {
    const acme = await company("acme.dev", "Acme");
    const stranger = await upsertUser({
      email: "nobody@example.com",
      provider: "google",
    });
    jar.set(SESSION_COOKIE, await createSession(stranger.id));

    expect(await canActFor(acme.id)).toBe(false);
  });

  it("may not act with an invented session id", async () => {
    const acme = await company("acme.dev", "Acme");
    jar.set(SESSION_COOKIE, "made-up-session-id");

    expect(await canActFor(acme.id)).toBe(false);
  });
});
