import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countRows, resetDatabase } from "./helpers";
import {
  MAIL_FAILED_MESSAGE,
  MAIL_UNAVAILABLE_MESSAGE,
  mailUnavailable,
  showsDevLinks,
} from "@/lib/email";
import { sendSignInLink } from "@/actions/auth";
import { startClaim } from "@/actions/claim";
import { addCompany } from "@/lib/network";

/**
 * A sign-in link on screen is a sign-in for whoever typed the address, and an
 * address on the company's own domain is approved as owner on the spot. So
 * the one question these tests ask is: when does a link ever leave the
 * server other than by mail? Only in development, and never on a public
 * deployment, whatever is or is not configured there.
 */

const saved: Record<string, string | undefined> = {};
const KEYS = ["NODE_ENV", "VERCEL", "RESEND_API_KEY"] as const;
// Next's types mark NODE_ENV read-only; at runtime it is an ordinary variable,
// and that is what these tests change and restore.
const env = process.env as Record<string, string | undefined>;

function setEnv(values: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const key of KEYS) {
    if (values[key] === undefined) delete env[key];
    else env[key] = values[key];
  }
}

beforeEach(async () => {
  await resetDatabase();
  for (const key of KEYS) saved[key] = env[key];
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete env[key];
    else env[key] = saved[key];
  }
  vi.unstubAllGlobals();
});

function signInForm(email: string, intent = ""): FormData {
  const data = new FormData();
  data.append("email", email);
  data.append("intent", intent);
  return data;
}

function claimForm(email: string): FormData {
  const data = new FormData();
  data.append("email", email);
  data.append("name", "Sam Rivera");
  data.append("role", "Founder");
  data.append("represents", "on");
  return data;
}

/* -------------------------------------------------------------------------- */
describe("when a link may be shown on screen", () => {
  it("only in development, and only with no mail provider", () => {
    expect(showsDevLinks({})).toBe(true);
    expect(showsDevLinks({ NODE_ENV: "development" })).toBe(true);
    expect(showsDevLinks({ NODE_ENV: "test" })).toBe(true);
  });

  it("never on a production build", () => {
    expect(showsDevLinks({ NODE_ENV: "production" })).toBe(false);
  });

  it("never on Vercel, previews included", () => {
    expect(showsDevLinks({ VERCEL: "1" })).toBe(false);
    expect(showsDevLinks({ VERCEL: "1", NODE_ENV: "development" })).toBe(false);
  });

  it("never when mail can actually be delivered", () => {
    expect(showsDevLinks({ RESEND_API_KEY: "re_test" })).toBe(false);
  });

  it("names the deployment that can neither mail nor show a link", () => {
    expect(mailUnavailable({ NODE_ENV: "production" })).toBe(true);
    expect(mailUnavailable({ VERCEL: "1" })).toBe(true);
    expect(mailUnavailable({ NODE_ENV: "production", RESEND_API_KEY: "re_test" })).toBe(false);
    expect(mailUnavailable({})).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
describe("the sign-in link", () => {
  it("is shown on screen in development without a mail provider", async () => {
    setEnv({});
    const state = await sendSignInLink({}, signInForm("sam@acme.dev"));
    expect(state.error).toBeUndefined();
    expect(state.sent).toContain("Link sent to sam@acme.dev.");
    expect(state.sent).toContain("http://localhost:3000/auth/link?token=");
    expect(await countRows("login_tokens")).toBe(1);
  });

  it("is refused outright on a production deployment without a mail provider", async () => {
    setEnv({ NODE_ENV: "production" });
    const state = await sendSignInLink({}, signInForm("sam@acme.dev"));
    expect(state.error).toBe(MAIL_UNAVAILABLE_MESSAGE);
    expect(state.sent).toBeUndefined();
    // No token was minted for a link nobody can receive, and nothing was
    // counted as sent.
    expect(await countRows("login_tokens")).toBe(0);
    expect(await countRows("events")).toBe(0);
  });

  it("is refused on Vercel too, however the build was made", async () => {
    setEnv({ VERCEL: "1", NODE_ENV: "development" });
    const state = await sendSignInLink({}, signInForm("sam@acme.dev"));
    expect(state.error).toBe(MAIL_UNAVAILABLE_MESSAGE);
    expect(await countRows("login_tokens")).toBe(0);
  });

  it("never puts the link in the response when a provider is configured", async () => {
    setEnv({ RESEND_API_KEY: "re_test", NODE_ENV: "production" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );

    const state = await sendSignInLink({}, signInForm("sam@acme.dev"));
    expect(state.error).toBeUndefined();
    expect(state.sent).toBe("Link sent to sam@acme.dev.");
    expect(state.sent).not.toContain("token=");
    expect(await countRows("login_tokens")).toBe(1);
  });

  it("reports a provider error instead of claiming the link was sent", async () => {
    // What an unverified sender domain looks like from here: Resend answers,
    // but not with a send.
    setEnv({ RESEND_API_KEY: "re_test", NODE_ENV: "production" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("forbidden", { status: 403 })),
    );

    const state = await sendSignInLink({}, signInForm("sam@acme.dev"));
    expect(state.sent).toBeUndefined();
    expect(state.error).toBe(MAIL_FAILED_MESSAGE);
    expect(state.error).not.toContain("token=");
    expect(await countRows("events")).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
describe("the claim link", () => {
  async function unclaimedAcme() {
    const { company } = await addCompany({
      url: "acme.dev",
      name: "Acme",
      source: "SEED",
      status: "UNCLAIMED",
    });
    return company;
  }

  it("is shown on screen in development without a mail provider", async () => {
    setEnv({});
    const acme = await unclaimedAcme();
    const state = await startClaim(acme.slug, {}, claimForm("sam@acme.dev"));
    expect(state.error).toBeUndefined();
    expect(state.sentTo).toBe("sam@acme.dev");
    expect(state.devLink).toContain("/claim/acme/verify?token=");
  });

  it("is refused on a production deployment without a mail provider", async () => {
    setEnv({ NODE_ENV: "production" });
    const acme = await unclaimedAcme();
    const state = await startClaim(acme.slug, {}, claimForm("sam@acme.dev"));
    expect(state.error).toBe(MAIL_UNAVAILABLE_MESSAGE);
    expect(state.devLink).toBeUndefined();
    expect(await countRows("claims")).toBe(0);
  });

  it("keeps the link out of the response when a provider is configured", async () => {
    setEnv({ RESEND_API_KEY: "re_test", NODE_ENV: "production" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
    const acme = await unclaimedAcme();
    const state = await startClaim(acme.slug, {}, claimForm("sam@acme.dev"));
    expect(state.sentTo).toBe("sam@acme.dev");
    expect(state.devLink).toBeUndefined();
  });

  it("reports a provider error instead of claiming the link was sent", async () => {
    setEnv({ RESEND_API_KEY: "re_test", NODE_ENV: "production" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("forbidden", { status: 403 })),
    );
    const acme = await unclaimedAcme();
    const state = await startClaim(acme.slug, {}, claimForm("sam@acme.dev"));
    expect(state.sentTo).toBeUndefined();
    expect(state.error).toBe(MAIL_FAILED_MESSAGE);
  });
});
