import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countRows, resetDatabase } from "./helpers";
import {
  LINK_ON_SCREEN_MESSAGE,
  MAIL_FAILED_MESSAGE,
  MAIL_UNAVAILABLE_MESSAGE,
  adminAddress,
  contactAddress,
  mailUnavailable,
  replyToAddress,
  sendEmail,
  showsDevLinks,
} from "@/lib/email";
import { sendSignInLink } from "@/actions/auth";
import { startClaim } from "@/actions/claim";
import { approveOwnership, settleOwnership } from "@/lib/auth/claim";
import { getMembership, upsertUser } from "@/lib/auth/store";
import { getCompanyById } from "@/lib/db/queries";
import { addCompany } from "@/lib/network";

/**
 * A sign-in link on screen is a sign-in for whoever typed the address, and an
 * address on the company's own domain is approved as owner on the spot. So
 * the one question these tests ask is: when does a link ever leave the
 * server other than by mail? Only in development, and never on a public
 * deployment, whatever is or is not configured there.
 */

const saved: Record<string, string | undefined> = {};
const KEYS = [
  "NODE_ENV",
  "VERCEL",
  "RESEND_API_KEY",
  "EMAIL_REPLY_TO",
  "ADMIN_NOTIFY_EMAIL",
  "CONTACT_EMAIL",
] as const;
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
/*
 * Launch-period rule (2026-11-03, Pieter's decision): wherever nothing can
 * deliver mail, the link is shown on screen, production included. The key
 * is the off switch: set RESEND_API_KEY and the link goes by mail again.
 */
