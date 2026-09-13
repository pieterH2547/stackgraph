import { randomBytes, randomUUID } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

/** URL-safe opaque token for edit cookies and claim links. */
export function newToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export function nowIso(): string {
  return new Date().toISOString();
}
