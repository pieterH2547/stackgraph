import { cookies } from "next/headers";
import { getCompanyBySlug } from "../db/queries";
import type { Company } from "../types";
import {
  createSession,
  deleteSession,
  getMembership,
  getSessionUser,
  SESSION_DAYS,
  type MemberRole,
  type User,
} from "./store";

/**
 * Who is asking, and what they are allowed to do.
 *
 * Every check here runs on the server against `company_members`. The UI
 * hiding a button is a courtesy to the reader, never a permission — so each
 * server action calls `requireManager` itself rather than trusting that it was
 * only rendered where it should have been.
 */

const SESSION_COOKIE = "wuw_session";

export async function startSession(userId: string): Promise<void> {
  const id = await createSession(userId);
  const store = await cookies();
  store.set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 3600,
  });
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  const id = store.get(SESSION_COOKIE)?.value;
  if (id) await deleteSession(id);
  store.delete(SESSION_COOKIE);
}

/** The signed-in user, or null. Never throws: most pages are public. */
export async function currentUser(): Promise<User | null> {
  const store = await cookies();
  const id = store.get(SESSION_COOKIE)?.value;
  if (!id) return null;
  return getSessionUser(id);
}

export async function roleFor(
  companyId: string,
  user?: User | null,
): Promise<MemberRole | null> {
  const who = user ?? (await currentUser());
  if (!who) return null;
  const membership = await getMembership(who.id, companyId);
  return membership?.role ?? null;
}

/** True when the signed-in user may manage this company. */
export async function canManage(companyId: string): Promise<boolean> {
  return (await roleFor(companyId)) !== null;
}

export class NotSignedIn extends Error {
  constructor() {
    super("Sign in to do that.");
  }
}

export class NotYourCompany extends Error {
  constructor() {
    super("That isn't your company to manage.");
  }
}

/**
 * The gate every management action goes through. Returns the company and the
 * user together, because an action that has one and not the other has not
 * finished checking.
 */
export async function requireManager(
  slug: string,
): Promise<{ company: Company; user: User; role: MemberRole }> {
  const user = await currentUser();
  if (!user) throw new NotSignedIn();

  const company = await getCompanyBySlug(slug);
  if (!company) throw new NotYourCompany();

  const role = await roleFor(company.id, user);
  if (!role) throw new NotYourCompany();

  return { company, user, role };
}