describe("when a link may be shown on screen", () => {
  it("wherever there is no mail provider, production included", () => {
    expect(showsDevLinks({})).toBe(true);
    expect(showsDevLinks({ NODE_ENV: "development" })).toBe(true);
    expect(showsDevLinks({ NODE_ENV: "production" })).toBe(true);
    expect(showsDevLinks({ VERCEL: "1" })).toBe(true);
  });

  it("never when mail can actually be delivered", () => {
    expect(showsDevLinks({ RESEND_API_KEY: "re_test" })).toBe(false);
    expect(showsDevLinks({ RESEND_API_KEY: "re_test", NODE_ENV: "production" })).toBe(false);
  });

  it("so no deployment is left unable to hand out a link", () => {
    expect(mailUnavailable({ NODE_ENV: "production" })).toBe(false);
    expect(mailUnavailable({ VERCEL: "1" })).toBe(false);
    expect(mailUnavailable({ NODE_ENV: "production", RESEND_API_KEY: "re_test" })).toBe(false);
    expect(mailUnavailable({})).toBe(false);
    expect(MAIL_UNAVAILABLE_MESSAGE).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
describe("the sign-in link", () => {
  it("is shown on screen, as a link apart from the message, without a mail provider", async () => {
    setEnv({});
    const state = await sendSignInLink({}, signInForm("sam@acme.dev"));
    expect(state.error).toBeUndefined();
    expect(state.sent).toBe(LINK_ON_SCREEN_MESSAGE);
    expect(state.link).toContain("http://localhost:3000/auth/link?token=");
    expect(await countRows("login_tokens")).toBe(1);
  });

  it("is shown on screen on a production deployment too, and logged", async () => {
    setEnv({ NODE_ENV: "production" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const state = await sendSignInLink({}, signInForm("sam@acme.dev"));
    expect(state.error).toBeUndefined();
    expect(state.link).toContain("/auth/link?token=");
    expect(await countRows("login_tokens")).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("shown on screen"));
    warn.mockRestore();
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

  it("is shown on screen on a production deployment too, and logged", async () => {
    setEnv({ NODE_ENV: "production" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const acme = await unclaimedAcme();
    const state = await startClaim(acme.slug, {}, claimForm("sam@acme.dev"));
    expect(state.error).toBeUndefined();
    expect(state.devLink).toContain("/claim/acme/verify?token=");
    expect(await countRows("claims")).toBe(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("shown on screen"));
    warn.mockRestore();
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

/* -------------------------------------------------------------------------- */
/**
 * Captures what would have gone to Resend. Each entry is one request body.
 */
function captureResend(): Record<string, unknown>[] {
  const sent: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response("{}", { status: 200 });
    }),
  );
  return sent;
}

describe("where replies and the public address go", () => {
  it("reads the addresses from the environment, and ignores junk", () => {
    expect(replyToAddress({})).toBeNull();
    expect(replyToAddress({ EMAIL_REPLY_TO: "  " })).toBeNull();
    expect(replyToAddress({ EMAIL_REPLY_TO: "not an address" })).toBeNull();
    expect(replyToAddress({ EMAIL_REPLY_TO: " pieter@example.com " })).toBe(
      "pieter@example.com",
    );
    expect(adminAddress({})).toBeNull();
    expect(adminAddress({ ADMIN_NOTIFY_EMAIL: "pieter@example.com" })).toBe(
      "pieter@example.com",
    );
    expect(contactAddress({})).toBe("hello@whouseswhat.tech");
    expect(contactAddress({ CONTACT_EMAIL: "pieter@example.com" })).toBe(
      "pieter@example.com",
    );
  });

  it("puts Reply-To on every mail once it is configured, and never otherwise", async () => {
    setEnv({ RESEND_API_KEY: "re_test" });
    const sent = captureResend();

    await sendEmail({ to: "sam@acme.dev", subject: "Hi", text: "Hello" });
    expect(sent[0]).not.toHaveProperty("reply_to");

    env.EMAIL_REPLY_TO = "pieter@example.com";
    await sendEmail({ to: "sam@acme.dev", subject: "Hi", text: "Hello" });
    expect(sent[1]).toMatchObject({ reply_to: "pieter@example.com" });

    // A message can name its own reply address.
    await sendEmail({
      to: "sam@acme.dev",
      subject: "Hi",
      text: "Hello",
      replyTo: "sam@gmail.com",
    });
    expect(sent[2]).toMatchObject({ reply_to: "sam@gmail.com" });
  });
});

/* -------------------------------------------------------------------------- */
describe("the mail to whoever runs the site", () => {
  async function unclaimedAcme() {
    const { company } = await addCompany({
      url: "acme.dev",
      name: "Acme",
      source: "SEED",
      status: "UNCLAIMED",
    });
    return company;
  }

  it("goes out when a claim needs a human, with the approve link and the person as Reply-To", async () => {
    setEnv({ RESEND_API_KEY: "re_test", ADMIN_NOTIFY_EMAIL: "pieter@example.com" });
    const sent = captureResend();
    const acme = await unclaimedAcme();
    const sam = await upsertUser({ email: "sam@gmail.com", provider: "email" });

    const outcome = await settleOwnership({ user: sam, companyId: acme.id });
    expect(outcome).toEqual({ status: "PENDING", reason: "FREE_EMAIL" });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      to: ["pieter@example.com"],
      reply_to: "sam@gmail.com",
      subject: "Claim to decide: Acme (sam@gmail.com)",
    });
    const text = String(sent[0].text);
    expect(text).toContain(
      `http://localhost:3000/admin/${acme.id}?approve=sam%40gmail.com`,
    );
    expect(text).toContain("A free mailbox cannot prove who owns a domain");
    // The mail changed nothing: still nobody manages Acme.
    expect(await getMembership(sam.id, acme.id)).toBeNull();
  });

  it("is not sent for a claim the domain already decided", async () => {
    setEnv({ RESEND_API_KEY: "re_test", ADMIN_NOTIFY_EMAIL: "pieter@example.com" });
    const sent = captureResend();
    const acme = await unclaimedAcme();
    const sam = await upsertUser({ email: "sam@acme.dev", provider: "email" });

    const outcome = await settleOwnership({ user: sam, companyId: acme.id });
    expect(outcome.status).toBe("APPROVED");
    expect(sent).toHaveLength(0);
  });

  it("is simply skipped when no address is configured", async () => {
    setEnv({ RESEND_API_KEY: "re_test" });
    const sent = captureResend();
    const acme = await unclaimedAcme();
    const sam = await upsertUser({ email: "sam@gmail.com", provider: "email" });

    const outcome = await settleOwnership({ user: sam, companyId: acme.id });
    expect(outcome.status).toBe("PENDING");
    expect(sent).toHaveLength(0);
  });

  it("approving from admin makes the person the owner and the contact route", async () => {
    const acme = await unclaimedAcme();
    const sam = await upsertUser({ email: "sam@gmail.com", provider: "email" });
    await settleOwnership({ user: sam, companyId: acme.id });

    await approveOwnership({ userId: sam.id, companyId: acme.id, email: sam.email });

    expect((await getMembership(sam.id, acme.id))?.role).toBe("OWNER");
    const after = (await getCompanyById(acme.id))!;
    expect(after.contactEmail).toBe("sam@gmail.com");
    expect(after.claimVerifiedAt).not.toBeNull();
    // Identity alone does not claim: that still takes two tools.
    expect(after.status).toBe("UNCLAIMED");
  });
});
