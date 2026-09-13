import { cookies } from "next/headers";
import { getEditToken } from "./db/queries";

const EDITOR_COOKIE = "ss_editor";
const ADMIN_COOKIE = "ss_admin";
const MAX_TOKENS = 10;
const YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Deliberately not an identity system. A browser holds the edit tokens of the
 * companies it created or claimed; that is enough for an MVP whose risk is
 * "someone edits a stack they don't own", not "someone drains an account".
 */
async function readTokens(): Promise<string[]> {
  const store = await cookies();
  const raw = store.get(EDITOR_COOKIE)?.value;
  if (!raw) return [];
  return raw.split(".").filter(Boolean).slice(0, MAX_TOKENS);
}

export async function grantEditAccess(companyId: string): Promise<void> {
  const token = await getEditToken(companyId);
  if (!token) return;

  const tokens = await readTokens();
  if (tokens.includes(token)) return;

  const store = await cookies();
  store.set(EDITOR_COOKIE, [token, ...tokens].slice(0, MAX_TOKENS).join("."), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: YEAR_SECONDS,
  });
}

export async function canEdit(companyId: string): Promise<boolean> {
  const token = await getEditToken(companyId);
  if (!token) return false;
  return (await readTokens()).includes(token);
}

/* --- admin --------------------------------------------------------------- */

export async function isAdmin(): Promise<boolean> {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  const store = await cookies();
  return store.get(ADMIN_COOKIE)?.value === expected;
}

export async function grantAdmin(key: string): Promise<boolean> {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || key !== expected) return false;

  const store = await cookies();
  store.set(ADMIN_COOKIE, expected, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return true;
}
