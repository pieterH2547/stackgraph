import { getDb } from "../db/client";
import { newId, newToken, nowIso } from "../ids";

/**
 * Identity, as small as it can be while still being real.
 *
 * There is no password anywhere in here, which removes the whole class of
 * problems that comes with storing one. A person proves they can read an
 * address — by clicking a link we sent, or by Google saying so — and that is
 * the entire basis of the account.
 *
 * Ownership lives in `company_members`, not in a cookie. The edit-token
 * cookie this replaces could not survive a new laptop, so a founder who
 * claimed their company on their phone lost it on their desktop.
 */

export const SESSION_DAYS = 90;
const LOGIN_TOKEN_MINUTES = 30;

/** An unguessable value for an OAuth `state`. */
export function newStateToken(): string {
  return newToken();
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  imageUrl: string | null;
  lastProvider: string | null;
  createdAt: string;
}

export type MemberRole = "OWNER" | "ADMIN" | "MEMBER";

export interface Membership {
  companyId: string;
  role: MemberRole;
  createdAt: string;
}

function mapUser(row: Record<string, unknown>): User {
  return {
    id: String(row.id),
    email: String(row.email),
    name: row.name === null ? null : String(row.name),
    imageUrl: row.image_url === null ? null : String(row.image_url),
    lastProvider: row.last_provider === null ? null : String(row.last_provider),
    createdAt: String(row.created_at),
  };
}

/* -------------------------------------------------------------------------- */
/* users                                                                      */
/* -------------------------------------------------------------------------- */

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const { rows } = await getDb().execute({
    sql: `SELECT * FROM users WHERE email = ? LIMIT 1`,
    args: [normalizeEmail(email)],
  });
  return rows[0] ? mapUser(rows[0] as Record<string, unknown>) : null;
}

export async function getUserById(id: string): Promise<User | null> {
  const { rows } = await getDb().execute({
    sql: `SELECT * FROM users WHERE id = ? LIMIT 1`,
    args: [id],
  });
  return rows[0] ? mapUser(rows[0] as Record<string, unknown>) : null;
}

/**
 * The email address is the identity, so signing in with Google and with a
 * link to the same address is the same person. Name and picture only ever
 * fill a blank: whatever Google says should not overwrite something a person
 * set themselves.
 */
