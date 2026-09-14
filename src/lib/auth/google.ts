import { absoluteUrl } from "../url";

/**
 * Google sign-in, authorization-code flow, by hand.
 *
 * Small on purpose. The one part people expect to be hard — verifying the ID
 * token's signature — is not required here: the token comes straight from
 * Google's token endpoint over TLS, in a request authenticated with our
 * client secret, so OIDC Core §3.1.3.7 permits skipping signature validation
 * for exactly this case. We still check `aud`, `iss` and expiry, because those
 * are cheap and catch a misconfigured client.
 *
 * Unset credentials mean the button is not rendered. Sign-in by email link
 * works on its own, so a missing Google app is a degraded option and not a
 * broken app.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export function googleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
}

export function googleRedirectUri(): string {
  return absoluteUrl("/auth/google/callback");
}

/** Where to send the browser. `state` carries our CSRF value and the intent. */
export function googleAuthUrl(state: string): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID ?? "");
  url.searchParams.set("redirect_uri", googleRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  // We only ever need the one identity assertion, so no refresh token and no
  // offline access: there is nothing we would do with either.
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export interface GoogleIdentity {
  email: string;
  name: string | null;
  imageUrl: string | null;
}

interface IdTokenClaims {
  iss?: string;
  aud?: string;
  exp?: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

function decodeIdToken(idToken: string): IdTokenClaims | null {
  const [, payload] = idToken.split(".");
  if (!payload) return null;
  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    return JSON.parse(json) as IdTokenClaims;
  } catch {
    return null;
  }
}

/**
 * Exchange the code for an identity. Returns null on anything unexpected
 * rather than throwing, so the callback can redirect to a readable error
 * instead of a stack trace.
 */
export async function exchangeGoogleCode(
  code: string,
): Promise<GoogleIdentity | null> {
  if (!googleConfigured()) return null;

  let idToken: string;
  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        redirect_uri: googleRedirectUri(),
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { id_token?: string };
    if (!body.id_token) return null;
    idToken = body.id_token;
  } catch {
    return null;
  }

  const claims = decodeIdToken(idToken);
  if (!claims) return null;

  // Cheap sanity checks. A wrong `aud` means the token was minted for another
  // application, which is the one case worth refusing loudly.
  if (!claims.iss || !ISSUERS.includes(claims.iss)) return null;
  if (claims.aud !== process.env.GOOGLE_CLIENT_ID) return null;
  if (!claims.exp || claims.exp * 1000 < Date.now()) return null;

  // An unverified address proves nothing, and this whole system is "you can
  // read this mailbox".
  if (!claims.email || claims.email_verified !== true) return null;

  return {
    email: claims.email,
    name: claims.name ?? null,
    imageUrl: claims.picture ?? null,
  };
}
