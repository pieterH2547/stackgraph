import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { googleAuthUrl } from "./google";
import { newStateToken } from "./store";

/**
 * The form's contents, for the Google door.
 *
 * Google's round trip is a redirect in the same browser, so a short-lived
 * httpOnly cookie carries the draft without a second table. The email door
 * cannot use one — that link is opened on a phone as often as not — so it
 * keeps its draft on the token row instead. A claim draft and an add draft
 * share the cookie; their parsers never accept each other's.
 */
export const DRAFT_COOKIE = "wuw_claim";
const DRAFT_MINUTES = 30;
export const OAUTH_COOKIE = "wuw_oauth";

/** Off to Google, with CSRF state and the claim intent riding inside it. */
export async function beginGoogleSignIn(
  intentSlug: string,
  draft: string | null,
): Promise<never> {
  const store = await cookies();
  const secure = process.env.NODE_ENV === "production";

  if (draft) {
    store.set(DRAFT_COOKIE, draft, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: DRAFT_MINUTES * 60,
    });
  } else {
    store.delete(DRAFT_COOKIE);
  }

  const nonce = newStateToken();
  store.set(OAUTH_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 600,
  });

  // The state is checked on the way back, so it must be unguessable and it
  // must be the thing that carries the intent — not a query parameter the
  // caller could edit.
  redirect(googleAuthUrl(`${nonce}:${intentSlug}`));
}