export async function upsertUser(input: {
  email: string;
  name?: string | null;
  imageUrl?: string | null;
  provider: "google" | "email";
}): Promise<User> {
  const email = normalizeEmail(input.email);
  const now = nowIso();
  const existing = await getUserByEmail(email);

  if (existing) {
    await getDb().execute({
      sql: `UPDATE users
               SET name          = COALESCE(name, ?),
                   image_url     = COALESCE(image_url, ?),
                   last_provider = ?,
                   last_seen_at  = ?
             WHERE id = ?`,
      args: [
        input.name ?? null,
        input.imageUrl ?? null,
        input.provider,
        now,
        existing.id,
      ],
    });
    return (await getUserById(existing.id))!;
  }

  const id = newId();
  await getDb().execute({
    sql: `INSERT INTO users
            (id, email, name, image_url, last_provider, created_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [id, email, input.name ?? null, input.imageUrl ?? null, input.provider, now, now],
  });
  return (await getUserById(id))!;
}

/* -------------------------------------------------------------------------- */
/* sessions                                                                   */
/* -------------------------------------------------------------------------- */

export async function createSession(userId: string): Promise<string> {
  const id = newToken();
  const expiresAt = new Date(
    Date.now() + SESSION_DAYS * 24 * 3600 * 1000,
  ).toISOString();

  await getDb().execute({
    sql: `INSERT INTO sessions (id, user_id, expires_at, created_at)
          VALUES (?, ?, ?, ?)`,
    args: [id, userId, expiresAt, nowIso()],
  });
  return id;
}

/** The session's user, or nothing. An expired row is deleted as it is found. */
export async function getSessionUser(sessionId: string): Promise<User | null> {
  const { rows } = await getDb().execute({
    sql: `SELECT u.*, s.expires_at AS session_expires
            FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.id = ? LIMIT 1`,
    args: [sessionId],
  });

  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;

  if (new Date(String(row.session_expires)).getTime() < Date.now()) {
    await deleteSession(sessionId);
    return null;
  }

  return mapUser(row);
}

export async function deleteSession(sessionId: string): Promise<void> {
  await getDb().execute({
    sql: `DELETE FROM sessions WHERE id = ?`,
    args: [sessionId],
  });
}

/* -------------------------------------------------------------------------- */
/* sign-in links                                                              */
/* -------------------------------------------------------------------------- */

export interface LoginToken {
  id: string;
  email: string;
  token: string;
  intentCompanyId: string | null;
  /** The claim form's contents, as JSON, or nothing. See ./draft.ts. */
  claimDraft: string | null;
  expiresAt: string;
  usedAt: string | null;
}

function mapLoginToken(row: Record<string, unknown>): LoginToken {
  return {
    id: String(row.id),
    email: String(row.email),
    token: String(row.token),
    intentCompanyId:
      row.intent_company_id === null ? null : String(row.intent_company_id),
    claimDraft:
      row.claim_draft === null || row.claim_draft === undefined
        ? null
        : String(row.claim_draft),
    expiresAt: String(row.expires_at),
    usedAt: row.used_at === null ? null : String(row.used_at),
  };
}

/**
 * `intentCompanyId` is the whole answer to "don't make users restart the flow
 * after login": what they were claiming is remembered next to the token, on
 * the server. A redirect chain through Google cannot lose it.
 */
export async function createLoginToken(input: {
  email: string;
  intentCompanyId?: string | null;
  /** The claim form's contents, held here so a new device does not lose it. */
  claimDraft?: string | null;
}): Promise<LoginToken> {
  const id = newId();
  const token = newToken();
  const expiresAt = new Date(
    Date.now() + LOGIN_TOKEN_MINUTES * 60 * 1000,
  ).toISOString();

  await getDb().execute({
    sql: `INSERT INTO login_tokens
            (id, email, token, intent_company_id, claim_draft,
             expires_at, used_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    args: [
      id,
      normalizeEmail(input.email),
      token,
      input.intentCompanyId ?? null,
      input.claimDraft ?? null,
      expiresAt,
      nowIso(),
    ],
  });

  return (await getLoginToken(token))!;
}

export async function getLoginToken(token: string): Promise<LoginToken | null> {
  const { rows } = await getDb().execute({
    sql: `SELECT * FROM login_tokens WHERE token = ? LIMIT 1`,
    args: [token],
  });
  return rows[0] ? mapLoginToken(rows[0] as Record<string, unknown>) : null;
}

/**
 * Single use, and the spending is what proves it. Marking it used only when it
 * was still unused means a replayed link cannot mint a second session.
 */
export async function spendLoginToken(token: string): Promise<LoginToken | null> {
  const found = await getLoginToken(token);
  if (!found) return null;
  if (found.usedAt) return null;
  if (new Date(found.expiresAt).getTime() < Date.now()) return null;

  const { rowsAffected } = await getDb().execute({
    sql: `UPDATE login_tokens SET used_at = ? WHERE token = ? AND used_at IS NULL`,
    args: [nowIso(), token],
  });
  return rowsAffected === 1 ? found : null;
}

/* -------------------------------------------------------------------------- */
/* membership                                                                 */
/* -------------------------------------------------------------------------- */

export async function addMember(input: {
  userId: string;
  companyId: string;
  role?: MemberRole;
}): Promise<void> {
  await getDb().execute({
    sql: `INSERT INTO company_members (id, user_id, company_id, role, created_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (user_id, company_id) DO NOTHING`,
    args: [newId(), input.userId, input.companyId, input.role ?? "OWNER", nowIso()],
  });
}

export async function getMembership(
  userId: string,
  companyId: string,
): Promise<Membership | null> {
  const { rows } = await getDb().execute({
    sql: `SELECT company_id, role, created_at FROM company_members
           WHERE user_id = ? AND company_id = ? LIMIT 1`,
    args: [userId, companyId],
  });
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    companyId: String(row.company_id),
    role: String(row.role) as MemberRole,
    createdAt: String(row.created_at),
  };
}

export async function listMemberships(userId: string): Promise<Membership[]> {
  const { rows } = await getDb().execute({
    sql: `SELECT company_id, role, created_at FROM company_members
           WHERE user_id = ? ORDER BY created_at ASC`,
    args: [userId],
  });
  return rows.map((row) => ({
    companyId: String((row as Record<string, unknown>).company_id),
    role: String((row as Record<string, unknown>).role) as MemberRole,
    createdAt: String((row as Record<string, unknown>).created_at),
  }));
}

/** Anybody at all, which is what decides whether a claim is still open. */
export async function companyHasMembers(companyId: string): Promise<boolean> {
  const { rows } = await getDb().execute({
    sql: `SELECT 1 FROM company_members WHERE company_id = ? LIMIT 1`,
    args: [companyId],
  });
  return rows.length > 0;
}
